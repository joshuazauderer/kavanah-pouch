const db = require('../db');

/**
 * Get a single admin setting by key.
 * Returns the string value, or `defaultValue` if not found.
 */
async function getSetting(key, defaultValue = null) {
  const { rows } = await db.query(
    'SELECT value FROM admin_settings WHERE key = $1',
    [key]
  );
  return rows[0]?.value ?? defaultValue;
}

/**
 * Get all admin settings as a plain object { key: value }.
 */
async function getAllSettings() {
  const { rows } = await db.query('SELECT key, value FROM admin_settings ORDER BY key');
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

/**
 * Upsert one or more settings.  Pass an object { key: value, ... }.
 */
async function setSettings(updates) {
  for (const [key, value] of Object.entries(updates)) {
    await db.query(
      `INSERT INTO admin_settings (key, value, updated_at)
         VALUES ($1, $2, NOW())
       ON CONFLICT (key)
       DO UPDATE SET value = $2, updated_at = NOW()`,
      [key, String(value)]
    );
  }
}

module.exports = { getSetting, getAllSettings, setSettings };
