const db = require('../db');
const config = require('../config');

function escCsv(val) {
  if (val == null) return '';
  const s = String(val);
  if (s.includes(',') || s.includes('"') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

function row(fields) {
  return fields.map(escCsv).join(',');
}

async function exportPirateShipCsv() {
  const { rows: orders } = await db.query(
    `SELECT o.*,
       COALESCE(SUM(oi.quantity_pouches), 0) AS total_pouches
     FROM orders o
     LEFT JOIN order_items oi ON oi.order_id = o.id
     WHERE o.payment_status = 'paid'
       AND o.fulfillment_status = 'unfulfilled'
     GROUP BY o.id
     ORDER BY o.created_at ASC`
  );

  if (orders.length === 0) return { csv: '', orderIds: [] };

  const headers = [
    'Name', 'Email', 'Address 1', 'Address 2',
    'City', 'State', 'Zip', 'Country',
    'Order Number', 'Quantity',
    'Package Weight Oz', 'Package Length', 'Package Width', 'Package Height',
  ];

  const lines = [headers.join(',')];
  const { weightOz, lengthIn, widthIn, heightIn } = config.packaging;

  for (const o of orders) {
    lines.push(row([
      o.shipping_name || o.customer_name || '',
      o.customer_email,
      o.shipping_address_line1 || '',
      o.shipping_address_line2 || '',
      o.shipping_city || '',
      o.shipping_state || '',
      o.shipping_postal_code || '',
      o.shipping_country || 'US',
      o.order_number,
      o.total_pouches,
      weightOz * o.total_pouches,
      lengthIn,
      widthIn,
      heightIn,
    ]));
  }

  const orderIds = orders.map(o => o.id);

  // Mark orders as exported
  await db.query(
    `UPDATE orders
     SET fulfillment_status = 'exported',
         pirate_ship_exported_at = NOW(),
         updated_at = NOW()
     WHERE id = ANY($1::int[])`,
    [orderIds]
  );

  return { csv: lines.join('\n'), orderIds };
}

module.exports = { exportPirateShipCsv };
