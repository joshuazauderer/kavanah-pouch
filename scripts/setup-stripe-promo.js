#!/usr/bin/env node
/**
 * scripts/setup-stripe-promo.js
 *
 * Idempotently creates the DAVEN299 launch promotion code in Stripe.
 *
 * Usage
 * -----
 * Test mode (safe — use Stripe test key):
 *   STRIPE_SECRET_KEY=sk_test_... node scripts/setup-stripe-promo.js
 *
 * Live mode (charges real money — use only after verifying in test):
 *   STRIPE_SECRET_KEY=sk_live_... node scripts/setup-stripe-promo.js
 *
 * The script reads STRIPE_SECRET_KEY from the environment (or from a .env
 * file via dotenv).  Never hard-code secret keys.
 *
 * What it does
 * ------------
 * 1. Searches existing coupons for one with metadata.discount_type = "launch_single_pouch".
 *    If found, reuses it.  Otherwise creates a new coupon:
 *      - amount_off: 299 (cents = $2.99)
 *      - currency: "usd"
 *      - duration: "once"
 *      - name: "Kavanah Pouch Launch Discount - $2.99 Off"
 *
 * 2. Searches existing promotion codes for "DAVEN299" on that coupon.
 *    If found, reuses it.  Otherwise creates a new promotion code:
 *      - code: "DAVEN299"
 *      - max_redemptions: 30
 *      - active: true
 *
 * 3. Logs the resulting coupon ID and promotion code ID.
 */

require('dotenv').config();
const Stripe = require('stripe');

const secretKey = process.env.STRIPE_SECRET_KEY;
if (!secretKey) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set.');
  process.exit(1);
}

const stripe = Stripe(secretKey);

const COUPON_METADATA_KEY   = 'discount_type';
const COUPON_METADATA_VALUE = 'launch_single_pouch';
const PROMO_CODE_STRING     = 'DAVEN299';
const MAX_REDEMPTIONS       = 30;

async function findExistingCoupon() {
  // List all coupons and find the one with our metadata marker.
  // Stripe doesn't support filtering coupons by metadata, so we page through.
  let starting_after;
  while (true) {
    const params = { limit: 100 };
    if (starting_after) params.starting_after = starting_after;

    const page = await stripe.coupons.list(params);
    for (const coupon of page.data) {
      if (coupon.metadata?.[COUPON_METADATA_KEY] === COUPON_METADATA_VALUE) {
        return coupon;
      }
    }
    if (!page.has_more) break;
    starting_after = page.data[page.data.length - 1].id;
  }
  return null;
}

async function findExistingPromoCode(couponId) {
  // List promotion codes for the coupon and find "DAVEN299".
  let starting_after;
  while (true) {
    const params = { coupon: couponId, limit: 100, code: PROMO_CODE_STRING };
    if (starting_after) params.starting_after = starting_after;

    const page = await stripe.promotionCodes.list(params);
    for (const promoCode of page.data) {
      if (promoCode.code === PROMO_CODE_STRING) {
        return promoCode;
      }
    }
    if (!page.has_more) break;
    if (page.data.length > 0) {
      starting_after = page.data[page.data.length - 1].id;
    } else {
      break;
    }
  }
  return null;
}

async function main() {
  const mode = secretKey.startsWith('sk_live_') ? 'LIVE' : 'TEST';
  console.log(`\nStripe mode: ${mode}`);
  console.log('─'.repeat(40));

  // ── Step 1: Coupon ──────────────────────────────────────────────
  let coupon = await findExistingCoupon();

  if (coupon) {
    console.log(`✓ Coupon already exists — reusing.`);
    console.log(`  Coupon ID:   ${coupon.id}`);
    console.log(`  Name:        ${coupon.name}`);
    console.log(`  Amount off:  $${(coupon.amount_off / 100).toFixed(2)}`);
  } else {
    coupon = await stripe.coupons.create({
      name:       'Kavanah Pouch Launch Discount - $2.99 Off',
      amount_off: 299,
      currency:   'usd',
      duration:   'once',
      metadata: {
        product:        'kavanah_pouch',
        discount_type:  'launch_single_pouch',
        intended_for:   'single_pouch_only',
      },
    });
    console.log(`✓ Coupon created.`);
    console.log(`  Coupon ID:   ${coupon.id}`);
    console.log(`  Name:        ${coupon.name}`);
    console.log(`  Amount off:  $${(coupon.amount_off / 100).toFixed(2)}`);
  }

  // ── Step 2: Promotion code ──────────────────────────────────────
  let promoCode = await findExistingPromoCode(coupon.id);

  if (promoCode) {
    console.log(`\n✓ Promotion code already exists — reusing.`);
    console.log(`  Promo Code ID: ${promoCode.id}`);
    console.log(`  Code:          ${promoCode.code}`);
    console.log(`  Active:        ${promoCode.active}`);
    console.log(`  Max redeem:    ${promoCode.max_redemptions ?? 'unlimited'}`);
    console.log(`  Times redeemed: ${promoCode.times_redeemed}`);
  } else {
    promoCode = await stripe.promotionCodes.create({
      coupon:           coupon.id,
      code:             PROMO_CODE_STRING,
      max_redemptions:  MAX_REDEMPTIONS,
      active:           true,
      metadata: {
        product:     'kavanah_pouch',
        restriction: 'single_pouch_only',
      },
    });
    console.log(`\n✓ Promotion code created.`);
    console.log(`  Promo Code ID: ${promoCode.id}`);
    console.log(`  Code:          ${promoCode.code}`);
    console.log(`  Active:        ${promoCode.active}`);
    console.log(`  Max redeem:    ${promoCode.max_redemptions}`);
  }

  console.log('\n─'.repeat(40));
  console.log('Setup complete.\n');
  console.log(`COUPON_ID:     ${coupon.id}`);
  console.log(`PROMO_CODE_ID: ${promoCode.id}`);
  console.log(`\nCustomers enter "${PROMO_CODE_STRING}" at Stripe Checkout for $2.99 off (first ${MAX_REDEMPTIONS} single-pouch orders).`);
}

main().catch(err => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
