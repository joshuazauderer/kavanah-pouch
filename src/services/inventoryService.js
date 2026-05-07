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

// Decrement within a provided client (for use inside transactions)
async function decrementInventory(client, quantityNeeded) {
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
  return rows[0].quantity_available;
}

async function setInventory(quantity, lowStockThreshold) {
  await db.query(
    `UPDATE inventory
     SET quantity_available = $1,
         low_stock_threshold = $2,
         updated_at = NOW()
     WHERE product_id = (SELECT id FROM products WHERE sku = 'KAVANAH-POUCH')`,
    [quantity, lowStockThreshold]
  );
}

module.exports = { getInventory, isAvailable, decrementInventory, setInventory };
