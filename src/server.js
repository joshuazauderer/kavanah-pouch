require('dotenv').config();
const express = require('express');
const session = require('express-session');
const connectPgSimple = require('connect-pg-simple');
const path = require('path');
const config = require('./config');
const { pool } = require('./db');
const { errorHandler } = require('./middleware/errorHandler');

const PgSession = connectPgSimple(session);

const app = express();

// ── Trust proxy (Coolify/nginx sits in front) ─────────────────────────────────
app.set('trust proxy', 1);

// ── Webhook route MUST come before body parsers ───────────────────────────────
const webhookRoutes = require('./routes/webhookRoutes');
app.use(webhookRoutes);

// ── Body parsers ──────────────────────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Session ───────────────────────────────────────────────────────────────────
app.use(
  session({
    store: new PgSession({
      pool,
      tableName: 'session',
      createTableIfMissing: true,
    }),
    secret: config.session.secret,
    resave: false,
    saveUninitialized: false,
    cookie: {
      secure: config.session.secure,
      httpOnly: true,
      maxAge: 8 * 60 * 60 * 1000, // 8 hours
      sameSite: 'lax',
    },
  })
);

// ── Static files ──────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, '../public'), {
  index: false, // Let the route handle /
}));

// ── Routes ────────────────────────────────────────────────────────────────────
app.use(require('./routes/analyticsRoutes'));
app.use(require('./routes/checkoutRoutes'));
app.use(require('./routes/formRoutes'));
app.use(require('./routes/adminRoutes'));
app.use(require('./routes/publicRoutes'));

// Serve index.html for the root (after static so assets work)
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '../public/index.html'));
});

// ── Error handler ─────────────────────────────────────────────────────────────
app.use(errorHandler);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`Kavanah Pouch running on port ${config.port} [${config.env}]`);
});

module.exports = app;
