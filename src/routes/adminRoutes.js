const express = require('express');
const rateLimit = require('express-rate-limit');
const bcrypt = require('bcrypt');
const path = require('path');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const { requireAdmin } = require('../middleware/adminAuth');
const {
  getOrders, getOrderById, updateOrderTracking,
  updateOrderStatus, getDashboardStats,
} = require('../services/orderService');
const { getInventory, setInventory } = require('../services/inventoryService');
const { exportPirateShipCsv } = require('../services/csvService');
const { sendOrderConfirmationEmail } = require('../services/emailService');

const router = express.Router();

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many login attempts. Try again in 15 minutes.',
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
    const { tracking_number, tracking_carrier, tracking_url } = req.body;
    const order = await updateOrderTracking(req.params.id, {
      tracking_number, tracking_carrier, tracking_url,
    });
    res.redirect(`/admin/orders/${req.params.id}?saved=1`);
  } catch (err) {
    res.redirect(`/admin/orders/${req.params.id}?error=1`);
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

module.exports = router;
