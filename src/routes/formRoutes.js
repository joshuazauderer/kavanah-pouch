const express = require('express');
const rateLimit = require('express-rate-limit');
const { body, validationResult } = require('express-validator');
const db = require('../db');
const {
  notifyNewBulkInquiry,
  sendBulkInquiryConfirmation,
  notifyNewSupportMessage,
  notifyNewFeedback,
  notifyNewWaitlistSignup,
} = require('../services/emailService');

const router = express.Router();

const formLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  message: 'Too many submissions. Please try again later.',
  standardHeaders: true,
  legacyHeaders: false,
});

function honeypotCheck(req, res, next) {
  if (req.body._hp && req.body._hp.trim() !== '') {
    // Silently succeed — bot filled the honeypot
    return res.redirect(`/?submitted=${req.query._form || 'ok'}`);
  }
  next();
}

// ── Waitlist ─────────────────────────────────────────────────────────────────
router.post(
  '/api/waitlist',
  formLimiter,
  honeypotCheck,
  body('email').isEmail().normalizeEmail(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/?submitted=error#waitlist');

    const { email, name, interest } = req.body;
    try {
      const { rows: [signup] } = await db.query(
        `INSERT INTO waitlist_signups (email, name, interest_type, source)
         VALUES ($1, $2, $3, 'website')
         ON CONFLICT DO NOTHING
         RETURNING *`,
        [email, name || null, interest || null]
      );
      if (signup) notifyNewWaitlistSignup(signup).catch(() => {});
      res.redirect('/?submitted=waitlist#waitlist');
    } catch (err) {
      next(err);
    }
  }
);

// ── Bulk Inquiry ─────────────────────────────────────────────────────────────
router.post(
  '/api/bulk-inquiry',
  formLimiter,
  honeypotCheck,
  body('email').isEmail().normalizeEmail(),
  body('name').trim().notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/?submitted=error#bulk-inquiry-form');

    const {
      name, email, phone, organization, quantity,
      shipping_zip, is_dedication, dedication_text, message,
    } = req.body;

    // quantity may be 'custom' (string) or a number string
    const quantityNum = parseInt(quantity, 10) || null;
    const isDedication = is_dedication === 'yes';

    try {
      const { rows: [inquiry] } = await db.query(
        `INSERT INTO bulk_inquiries
           (name, email, phone, organization_name, quantity_requested,
            shipping_zip, is_dedication, dedication_text, message)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING *`,
        [
          name,
          email,
          phone || null,
          organization || null,
          quantityNum,
          shipping_zip || null,
          isDedication,
          (isDedication && dedication_text) ? dedication_text.trim() : null,
          message || null,
        ]
      );
      // Owner notification + customer confirmation (both fire-and-forget)
      notifyNewBulkInquiry(inquiry).catch(() => {});
      sendBulkInquiryConfirmation(inquiry).catch(() => {});
      res.redirect('/?submitted=bulk#bulk-inquiry-form');
    } catch (err) {
      next(err);
    }
  }
);

// ── Support ───────────────────────────────────────────────────────────────────
router.post(
  '/api/support',
  formLimiter,
  honeypotCheck,
  body('email').isEmail().normalizeEmail(),
  body('message').trim().notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/?submitted=error#support');

    const { name, email, topic, message, order_number } = req.body;
    try {
      const { rows: [msg] } = await db.query(
        `INSERT INTO support_messages (name, email, order_number, category, message)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [name || null, email, order_number || null, topic || null, message]
      );
      notifyNewSupportMessage(msg).catch(() => {});
      res.redirect('/?submitted=support#support');
    } catch (err) {
      next(err);
    }
  }
);

// ── Feedback ──────────────────────────────────────────────────────────────────
router.post(
  '/api/feedback',
  formLimiter,
  honeypotCheck,
  body('feedback').trim().notEmpty(),
  async (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) return res.redirect('/?submitted=error#support');

    const { name, email, use_case, feedback, testimonial_permission } = req.body;
    try {
      const { rows: [fb] } = await db.query(
        `INSERT INTO feedback_messages
           (name, email, usage_context, message, may_contact, may_use_as_testimonial)
         VALUES ($1, $2, $3, $4, $5, $5)
         RETURNING *`,
        [
          name || null,
          email || null,
          use_case || null,
          feedback,
          testimonial_permission === 'yes',
        ]
      );
      notifyNewFeedback(fb).catch(() => {});
      res.redirect('/?submitted=feedback#support');
    } catch (err) {
      next(err);
    }
  }
);

module.exports = router;
