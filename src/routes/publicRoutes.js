const express = require('express');
const path = require('path');
const { getInventory } = require('../services/inventoryService');

const router = express.Router();

// Inventory API endpoint used by the frontend
router.get('/api/inventory-status', async (req, res) => {
  try {
    const inv = await getInventory();
    res.json({
      available: inv ? inv.quantity_available > 0 : false,
      quantity: inv ? inv.quantity_available : 0,
      low_stock: inv ? (inv.quantity_available > 0 && inv.quantity_available <= inv.low_stock_threshold) : false,
    });
  } catch (err) {
    res.json({ available: true, quantity: 999, low_stock: false });
  }
});

router.get('/success', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/success.html'));
});

router.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/privacy.html'));
});

router.get('/terms', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/terms.html'));
});

router.get('/video', (req, res) => {
  res.sendFile(path.join(__dirname, '../../public/video.html'));
});

module.exports = router;
