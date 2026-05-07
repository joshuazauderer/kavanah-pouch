const express = require('express');
const { constructWebhookEvent } = require('../services/stripeService');
const { createOrderFromStripe } = require('../services/orderService');
const { notifyNewOrder } = require('../services/emailService');

const router = express.Router();

// Raw body required — registered BEFORE json middleware in server.js
router.post('/api/stripe/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature'];
  let event;

  try {
    event = constructWebhookEvent(req.body, sig);
  } catch (err) {
    console.error('Webhook signature verification failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object;
        if (session.payment_status === 'paid') {
          const order = await createOrderFromStripe(session);
          if (order) {
            console.log(`Order created: ${order.order_number}`);
            notifyNewOrder(order).catch(() => {});
          }
        }
        break;
      }

      case 'checkout.session.expired':
      case 'payment_intent.payment_failed':
        // Logged for visibility; no order was created for these
        console.log(`Stripe event received: ${event.type}`);
        break;

      case 'charge.refunded': {
        // Mark order as refunded if we can match by payment intent
        const charge = event.data.object;
        if (charge.payment_intent) {
          const db = require('../db');
          await db.query(
            `UPDATE orders SET payment_status = 'refunded', updated_at = NOW()
             WHERE stripe_payment_intent_id = $1`,
            [charge.payment_intent]
          );
        }
        break;
      }

      default:
        break;
    }
  } catch (err) {
    console.error(`Error processing webhook ${event.type}:`, err.message);
    // Return 200 to prevent Stripe from retrying indefinitely for non-signature errors
  }

  res.json({ received: true });
});

module.exports = router;
