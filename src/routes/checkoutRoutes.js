const express = require('express');
const { body, validationResult } = require('express-validator');
const { createCheckoutSession } = require('../services/stripeService');
const { isAvailable } = require('../services/inventoryService');
const config = require('../config');

const router = express.Router();

const VALID_PRICE_KEYS = ['single', 'two_pack', 'three_pack'];

router.post(
  '/api/checkout',
  body('priceKey').isIn(VALID_PRICE_KEYS).withMessage('Invalid product selection'),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: errors.array()[0].msg });
    }

    const { priceKey } = req.body;
    const pouchesNeeded = config.stripe.pouchesPerPack[priceKey];

    try {
      const available = await isAvailable(pouchesNeeded);
      if (!available) {
        return res.status(409).json({ error: 'Out of stock', soldOut: true });
      }

      const session = await createCheckoutSession(priceKey);
      res.redirect(303, session.url);
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
