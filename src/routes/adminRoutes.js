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
const {
  sendOrderConfirmationEmail, sendPasswordResetEmail,
  sendBulkQuoteEmail, sendBulkInvoiceEmail,
  sendBulkPaymentReceivedEmail, sendBulkShippingConfirmationEmail,
} = require('../services/emailService');
const {
  getSummary, getDailyStats, getTopReferrers, getTopPages,
  getDeviceBreakdown, getFunnel, getRecentEvents, getUtmStats, getCouponStats,
} = require('../services/analyticsService');
const { getSetting, getAllSettings, setSettings } = require('../services/settingsService');
const { renderPackingSlipDocument } = require('../services/packingSlipService');
const { stripe } = require('../services/stripeService');

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

// Full update: status + admin notes + quoted amounts + converted flag
router.post('/admin/bulk-inquiries/:id/update', requireAdmin, async (req, res) => {
  try {
    const {
      status, admin_notes, quoted_shipping_cents, quoted_total_cents, converted_to_order,
    } = req.body;

    const shippingCents = quoted_shipping_cents !== '' && quoted_shipping_cents != null
      ? parseInt(quoted_shipping_cents, 10) || null
      : null;
    const totalCents = quoted_total_cents !== '' && quoted_total_cents != null
      ? parseInt(quoted_total_cents, 10) || null
      : null;
    const converted = converted_to_order === 'true' || converted_to_order === true;

    const { rows: [inq] } = await db.query(
      `UPDATE bulk_inquiries
       SET status                  = COALESCE($1, status),
           admin_notes             = $2,
           quoted_shipping_cents   = $3,
           quoted_total_cents      = $4,
           converted_to_order      = $5,
           updated_at              = NOW()
       WHERE id = $6
       RETURNING *`,
      [status || null, admin_notes || null, shippingCents, totalCents, converted, req.params.id]
    );
    res.json({ ok: true, inquiry: inq });
  } catch (err) {
    console.error('Bulk inquiry update error:', err.message);
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

// ── Bulk Inquiry detail (must be before /:id catch-all) ──────────────────────
router.get('/admin/bulk-inquiries/:id', requireAdmin, async (req, res) => {
  // Serve the detail page HTML (data loaded via /admin/api/bulk-inquiries/:id)
  const idNum = parseInt(req.params.id, 10);
  if (isNaN(idNum)) return res.redirect('/admin/bulk-inquiries');
  res.sendFile(path.join(__dirname, '../../src/views/admin-bulk-detail.html'));
});

router.get('/admin/api/bulk-inquiries/:id', requireAdmin, async (req, res) => {
  try {
    const { rows: [inq] } = await db.query(
      'SELECT * FROM bulk_inquiries WHERE id = $1',
      [req.params.id]
    );
    if (!inq) return res.status(404).json({ error: 'Not found' });
    res.json(inq);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Full update for bulk inquiry
router.post('/admin/bulk-inquiries/:id/update-detail', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const {
      status, admin_notes,
      quantity_pouches,
      quoted_bundle_cents, quoted_shipping_cents, quoted_total_cents,
      shipping_name, shipping_address_line1, shipping_address_line2,
      shipping_city, shipping_state, shipping_postal_code, shipping_country,
    } = req.body;

    const toInt = v => (v !== '' && v != null) ? parseInt(v, 10) || null : null;
    const toStr = v => (v != null && v !== '') ? String(v) : null;

    const { rows: [inq] } = await db.query(
      `UPDATE bulk_inquiries
       SET status                  = COALESCE($1, status),
           admin_notes             = $2,
           quantity_pouches        = $3,
           quoted_bundle_cents     = $4,
           quoted_shipping_cents   = $5,
           quoted_total_cents      = $6,
           shipping_name           = $7,
           shipping_address_line1  = $8,
           shipping_address_line2  = $9,
           shipping_city           = $10,
           shipping_state          = $11,
           shipping_postal_code    = $12,
           shipping_country        = $13,
           updated_at              = NOW()
       WHERE id = $14
       RETURNING *`,
      [
        toStr(status),
        toStr(admin_notes),
        toInt(quantity_pouches),
        toInt(quoted_bundle_cents),
        toInt(quoted_shipping_cents),
        toInt(quoted_total_cents),
        toStr(shipping_name),
        toStr(shipping_address_line1),
        toStr(shipping_address_line2),
        toStr(shipping_city),
        toStr(shipping_state),
        toStr(shipping_postal_code),
        toStr(shipping_country) || 'US',
        id,
      ]
    );
    if (!inq) return res.status(404).json({ error: 'Not found' });
    res.json({ ok: true, inquiry: inq });
  } catch (err) {
    console.error('Bulk detail update error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Create / resend Stripe Invoice
router.post('/admin/bulk-inquiries/:id/send-invoice', requireAdmin, async (req, res) => {
  try {
    const id = req.params.id;
    const { rows: [inq] } = await db.query('SELECT * FROM bulk_inquiries WHERE id = $1', [id]);
    if (!inq) return res.status(404).json({ error: 'Inquiry not found' });
    if (!inq.quoted_total_cents) return res.status(400).json({ error: 'Set a quoted total before creating invoice' });

    // Create or reuse Stripe Customer
    let customerId = inq.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: inq.email,
        name:  inq.name || undefined,
        metadata: { bulk_inquiry_id: String(id) },
      });
      customerId = customer.id;
    }

    // If existing invoice is still open, fetch its hosted URL instead of creating a new one
    if (inq.stripe_invoice_id) {
      try {
        const existing = await stripe.invoices.retrieve(inq.stripe_invoice_id);
        if (existing.status === 'open') {
          // Just resend the email with the existing invoice
          const updatedInq = { ...inq, stripe_customer_id: customerId };
          await sendBulkInvoiceEmail(updatedInq);
          await db.query(
            `UPDATE bulk_inquiries SET email_invoice_sent_at = NOW(), updated_at = NOW() WHERE id = $1`,
            [id]
          );
          return res.json({ ok: true, invoiceUrl: existing.hosted_invoice_url, resent: true });
        }
      } catch (_) { /* invoice may have been voided or deleted */ }
    }

    // Build line items
    const lineItems = [];
    const qty = inq.quantity_pouches || inq.quantity_requested || 1;

    if (inq.quoted_bundle_cents) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Kavanah Pouch × ${qty}` },
          unit_amount: inq.quoted_bundle_cents,
        },
        quantity: 1,
      });
    } else {
      // Fallback: use total as single line item
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Kavanah Pouch Bulk Order × ${qty}` },
          unit_amount: inq.quoted_total_cents,
        },
        quantity: 1,
      });
    }

    if (inq.quoted_shipping_cents && inq.quoted_shipping_cents > 0) {
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: 'Shipping' },
          unit_amount: inq.quoted_shipping_cents,
        },
        quantity: 1,
      });
    }

    if (inq.is_dedication) {
      const orgName = inq.organization_name ? ` (${inq.organization_name})` : '';
      lineItems.push({
        price_data: {
          currency: 'usd',
          product_data: { name: `Dedication Inscription${orgName}` },
          unit_amount: 0,
        },
        quantity: 1,
      });
    }

    // Create the invoice
    const invoice = await stripe.invoices.create({
      customer: customerId,
      collection_method: 'send_invoice',
      days_until_due: 14,
      metadata: { bulk_inquiry_id: String(id) },
      auto_advance: false,
    });

    // Add line items
    for (const item of lineItems) {
      await stripe.invoiceItems.create({
        customer: customerId,
        invoice: invoice.id,
        ...item,
      });
    }

    // Finalize and get hosted URL
    const finalized = await stripe.invoices.finalizeInvoice(invoice.id);

    // Send the invoice (Stripe sends email; we also send our branded email)
    await stripe.invoices.sendInvoice(finalized.id);

    // Save to DB
    await db.query(
      `UPDATE bulk_inquiries
       SET stripe_customer_id     = $1,
           stripe_invoice_id      = $2,
           stripe_invoice_number  = $3,
           stripe_invoice_url     = $4,
           stripe_invoice_pdf     = $5,
           invoice_sent_at        = NOW(),
           email_invoice_sent_at  = NOW(),
           status                 = CASE WHEN status NOT IN ('paid','shipped','closed','canceled') THEN 'invoice_sent' ELSE status END,
           updated_at             = NOW()
       WHERE id = $6`,
      [
        customerId,
        finalized.id,
        finalized.number,
        finalized.hosted_invoice_url,
        finalized.invoice_pdf,
        id,
      ]
    );

    // Send branded email
    const updatedInq = {
      ...inq,
      stripe_customer_id: customerId,
      stripe_invoice_id: finalized.id,
      stripe_invoice_number: finalized.number,
      stripe_invoice_url: finalized.hosted_invoice_url,
      quoted_total_cents: inq.quoted_total_cents,
    };
    sendBulkInvoiceEmail(updatedInq).catch(err =>
      console.error('Bulk invoice email error:', err.message)
    );

    res.json({ ok: true, invoiceUrl: finalized.hosted_invoice_url });
  } catch (err) {
    console.error('Send invoice error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Send email templates
router.post('/admin/bulk-inquiries/:id/send-email', requireAdmin, async (req, res) => {
  try {
    const { type } = req.body;
    if (!type) return res.status(400).json({ error: 'Missing email type' });
    const { rows: [inq] } = await db.query('SELECT * FROM bulk_inquiries WHERE id = $1', [req.params.id]);
    if (!inq) return res.status(404).json({ error: 'Not found' });

    const updateField = {
      quote:    'email_quote_sent_at',
      invoice:  'email_invoice_sent_at',
      payment:  'email_payment_sent_at',
      shipping: 'email_shipping_sent_at',
    }[type];

    switch (type) {
      case 'quote':    await sendBulkQuoteEmail(inq); break;
      case 'invoice':  await sendBulkInvoiceEmail(inq); break;
      case 'payment':  await sendBulkPaymentReceivedEmail(inq); break;
      case 'shipping': await sendBulkShippingConfirmationEmail(inq); break;
      default: return res.status(400).json({ error: 'Unknown email type' });
    }

    if (updateField) {
      await db.query(
        `UPDATE bulk_inquiries SET ${updateField} = NOW(), updated_at = NOW() WHERE id = $1`,
        [req.params.id]
      );
    }

    res.json({ ok: true });
  } catch (err) {
    console.error('Send bulk email error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Mark bulk order shipped
router.post('/admin/bulk-inquiries/:id/mark-shipped', requireAdmin, async (req, res) => {
  try {
    const {
      tracking_number, tracking_carrier, shipped_at,
    } = req.body;
    if (!tracking_number) return res.status(400).json({ error: 'Tracking number required' });
    if (!tracking_carrier) return res.status(400).json({ error: 'Carrier required' });

    const trackingUrl = tracking_carrier === 'USPS'
      ? `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(tracking_number)}`
      : null;

    const { rows: [inq] } = await db.query(
      `UPDATE bulk_inquiries
       SET tracking_number        = $1,
           tracking_carrier       = $2,
           tracking_url           = $3,
           shipped_at             = $4,
           status                 = 'shipped',
           updated_at             = NOW()
       WHERE id = $5
       RETURNING *`,
      [
        tracking_number,
        tracking_carrier,
        trackingUrl,
        shipped_at ? new Date(shipped_at) : new Date(),
        req.params.id,
      ]
    );
    if (!inq) return res.status(404).json({ error: 'Not found' });

    // Send shipping confirmation email
    sendBulkShippingConfirmationEmail(inq).catch(err =>
      console.error('Bulk shipping email error:', err.message)
    );
    await db.query(
      `UPDATE bulk_inquiries SET email_shipping_sent_at = NOW() WHERE id = $1`,
      [req.params.id]
    );

    res.json({ ok: true, inquiry: inq });
  } catch (err) {
    console.error('Mark bulk shipped error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Bulk inquiry packing slip
router.get('/admin/bulk-inquiries/:id/packing-slip', requireAdmin, async (req, res) => {
  try {
    const { rows: [inq] } = await db.query('SELECT * FROM bulk_inquiries WHERE id = $1', [req.params.id]);
    if (!inq) return res.status(404).send('Inquiry not found');
    const includePrices = (await getSetting('packing_slip_include_prices', 'true')) === 'true';
    const qty = inq.quantity_pouches || inq.quantity_requested || 1;

    // Build a pseudo-order object compatible with the slip renderer
    const pseudoOrder = {
      order_number: `BLK-${inq.id}`,
      created_at: inq.created_at,
      customer_name: inq.name,
      shipping_name: inq.shipping_name || inq.name,
      shipping_address_line1: inq.shipping_address_line1,
      shipping_address_line2: inq.shipping_address_line2,
      shipping_city: inq.shipping_city,
      shipping_state: inq.shipping_state,
      shipping_postal_code: inq.shipping_postal_code,
      shipping_country: inq.shipping_country || 'US',
      subtotal_cents: inq.quoted_bundle_cents || inq.quoted_total_cents,
      shipping_cents: inq.quoted_shipping_cents || 0,
      tax_cents: 0,
      discount_amount_cents: 0,
      total_cents: inq.quoted_total_cents,
      items: [{
        name: `Kavanah Pouch${inq.organization_name ? ` — ${inq.organization_name}` : ''}`,
        quantity_pouches: qty,
        total_amount_cents: inq.quoted_bundle_cents || inq.quoted_total_cents,
      }],
    };

    const html = renderPackingSlipDocument([pseudoOrder], includePrices);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error generating packing slip: ' + err.message);
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

// ── Analytics ─────────────────────────────────────────────────────────────────
router.get('/admin/analytics', requireAdmin, (req, res) => {
  res.sendFile(path.join(__dirname, '../../src/views/admin-analytics.html'));
});

function analyticsRange(req) {
  const allowed = ['today', '7d', '30d', 'all'];
  const r = req.query.range;
  return allowed.includes(r) ? r : '7d';
}

router.get('/admin/api/analytics/summary', requireAdmin, async (req, res) => {
  try { res.json(await getSummary(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/daily', requireAdmin, async (req, res) => {
  try { res.json(await getDailyStats(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/referrers', requireAdmin, async (req, res) => {
  try { res.json(await getTopReferrers(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/pages', requireAdmin, async (req, res) => {
  try { res.json(await getTopPages(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/devices', requireAdmin, async (req, res) => {
  try { res.json(await getDeviceBreakdown(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/funnel', requireAdmin, async (req, res) => {
  try { res.json(await getFunnel(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/recent', requireAdmin, async (req, res) => {
  try { res.json(await getRecentEvents(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/utm', requireAdmin, async (req, res) => {
  try { res.json(await getUtmStats(analyticsRange(req))); }
  catch (err) { res.status(500).json({ error: err.message }); }
});

router.get('/admin/api/analytics/coupons', requireAdmin, async (req, res) => {
  try { res.json(await getCouponStats()); }
  catch (err) { res.status(500).json({ error: err.message }); }
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

// ── Packing Slips ─────────────────────────────────────────────────────────────

// Single order packing slip
router.get('/admin/orders/:id/packing-slip', requireAdmin, async (req, res) => {
  try {
    const order = await getOrderById(req.params.id);
    if (!order) return res.status(404).send('Order not found');
    const includePrices = (await getSetting('packing_slip_include_prices', 'true')) === 'true';
    const html = renderPackingSlipDocument([order], includePrices);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error generating packing slip: ' + err.message);
  }
});

// Bulk packing slips — query params: ids=1,2,3  OR  status=unfulfilled|exported|all
router.get('/admin/orders/packing-slips/bulk', requireAdmin, async (req, res) => {
  try {
    let orders = [];
    if (req.query.ids) {
      const ids = req.query.ids.split(',').map(s => parseInt(s, 10)).filter(Boolean);
      if (!ids.length) return res.status(400).send('No valid IDs');
      // Fetch each order individually (preserves item arrays)
      orders = (await Promise.all(ids.map(id => getOrderById(id)))).filter(Boolean);
    } else {
      const status = req.query.status || 'unfulfilled';
      const filters = status === 'all'
        ? { payment_status: 'paid' }
        : { payment_status: 'paid', fulfillment_status: status };
      const rows = await getOrders(filters);
      // Attach items for each order
      orders = await Promise.all(rows.map(o => getOrderById(o.id)));
      orders = orders.filter(Boolean);
    }
    if (!orders.length) return res.status(404).send('No orders found');
    const includePrices = (await getSetting('packing_slip_include_prices', 'true')) === 'true';
    const html = renderPackingSlipDocument(orders, includePrices);
    res.setHeader('Content-Type', 'text/html');
    res.send(html);
  } catch (err) {
    res.status(500).send('Error generating packing slips: ' + err.message);
  }
});

// ── Admin Settings API ────────────────────────────────────────────────────────

router.get('/admin/api/settings', requireAdmin, async (req, res) => {
  try {
    const settings = await getAllSettings();
    res.json(settings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/admin/api/settings', requireAdmin, async (req, res) => {
  try {
    const allowed = ['packing_slip_include_prices'];
    const updates = {};
    for (const key of allowed) {
      if (Object.prototype.hasOwnProperty.call(req.body, key)) {
        updates[key] = req.body[key];
      }
    }
    if (!Object.keys(updates).length) return res.status(400).json({ error: 'No valid keys' });
    await setSettings(updates);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

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
