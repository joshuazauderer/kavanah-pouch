const db = require('../db');

async function getInventory() {
  const { rows } = await db.query(`
    SELECT i.*, p.sku, p.name
    FROM inventory i
    JOIN products p ON p.id = i.product_id
    WHERE p.sku = 'KAVANAH-POUCH'
    LIMIT 1
  `);
  return rows[0] || null;
}

async function isAvailable(quantityNeeded) {
  const inv = await getInventory();
  if (!inv) return false;
  return inv.quantity_available >= quantityNeeded;
}

/**
 * Decrement inventory within a provided client (for use inside transactions).
 * Logs the adjustment to inventory_adjustments.
 * @param {object} client - pg transaction client
 * @param {number} quantityNeeded - number of pouches to decrement
 * @param {number|null} orderId - order ID for audit log (optional)
 */
async function decrementInventory(client, quantityNeeded, orderId = null) {
  // Get current quantity before decrement (for audit log)
  const { rows: before } = await client.query(
    `SELECT quantity_available
     FROM inventory
     WHERE product_id = (SELECT id FROM products WHERE sku = 'KAVANAH-POUCH')
     LIMIT 1`
  );
  if (!before.length) throw new Error('Inventory record not found');
  const previousQty = before[0].quantity_available;

  const { rows } = await client.query(
    `UPDATE inventory
     SET quantity_available = quantity_available - $1,
         updated_at = NOW()
     WHERE product_id = (SELECT id FROM products WHERE sku = 'KAVANAH-POUCH')
       AND quantity_available >= $1
     RETURNING quantity_available`,
    [quantityNeeded]
  );

  if (rows.length === 0) {
    throw new Error('Insufficient inventory');
  }

  const newQty = rows[0].quantity_available;

  // Audit log
  await client.query(
    `INSERT INTO inventory_adjustments
       (sku, adjustment_amount, reason, order_id, previous_quantity, new_quantity)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    ['KAVANAH-POUCH', -quantityNeeded, 'order', orderId, previousQty, newQty]
  );

  return newQty;
}

/**
 * Set inventory to a specific quantity (admin action).
 * Logs the adjustment to inventory_adjustments.
 * @param {number} quantity
 * @param {number} lowStockThreshold
 * @param {string} reason - e.g. 'admin_set', 'restock', 'correction'
 */
async function setInventory(quantity, lowStockThreshold, reason = 'admin_set') {
  const inv = await getInventory();
  const previousQty = inv ? inv.quantity_available : 0;

  await db.query(
    `UPDATE inventory
     SET quantity_available = $1,
         low_stock_threshold = $2,
         updated_at = NOW()
     WHERE product_id = (SELECT id FROM products WHERE sku = 'KAVANAH-POUCH')`,
    [quantity, lowStockThreshold]
  );

  // Audit log
  await db.query(
    `INSERT INTO inventory_adjustments
       (sku, adjustment_amount, reason, order_id, previous_quantity, new_quantity)
     VALUES ($1, $2, $3, NULL, $4, $5)`,
    ['KAVANAH-POUCH', quantity - previousQty, reason, previousQty, quantity]
  );
}

module.exports = { getInventory, isAvailable, decrementInventory, setInventory };
