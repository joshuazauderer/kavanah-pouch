const Stripe = require('stripe');
const config = require('../config');

const stripe = Stripe(config.stripe.secretKey);

async function createCheckoutSession(priceKey) {
  const priceId = config.stripe.prices[priceKey];
  if (!priceId) throw new Error(`Unknown priceKey: ${priceKey}`);

  const shippingRateId = priceKey === 'three_pack'
    ? config.stripe.shippingRates.freeUs
    : config.stripe.shippingRates.flatUs;

  if (!shippingRateId) throw new Error(`Shipping rate not configured for: ${priceKey}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    line_items: [{ price: priceId, quantity: 1 }],
    shipping_address_collection: {
      allowed_countries: ['US'],
    },
    shipping_options: [{ shipping_rate: shippingRateId }],
    payment_intent_data: {
      statement_descriptor: 'KAVANAHPOUCH.COM',
    },
    metadata: { priceKey },
    success_url: `${config.appBaseUrl}/success?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${config.appBaseUrl}/#buy`,
  });

  return session;
}

function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, config.stripe.webhookSecret);
}

module.exports = { stripe, createCheckoutSession, constructWebhookEvent };
