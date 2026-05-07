const nodemailer = require('nodemailer');
const config = require('../config');

let transporter = null;

function getTransporter() {
  if (!config.email.enabled) return null;
  if (!transporter) {
    transporter = nodemailer.createTransport({
      host: config.email.smtp.host,
      port: config.email.smtp.port,
      secure: config.email.smtp.port === 465,
      auth: {
        user: config.email.smtp.user,
        pass: config.email.smtp.pass,
      },
    });
  }
  return transporter;
}

async function sendOwnerNotification(subject, text) {
  const t = getTransporter();
  if (!t || !config.email.ownerEmail) return;
  try {
    await t.sendMail({
      from: config.email.smtp.from,
      to: config.email.ownerEmail,
      subject,
      text,
    });
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

async function notifyNewOrder(order) {
  await sendOwnerNotification(
    `New order ${order.order_number} — $${(order.total_cents / 100).toFixed(2)}`,
    `New paid order received!\n\nOrder: ${order.order_number}\nCustomer: ${order.customer_name} <${order.customer_email}>\nTotal: $${(order.total_cents / 100).toFixed(2)}\n\nLog in to your dashboard to view and fulfill.`
  );
}

async function notifyNewBulkInquiry(inquiry) {
  await sendOwnerNotification(
    `New bulk inquiry from ${inquiry.name}`,
    `New bulk order inquiry!\n\nName: ${inquiry.name}\nEmail: ${inquiry.email}\nOrganization: ${inquiry.organization_name || 'N/A'}\nQuantity: ${inquiry.quantity_requested || 'Not specified'}\n\nMessage:\n${inquiry.message || '—'}`
  );
}

async function notifyNewSupportMessage(msg) {
  await sendOwnerNotification(
    `New support message from ${msg.email}`,
    `New support message!\n\nName: ${msg.name || 'N/A'}\nEmail: ${msg.email}\nTopic: ${msg.category || 'N/A'}\n\nMessage:\n${msg.message}`
  );
}

async function notifyNewWaitlistSignup(signup) {
  await sendOwnerNotification(
    `New waitlist signup: ${signup.email}`,
    `New waitlist signup!\n\nEmail: ${signup.email}\nName: ${signup.name || 'N/A'}\nInterest: ${signup.interest_type || 'N/A'}`
  );
}

module.exports = {
  notifyNewOrder,
  notifyNewBulkInquiry,
  notifyNewSupportMessage,
  notifyNewWaitlistSignup,
};
