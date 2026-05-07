require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { query } = require('./db');

async function runMigrations() {
  const migrationsDir = path.join(__dirname, '..', 'migrations');
  const files = fs.readdirSync(migrationsDir)
    .filter(f => f.endsWith('.sql'))
    .sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await query(sql);
    console.log(`  ✓ ${file}`);
  }

  console.log('All migrations complete.');
  process.exit(0);
}

runMigrations().catch(err => {
  console.error('Migration failed:', err.message);
  process.exit(1);
});
