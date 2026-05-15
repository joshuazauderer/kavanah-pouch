const Stripe = require('stripe');
const config = require('../config');

const stripe = Stripe(config.stripe.secretKey);

async function createCheckoutSession(priceKey, { visitorId, sessionId, isGift = false, giftRecipientName = null, giftMessage = null } = {}) {
  const priceId = config.stripe.prices[priceKey];
  if (!priceId) throw new Error(`Unknown priceKey: ${priceKey}`);

  const shippingRateId = priceKey === 'three_pack'
    ? config.stripe.shippingRates.freeUs
    : config.stripe.shippingRates.flatUs;

  if (!shippingRateId) throw new Error(`Shipping rate not configured for: ${priceKey}`);

  // Only the single-pouch checkout supports the DAVEN299 launch promotion code.
  // 2-pack and 3-pack checkouts deliberately do NOT enable promotion codes so
  // the coupon cannot be applied to multi-unit orders.
  const allowPromoCodes = priceKey === 'one_pouch';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    payment_method_types: ['card'],   // card only — no Link, Klarna, Cash App, Bank
    line_items: [{ price: priceId, quantity: 1 }],
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    shipping_options: [{ shipping_rate: shippingRateId }],
    payment_intent_data: {
      statement_descriptor: 'KAVANAHPOUCH.COM',
    },
    ...(allowPromoCodes && { allow_promotion_codes: true }),
    metadata: {
      priceKey,
      anonymous_visitor_id: visitorId || '',
      session_id: sessionId || '',
      is_gift: isGift ? 'true' : 'false',
      gift_recipient_name: giftRecipientName || '',
      gift_message: giftMessage || '',
    },
    success_url: `${config.appBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appBaseUrl}/#buy`,
  });

  return session;
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

module.exports = { stripe, createCheckoutSession, constructWebhookEvent };
