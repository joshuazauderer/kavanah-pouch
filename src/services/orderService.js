const db = require('../db');
const { decrementInventory } = require('./inventoryService');
const config = require('../config');

function generateOrderNumber() {
  const ts = Date.now().toString(36).toUpperCase();
  const rand = Math.random().toString(36).slice(2, 6).toUpperCase();
  return `KP-${ts}-${rand}`;
}

async function createOrderFromStripe(session) {
  const client = await db.getClient();
  try {
    await client.query('BEGIN');

    // Idempotency: skip if already saved
    const existing = await client.query(
      'SELECT id FROM orders WHERE stripe_checkout_session_id = $1',
      [session.id]
    );
    if (existing.rows.length > 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const priceKey = session.metadata?.priceKey || 'one_pouch';
    const isGift = session.metadata?.is_gift === 'true';
    const giftRecipientName = session.metadata?.gift_recipient_name || null;
    const giftMessage = session.metadata?.gift_message || null;
    const pouchesPerPack = config.stripe.pouchesPerPack;
    const quantityPouches = pouchesPerPack[priceKey] || 1;

    // Stripe moved the shipping address to collected_information.shipping_details in newer API versions.
    // Fall back through the chain to handle both old and new webhook payloads.
    const shipping = session.collected_information?.shipping_details
      || session.shipping_details
      || {};
    const addr = shipping.address || session.customer_details?.address || {};
    const customerName = shipping.name || session.customer_details?.name || null;

    const orderNumber = generateOrderNumber();

    const subtotalCents    = session.amount_subtotal ?? (session.amount_total || 0);
    const shippingCents    = session.total_details?.amount_shipping ?? 0;
    const taxCents         = session.total_details?.amount_tax ?? 0;
    const discountCents    = session.total_details?.amount_discount ?? 0;
    const totalCents       = session.amount_total || 0;

    // Extract the human-readable promotion code string if the session was
    // retrieved with expand: ['discounts.discount.promotion_code'].
    // Falls back to the coupon name, then null, if expansion wasn't done.
    let discountCode = null;
    const firstDiscount = session.discounts?.[0];
    if (firstDiscount) {
      const discountObj = typeof firstDiscount.discount === 'object'
        ? firstDiscount.discount
        : null;
      if (discountObj?.promotion_code && typeof discountObj.promotion_code === 'object') {
        discountCode = discountObj.promotion_code.code || null;
      } else if (discountObj?.coupon?.name) {
        discountCode = discountObj.coupon.name;
      }
    }

    const { rows: [order] } = await client.query(
      `INSERT INTO orders (
        order_number, stripe_checkout_session_id, stripe_payment_intent_id,
        customer_email, customer_name,
        shipping_name, shipping_address_line1, shipping_address_line2,
        shipping_city, shipping_state, shipping_postal_code, shipping_country,
        subtotal_cents, shipping_cents, tax_cents, discount_amount_cents,
        discount_code, total_cents,
        currency, payment_status, fulfillment_status,
        is_gift, gift_recipient_name, gift_message
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,'paid','unfulfilled',$20,$21,$22)
      RETURNING *`,
      [
        orderNumber,
        session.id,
        session.payment_intent || null,
        session.customer_details?.email || '',
        customerName,
        customerName,
        addr.line1 || null,
        addr.line2 || null,
        addr.city || null,
        addr.state || null,
        addr.postal_code || null,
        addr.country || null,
        subtotalCents,
        shippingCents,
        taxCents,
        discountCents,
        discountCode,
        totalCents,
        session.currency || 'usd',
        isGift,
        giftRecipientName,
        giftMessage,
      ]
    );

    // Insert order item
    const priceNames = {
      one_pouch:  '1 Kavanah Pouch',
      two_pack:   '2-Pack Kavanah Pouch',
      three_pack: '3-Pack Kavanah Pouch',
    };

    const { rows: [product] } = await client.query(
      `SELECT id FROM products WHERE sku = 'KAVANAH-POUCH' LIMIT 1`
    );

    await client.query(
      `INSERT INTO order_items
        (order_id, product_id, sku, name, pack_type, quantity_pouches, quantity_packs,
         unit_amount_cents, total_amount_cents)
       VALUES ($1,$2,$3,$4,$5,$6,1,$7,$8)`,
      [
        order.id,
        product.id,
        'KAVANAH-POUCH',
        priceNames[priceKey] || 'Kavanah Pouch',
        priceKey,
        quantityPouches,
        subtotalCents,
        subtotalCents,
      ]
    );

    // Decrement inventory (inside transaction) — idempotent via transaction + unique session check above
    await decrementInventory(client, quantityPouches, order.id);

    // Record that inventory was decremented for this order (belt-and-suspenders guard)
    await client.query(
      `UPDATE orders SET inventory_decremented_at = NOW() WHERE id = $1`,
      [order.id]
    );

    await client.query('COMMIT');
    return order;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function getOrders(filters = {}) {
  let where = '1=1';
  const params = [];
  if (filters.payment_status) {
    params.push(filters.payment_status);
    where += ` AND o.payment_status = $${params.length}`;
  }
  if (filters.fulfillment_status) {
    params.push(filters.fulfillment_status);
    where += ` AND o.fulfillment_status = $${params.length}`;
  }

  const { rows } = await db.query(
    `SELECT o.*,
       COALESCE(SUM(oi.quantity_pouches), 0) AS total_pouches
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE ${where}
     GROUP BY o.id
     ORDER BY o.created_at DESC`,
    params
  );
  return rows;
}

async function getOrderById(id) {
  const { rows: [order] } = await db.query(
    'SELECT * FROM orders WHERE id = $1',
    [id]
  );
  if (!order) return null;
  const { rows: items } = await db.query(
    'SELECT * FROM order_items WHERE order_id = $1',
    [id]
  );
  return { ...order, items };
}

async function updateOrderTracking(id, {
  tracking_number, tracking_carrier, tracking_url,
  shipping_service, shipped_at, admin_notes, fulfillment_status,
}) {
  const { rows: [order] } = await db.query(
    `UPDATE orders
     SET tracking_number   = COALESCE($1, tracking_number),
         tracking_carrier  = COALESCE($2, tracking_carrier),
         tracking_url      = COALESCE($3, tracking_url),
         shipping_service  = COALESCE($4, shipping_service),
         shipped_at        = COALESCE($5, shipped_at),
         admin_notes       = COALESCE($6, admin_notes),
         fulfillment_status = COALESCE($7, fulfillment_status),
         updated_at        = NOW()
     WHERE id = $8
     RETURNING *`,
    [
      tracking_number || null,
      tracking_carrier || null,
      tracking_url || null,
      shipping_service || null,
      shipped_at || null,
      admin_notes || null,
      fulfillment_status || null,
      id,
    ]
  );
  return order;
}

/**
 * Mark an order as shipped.  Validates payment status and required fields.
 * Does NOT send a shipping email — Pirate Ship handles that.
 */
async function markOrderShipped(id, {
  tracking_number, tracking_carrier, shipping_service, shipped_at, admin_notes,
}) {
  if (!tracking_number) throw new Error('Tracking number is required');
  if (!tracking_carrier) throw new Error('Carrier is required');
  if (!shipping_service) throw new Error('Shipping service is required');
  if (!shipped_at) throw new Error('Ship date is required');

  // Check payment status
  const { rows: [existing] } = await db.query(
    'SELECT payment_status FROM orders WHERE id = $1',
    [id]
  );
  if (!existing) throw new Error('Order not found');
  if (existing.payment_status !== 'paid') {
    throw new Error('Cannot mark unpaid order as shipped');
  }

  // Build USPS tracking URL if carrier is USPS and no URL provided
  const trackingUrl = tracking_carrier === 'USPS'
    ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking_number)}`
    : null;

  const { rows: [order] } = await db.query(
    `UPDATE orders
     SET tracking_number   = $1,
         tracking_carrier  = $2,
         tracking_url      = COALESCE($3, tracking_url),
         shipping_service  = $4,
         shipped_at        = $5,
         admin_notes       = COALESCE($6, admin_notes),
         fulfillment_status = 'shipped',
         updated_at        = NOW()
     WHERE id = $7
     RETURNING *`,
    [
      tracking_number,
      tracking_carrier,
      trackingUrl,
      shipping_service,
      new Date(shipped_at),
      admin_notes || null,
      id,
    ]
  );
  return order;
}

async function updateOrderStatus(id, { payment_status, fulfillment_status }) {
  const { rows: [order] } = await db.query(
    `UPDATE orders
     SET payment_status = COALESCE($1, payment_status),
         fulfillment_status = COALESCE($2, fulfillment_status),
         updated_at = NOW()
     WHERE id = $3
     RETURNING *`,
    [payment_status, fulfillment_status, id]
  );
  return order;
}

async function getDashboardStats() {
  const { rows: [stats] } = await db.query(`
    SELECT
      COUNT(*) FILTER (WHERE payment_status = 'paid') AS total_paid,
      COUNT(*) FILTER (WHERE payment_status = 'paid' AND fulfillment_status = 'unfulfilled') AS unfulfilled,
      COUNT(*) FILTER (WHERE payment_status = 'paid' AND fulfillment_status = 'exported') AS exported,
      COUNT(*) FILTER (WHERE fulfillment_status = 'shipped') AS shipped
    FROM orders
  `);

  const { rows: [invRow] } = await db.query(
    `SELECT quantity_available FROM inventory
     JOIN products ON products.id = inventory.product_id
     WHERE products.sku = 'KAVANAH-POUCH'`
  );

  const { rows: [waitlistRow] } = await db.query('SELECT COUNT(*) AS cnt FROM waitlist_signups');
  const { rows: [bulkRow] } = await db.query(`SELECT COUNT(*) AS cnt FROM bulk_inquiries WHERE status = 'new'`);
  const { rows: [supportRow] } = await db.query(`SELECT COUNT(*) AS cnt FROM support_messages WHERE status = 'new'`);

  return {
    ...stats,
    inventory: invRow?.quantity_available ?? 0,
    waitlist_count: parseInt(waitlistRow.cnt, 10),
    new_bulk_inquiries: parseInt(bulkRow.cnt, 10),
    new_support_messages: parseInt(supportRow.cnt, 10),
  };
}

module.exports = {
  createOrderFromStripe,
  getOrders,
  getOrderById,
  updateOrderTracking,
  markOrderShipped,
  updateOrderStatus,
  getDashboardStats,
};
