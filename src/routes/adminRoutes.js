const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const crypto = require('crypto');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  getOrders, getOrderById, updateOrderTracking,
  markOrderShipped, updateOrderStatus, getDashboardStats,
} = require('../services/orderService');
const { getInventory, setInventory } = require('../services/inventoryService');
const { exportPirateShipCsv } = require('../services/csvService');
const { sendOrderConfirmationEmail, sendPasswordResetEmail } = require('../services/emailService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again in 15 minutes.',
});

const forgotPasswordLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests. Try again in 15 minutes.',
});

// ── Login ─────────────────────────────────────────────────────────────────────
router.get('/admin/login', (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '../../src/views/admin-login.html'));
});

router.post(
  '/admin/login',
  loginLimiter,
  body('email').isEmail().toLowerCase(),
  body('password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/admin/login?error=invalid');

    const { email, password } = req.body;
    try {
      const { rows: [user] } = await db.query(
        'SELECT * FROM admin_users WHERE email = $1 LIMIT 1',
        [email]
      );
      if (!user) return res.redirect('/admin/login?error=invalid');

      const match = await bcrypt.compare(password, user.password_hash);
      if (!match) return res.redirect('/admin/login?error=invalid');

      req.session.adminId = user.id;
      req.session.adminEmail = user.email;
      req.session.adminRole = user.role;
      req.session.save(() => res.redirect('/admin'));
    } catch (err) {
      console.error('Login error:', err.message);
      res.redirect('/admin/login?error=server');
    }
  }
);

router.post('/admin/logout', requireAdmin, (req, res) => {
  req.session.destroy(() => res.redirect('/admin/login'));
});

// ── Dashboard ─────────────────────────────────────────────────────────────────
router.get('/admin', requireAdmin, async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.sendFile(path.join(__dirname, '../../src/views/admin-dashboard.html'));
  } catch (err) {
    res.status(500).send('Dashboard error: ' + err.message);
  }
});

// JSON API for dashboard stats (loaded by the HTML via fetch)
router.get('/admin/api/stats', requireAdmin, async (req, res) => {
  try {
    const stats = await getDashboardStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Orders ────────────────────────────────────────────────────────────────────
router.get('/admin/orders', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-orders.html'));
});

router.get('/admin/api/orders', requireAdmin, async (req, res) => {
  try {
    const { payment_status, fulfillment_status } = req.query;
    const orders = await getOrders({ payment_status, fulfillment_status });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/orders/export/pirate-ship.csv', requireAdmin, async (req, res) => {
  try {
    const { csv, orderIds } = await exportPirateShipCsv();
    if (!csv) {
      return res.status(200).send('No unfulfilled paid orders to export.');
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="pirate-ship-${Date.now()}.csv"`);
    res.send(csv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/admin/orders/:id', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-order-detail.html'));
});

router.get('/admin/api/orders/:id', requireAdmin, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/orders/:id/tracking', requireAdmin, async (req, res) => {
  try {
    const {
      tracking_number, tracking_carrier, tracking_url,
      shipping_service, shipped_at, admin_notes,
    } = req.body;
    await updateOrderTracking(req.params.id, {
      tracking_number: tracking_number || null,
      tracking_carrier: tracking_carrier || null,
      tracking_url: tracking_url || null,
      shipping_service: shipping_service || null,
      shipped_at: shipped_at || null,
      admin_notes: admin_notes || null,
    });
    res.redirect(`/admin/orders/${req.params.id}?saved=1`);
  } catch (err) {
    console.error('Update tracking error:', err.message);
    res.redirect(`/admin/orders/${req.params.id}?error=1`);
  }
});

// Mark an order as shipped (validates payment, required fields; does NOT send email)
router.post('/admin/orders/:id/mark-shipped', requireAdmin, async (req, res) => {
  try {
    const { tracking_number, tracking_carrier, shipping_service, shipped_at, admin_notes } = req.body;
    await markOrderShipped(req.params.id, {
      tracking_number, tracking_carrier, shipping_service, shipped_at, admin_notes,
    });
    // Respond with JSON for the modal (called via fetch from orders list)
    if (req.headers['content-type']?.includes('application/json') ||
        req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.json({ ok: true });
    }
    res.redirect(`/admin/orders/${req.params.id}?saved=1`);
  } catch (err) {
    console.error('Mark shipped error:', err.message);
    if (req.headers['content-type']?.includes('application/json') ||
        req.headers['x-requested-with'] === 'XMLHttpRequest') {
      return res.status(400).json({ error: err.message });
    }
    res.redirect(`/admin/orders/${req.params.id}?error=${encodeURIComponent(err.message)}`);
  }
});

router.post('/admin/orders/:id/status', requireAdmin, async (req, res) => {
  try {
    const { payment_status, fulfillment_status } = req.body;
    await updateOrderStatus(req.params.id, { payment_status, fulfillment_status });
    res.redirect(`/admin/orders/${req.params.id}?saved=1`);
  } catch (err) {
    res.redirect(`/admin/orders/${req.params.id}?error=1`);
  }
});

// ── Inventory ─────────────────────────────────────────────────────────────────
router.get('/admin/inventory', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-inventory.html'));
});

router.get('/admin/api/inventory', requireAdmin, async (req, res) => {
  try {
    const inv = await getInventory();
    res.json(inv);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/inventory', requireAdmin, async (req, res) => {
  const quantity = parseInt(req.body.quantity_available, 10);
  const threshold = parseInt(req.body.low_stock_threshold, 10);
  if (isNaN(quantity) || isNaN(threshold)) {
    return res.redirect('/admin/inventory?error=invalid');
  }
  try {
    await setInventory(quantity, threshold);
    res.redirect('/admin/inventory?saved=1');
  } catch (err) {
    res.redirect('/admin/inventory?error=1');
  }
});

// ── Waitlist ──────────────────────────────────────────────────────────────────
router.get('/admin/waitlist', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-waitlist.html'));
});

router.get('/admin/api/waitlist', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM waitlist_signups ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Bulk Inquiries ────────────────────────────────────────────────────────────
router.get('/admin/bulk-inquiries', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-inquiries.html'));
});

router.get('/admin/api/bulk-inquiries', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM bulk_inquiries ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/bulk-inquiries/:id/status', requireAdmin, async (req, res) => {
  try {
    await db.query(
      'UPDATE bulk_inquiries SET status = $1, updated_at = NOW() WHERE id = $2',
      [req.body.status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Support ───────────────────────────────────────────────────────────────────
router.get('/admin/support', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-support.html'));
});

router.get('/admin/api/support', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM support_messages ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/support/:id/status', requireAdmin, async (req, res) => {
  try {
    await db.query(
      'UPDATE support_messages SET status = $1, updated_at = NOW() WHERE id = $2',
      [req.body.status, req.params.id]
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Feedback ──────────────────────────────────────────────────────────────────
router.get('/admin/feedback', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-feedback.html'));
});

router.get('/admin/api/feedback', requireAdmin, async (req, res) => {
  try {
    const { rows } = await db.query(
      'SELECT * FROM feedback_messages ORDER BY created_at DESC'
    );
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Resend order confirmation email
router.post('/admin/orders/:id/resend-confirmation', requireAdmin, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).json({ error: 'Order not found' });
    if (order.payment_status !== 'paid') {
      return res.status(400).json({ error: 'Cannot send confirmation for unpaid order' });
    }
    await sendOrderConfirmationEmail(order);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Settings (change password) ────────────────────────────────────────────────
router.get('/admin/settings', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-settings.html'));
});

router.post('/admin/settings/change-password', requireAdmin,
  body('current_password').notEmpty(),
  body('new_password').isLength({ min: 8 }),
  body('confirm_password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/admin/settings?error=invalid');

    const { current_password, new_password, confirm_password } = req.body;

    if (new_password !== confirm_password) {
      return res.redirect('/admin/settings?error=mismatch');
    }

    try {
      const { rows: [user] } = await db.query(
        'SELECT * FROM admin_users WHERE id = $1 LIMIT 1',
        [req.session.adminId]
      );
      if (!user) return res.redirect('/admin/settings?error=invalid');

      const match = await bcrypt.compare(current_password, user.password_hash);
      if (!match) return res.redirect('/admin/settings?error=wrong');

      const hash = await bcrypt.hash(new_password, 12);
      await db.query(
        'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hash, user.id]
      );

      res.redirect('/admin/settings?saved=1');
    } catch (err) {
      console.error('Change password error:', err.message);
      res.redirect('/admin/settings?error=server');
    }
  }
);

// ── Forgot password ───────────────────────────────────────────────────────────
router.get('/admin/forgot-password', (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin');
  res.sendFile(path.join(__dirname, '../../src/views/admin-forgot-password.html'));
});

router.post('/admin/forgot-password', forgotPasswordLimiter, async (req, res) => {
  const { email } = req.body;
  // Always show success to prevent email enumeration
  const successRedirect = () => res.redirect('/admin/forgot-password?sent=1');

  if (!email) return successRedirect();

  try {
    const { rows: [user] } = await db.query(
      'SELECT * FROM admin_users WHERE email = $1 LIMIT 1',
      [email.toLowerCase().trim()]
    );
    if (!user) return successRedirect();

    // Invalidate any existing unused tokens for this user
    await db.query(
      'UPDATE password_reset_tokens SET used = true WHERE admin_user_id = $1 AND used = false',
      [user.id]
    );

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    await db.query(
      'INSERT INTO password_reset_tokens (admin_user_id, token, expires_at) VALUES ($1, $2, $3)',
      [user.id, token, expiresAt]
    );

    const baseUrl = process.env.APP_BASE_URL || 'https://kavanahpouch.com';
    const resetUrl = `${baseUrl}/admin/reset-password/${token}`;

    await sendPasswordResetEmail(user.email, resetUrl);
  } catch (err) {
    console.error('Forgot password error:', err.message);
  }

  successRedirect();
});

router.get('/admin/reset-password/:token', async (req, res) => {
  if (req.session?.adminId) return res.redirect('/admin');
  try {
    const { rows: [record] } = await db.query(
      `SELECT * FROM password_reset_tokens
       WHERE token = $1 AND used = false AND expires_at > NOW() LIMIT 1`,
      [req.params.token]
    );
    if (!record) return res.redirect('/admin/forgot-password?error=expired');
    res.sendFile(path.join(__dirname, '../../src/views/admin-reset-password.html'));
  } catch (err) {
    res.redirect('/admin/forgot-password?error=server');
  }
});

router.post('/admin/reset-password/:token',
  body('new_password').isLength({ min: 8 }),
  body('confirm_password').notEmpty(),
  async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.redirect(`/admin/reset-password/${req.params.token}?error=invalid`);
    }

    const { new_password, confirm_password } = req.body;
    if (new_password !== confirm_password) {
      return res.redirect(`/admin/reset-password/${req.params.token}?error=mismatch`);
    }

    try {
      const { rows: [record] } = await db.query(
        `SELECT * FROM password_reset_tokens
         WHERE token = $1 AND used = false AND expires_at > NOW() LIMIT 1`,
        [req.params.token]
      );
      if (!record) return res.redirect('/admin/forgot-password?error=expired');

      const hash = await bcrypt.hash(new_password, 12);
      await db.query(
        'UPDATE admin_users SET password_hash = $1, updated_at = NOW() WHERE id = $2',
        [hash, record.admin_user_id]
      );
      await db.query(
        'UPDATE password_reset_tokens SET used = true WHERE id = $1',
        [record.id]
      );

      res.redirect('/admin/login?reset=1');
    } catch (err) {
      console.error('Reset password error:', err.message);
      res.redirect(`/admin/reset-password/${req.params.token}?error=server`);
    }
  }
);

module.exports = router;
