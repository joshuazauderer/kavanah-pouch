require('dotenv').config();
const bcrypt = require('bcrypt');
const { query } = require('./db');
const config = require('./config');

async function seedAdmin() {
  const email = process.env.ADMIN_EMAIL;
  const password = process.env.ADMIN_INITIAL_PASSWORD;

  if (!email || !password) {
    console.error('ADMIN_EMAIL and ADMIN_INITIAL_PASSWORD must be set in .env');
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 12);

  await query(
    `INSERT INTO admin_users (email, password_hash, role)
     VALUES ($1, $2, 'admin')
     ON CONFLICT (email) DO UPDATE SET password_hash = $2, updated_at = NOW()`,
    [email, hash]
  );

  console.log(`Admin user seeded: ${email}`);
  console.log('Remove ADMIN_INITIAL_PASSWORD from your environment after first login.');
  process.exit(0);
}

seedAdmin().catch(err => {
  console.error('Seed failed:', err.message);
  process.exit(1);
});
