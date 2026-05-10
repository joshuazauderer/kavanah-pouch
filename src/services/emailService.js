const { Resend } = require('resend');
const db = require('../db');

let _resend = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

// ── Sender addresses ────────────────────────────────────────────────────────
// artcertify.store is the verified Resend domain on this account.
// Set FROM_EMAIL to override once kavanahpouch.com is verified in Resend.
// Both owner alerts and customer emails use the same FROM_EMAIL setting.
const FROM = () => {
  const email = process.env.FROM_EMAIL || 'noreply@artcertify.store';
  const name  = process.env.FROM_NAME  || 'Kavanah Pouch';
  return `${name} <${email}>`;
};
const OWNER_FROM    = FROM;
const CUSTOMER_FROM = FROM;
const SUPPORT_EMAIL = () => process.env.SUPPORT_EMAIL || 'support@kavanahpouch.com';
const OWNER_EMAIL   = () => process.env.OWNER_NOTIFICATION_EMAIL;

// ── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtMoney(cents) {
  if (cents == null) return '—';
  return '$' + (Number(cents) / 100).toFixed(2);
}

function fmtShipping(cents) {
  if (Number(cents) === 0) return 'Free';
  return fmtMoney(cents);
}

// ── Order confirmation content builder ──────────────────────────────────────
function buildOrderConfirmationContent(order, items) {
  const firstName    = (order.customer_name || '').split(' ')[0] || 'there';
  const item         = (items && items[0]) || {};
  const itemName     = item.name || 'Kavanah Pouch';
  const qty          = item.quantity_pouches || 1;
  const supportEmail = SUPPORT_EMAIL();

  const addrLines = [
    order.shipping_name || order.customer_name || '',
    order.shipping_address_line1 || '',
    order.shipping_address_line2 || null,
    [order.shipping_city, order.shipping_state, order.shipping_postal_code]
      .filter(Boolean).join(', '),
    order.shipping_country && order.shipping_country !== 'US'
      ? order.shipping_country : null,
  ].filter(Boolean);

  // ── Plain text ─────────────────────────────────────────────────────────
  const text = [
    `Hi ${firstName},`,
    '',
    'Thank you for your order from Kavanah Pouch.',
    '',
    `Order Number: ${order.order_number}`,
    `Item: ${itemName}`,
    `Quantity of Pouches: ${qty}`,
    `Product Subtotal: ${fmtMoney(order.subtotal_cents)}`,
    `Shipping: ${fmtShipping(order.shipping_cents)}`,
    `Total Paid: ${fmtMoney(order.total_cents)}`,
    '',
    'Shipping Address:',
    ...addrLines,
    '',
    'We are preparing your order for shipment. Once your package ships, you will receive a tracking email.',
    '',
    'Most orders ship within 1–2 business days. USPS Ground Advantage delivery is typically 2–5 days after USPS receives the package, though delivery times are not guaranteed.',
    '',
    'Thank you for supporting Kavanah Pouch.',
    '',
    'Daven without distractions,',
    'Kavanah Pouch',
    'KavanahPouch.com',
    '',
    `Questions? Contact us at ${supportEmail}`,
  ].join('\n');

  // ── HTML ───────────────────────────────────────────────────────────────
  const addrHtml = addrLines.map(escHtml).join('<br>');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Your Kavanah Pouch Order</title>
</head>
<body style="margin:0;padding:0;background:#e5dfd3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#e5dfd3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:580px;">

          <!-- HEADER -->
          <tr>
            <td style="background:#001f42;border-radius:14px 14px 0 0;padding:30px 40px;text-align:center;">
              <div style="font-size:20px;font-weight:800;color:#d6a23a;letter-spacing:.08em;text-transform:uppercase;">Kavanah Pouch</div>
              <div style="font-size:11px;color:rgba(248,241,223,.6);margin-top:6px;letter-spacing:.1em;text-transform:uppercase;">Daven without distractions</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#f8f1df;padding:36px 40px;">

              <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#132133;">Hi ${escHtml(firstName)},</p>
              <p style="margin:0 0 28px;font-size:14px;color:#132133;line-height:1.7;">Thank you for your order. We&#8217;ve received it and are preparing it for shipment.</p>

              <!-- ORDER SUMMARY -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:10px;border:1px solid rgba(19,33,51,.12);margin-bottom:20px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#667085;margin-bottom:14px;">Order Summary</div>
                    <table width="100%" cellpadding="0" cellspacing="4" role="presentation">
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;">Order Number</td>
                        <td align="right" style="font-size:13px;color:#132133;font-weight:700;padding:3px 0;">${escHtml(order.order_number)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;">Item</td>
                        <td align="right" style="font-size:13px;color:#132133;font-weight:600;padding:3px 0;">${escHtml(itemName)}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;">Quantity</td>
                        <td align="right" style="font-size:13px;color:#132133;font-weight:600;padding:3px 0;">${qty} pouch${qty > 1 ? 'es' : ''}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding:8px 0 0;">
                          <hr style="border:none;border-top:1px solid rgba(19,33,51,.1);margin:0;">
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#667085;padding:6px 0 3px;">Subtotal</td>
                        <td align="right" style="font-size:13px;color:#132133;padding:6px 0 3px;">${escHtml(fmtMoney(order.subtotal_cents))}</td>
                      </tr>
                      <tr>
                        <td style="font-size:13px;color:#667085;padding:3px 0;">Shipping</td>
                        <td align="right" style="font-size:13px;color:${Number(order.shipping_cents) === 0 ? '#16a34a' : '#132133'};padding:3px 0;">${escHtml(fmtShipping(order.shipping_cents))}</td>
                      </tr>
                      <tr>
                        <td colspan="2" style="padding:6px 0 0;">
                          <hr style="border:none;border-top:1px solid rgba(19,33,51,.1);margin:0;">
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size:14px;font-weight:700;color:#132133;padding:8px 0 0;">Total Paid</td>
                        <td align="right" style="font-size:14px;font-weight:800;color:#001f42;padding:8px 0 0;">${escHtml(fmtMoney(order.total_cents))}</td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- SHIPPING ADDRESS -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:10px;border:1px solid rgba(19,33,51,.12);margin-bottom:28px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#667085;margin-bottom:10px;">Shipping Address</div>
                    <div style="font-size:13px;color:#132133;line-height:1.8;">${addrHtml}</div>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 10px;font-size:13px;color:#132133;line-height:1.7;">We are preparing your order for shipment. Once your package ships, you will receive a tracking email from Pirate Ship with your tracking number.</p>
              <p style="margin:0 0 28px;font-size:13px;color:#667085;line-height:1.7;">Most orders ship within 1&#8211;2 business days. USPS Ground Advantage delivery is typically 2&#8211;5 days after USPS receives the package, though delivery times are not guaranteed.</p>

              <p style="margin:0 0 2px;font-size:14px;color:#132133;font-weight:600;">Thank you for supporting Kavanah Pouch.</p>
              <p style="margin:0;font-size:13px;color:#667085;font-style:italic;">Daven without distractions,<br>Kavanah Pouch</p>

            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#001f42;border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:rgba(248,241,223,.7);">
                Questions? <a href="mailto:${escHtml(supportEmail)}" style="color:#d6a23a;text-decoration:none;">${escHtml(supportEmail)}</a>
              </p>
              <p style="margin:0;font-size:11px;color:rgba(248,241,223,.4);">
                Kavanah Pouch &nbsp;&middot;&nbsp;
                <a href="https://kavanahpouch.com" style="color:rgba(248,241,223,.4);text-decoration:none;">KavanahPouch.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  return {
    subject: 'Your Kavanah Pouch order has been received',
    html,
    text,
  };
}

// ── Send customer order confirmation ─────────────────────────────────────────
async function sendOrderConfirmationEmail(order) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping customer confirmation email');
    return;
  }
  if (!order.customer_email) {
    console.warn(`Order ${order.order_number} has no customer email — skipping confirmation`);
    return;
  }

  const { rows: items } = await db.query(
    'SELECT * FROM order_items WHERE order_id = $1',
    [order.id]
  );

  const { subject, html, text } = buildOrderConfirmationContent(order, items);

  try {
    const { error } = await getResend().emails.send({
      from:    CUSTOMER_FROM(),
      to:      [order.customer_email],
      replyTo: SUPPORT_EMAIL(),
      subject,
      html,
      text,
    });

    if (error) throw new Error(error.message || JSON.stringify(error));

    await db.query(
      `UPDATE orders
       SET order_confirmation_email_status  = 'sent',
           order_confirmation_email_sent_at = NOW(),
           order_confirmation_email_error   = NULL,
           updated_at = NOW()
       WHERE id = $1`,
      [order.id]
    );

    console.log(`Confirmation email sent: ${order.order_number} → ${order.customer_email}`);
  } catch (err) {
    const msg = (err.message || String(err)).slice(0, 1000);
    console.error(`Confirmation email FAILED for ${order.order_number}:`, msg);

    await db.query(
      `UPDATE orders
       SET order_confirmation_email_status = 'failed',
           order_confirmation_email_error  = $2,
           updated_at = NOW()
       WHERE id = $1`,
      [order.id, msg]
    ).catch(() => {});

    throw err;
  }
}

// ── Owner notifications ───────────────────────────────────────────────────────
async function sendOwnerNotification(subject, html) {
  const to = OWNER_EMAIL();
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const { error } = await getResend().emails.send({
      from: OWNER_FROM(),
      to: [to],
      replyTo: SUPPORT_EMAIL(),
      subject,
      html,
    });
    if (error) console.error('Owner email send error:', error.message);
  } catch (err) {
    console.error('Owner email send error:', err.message);
  }
}

function textToHtml(str) {
  return str.replace(/\n/g, '<br>');
}

async function notifyNewOrder(order) {
  const total = (order.total_cents / 100).toFixed(2);
  await sendOwnerNotification(
    `New order ${order.order_number} — $${total}`,
    `<p><strong>New paid order received!</strong></p>
     <p>Order: ${order.order_number}<br>
     Customer: ${order.customer_name} &lt;${order.customer_email}&gt;<br>
     Total: $${total}</p>
     <p><a href="https://kavanahpouch.com/admin/orders/${order.id}">View order in dashboard</a></p>`
  );
}

async function notifyNewBulkInquiry(inquiry) {
  const qtyLabel = inquiry.quantity_requested
    ? `${inquiry.quantity_requested} pouches`
    : 'Not specified';
  const qtyPriceMap = { 10: '$119', 25: '$275', 50: '$499', 100: '$899' };
  const qtyPrice = qtyPriceMap[inquiry.quantity_requested] || '';
  const priceNote = qtyPrice ? ` (${qtyPrice} + shipping)` : '';

  await sendOwnerNotification(
    `New bulk inquiry from ${escHtml(inquiry.name)} — ${qtyLabel}`,
    `<p><strong>New bulk order inquiry received!</strong></p>
     <table cellpadding="0" cellspacing="0" style="font-size:14px;line-height:1.7">
       <tr><td style="color:#667085;padding-right:16px;white-space:nowrap">Name</td><td><strong>${escHtml(inquiry.name)}</strong></td></tr>
       <tr><td style="color:#667085;padding-right:16px">Email</td><td><a href="mailto:${escHtml(inquiry.email)}">${escHtml(inquiry.email)}</a></td></tr>
       ${inquiry.phone ? `<tr><td style="color:#667085;padding-right:16px">Phone</td><td>${escHtml(inquiry.phone)}</td></tr>` : ''}
       ${inquiry.organization_name ? `<tr><td style="color:#667085;padding-right:16px">Organization</td><td>${escHtml(inquiry.organization_name)}</td></tr>` : ''}
       <tr><td style="color:#667085;padding-right:16px">Quantity</td><td><strong>${qtyLabel}${priceNote}</strong></td></tr>
       ${inquiry.shipping_zip ? `<tr><td style="color:#667085;padding-right:16px">Ship ZIP</td><td>${escHtml(inquiry.shipping_zip)}</td></tr>` : ''}
       <tr><td style="color:#667085;padding-right:16px">Dedication?</td><td>${inquiry.is_dedication ? 'Yes' : 'No'}</td></tr>
       ${inquiry.dedication_text ? `<tr><td style="color:#667085;padding-right:16px">Dedication</td><td><em>${escHtml(inquiry.dedication_text)}</em></td></tr>` : ''}
     </table>
     ${inquiry.message ? `<p style="margin-top:14px"><strong>Message:</strong><br>${textToHtml(escHtml(inquiry.message))}</p>` : ''}
     <p style="margin-top:16px"><a href="https://kavanahpouch.com/admin/bulk-inquiries" style="background:#001f42;color:#d6a23a;padding:8px 18px;border-radius:999px;text-decoration:none;font-weight:700;">View in Dashboard →</a></p>`
  );
}

/**
 * Send a warm confirmation email to the customer who submitted a bulk inquiry.
 */
async function sendBulkInquiryConfirmation(inquiry) {
  if (!process.env.RESEND_API_KEY) return;
  if (!inquiry.email) return;

  const firstName = (inquiry.name || '').split(' ')[0] || 'there';
  const supportEmail = SUPPORT_EMAIL();
  const qtyMap = {
    10: '10-Pack Trial Bundle',
    25: '25-Pack Shul Bundle',
    50: '50-Pack Sponsor Bundle',
    100: '100-Pack Dedication Bundle',
  };
  const qtyLabel = inquiry.quantity_requested
    ? (qtyMap[inquiry.quantity_requested] || `${inquiry.quantity_requested} pouches`)
    : 'Custom quantity';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Bulk Order Inquiry Received</title>
</head>
<body style="margin:0;padding:0;background:#e5dfd3;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#e5dfd3;">
    <tr>
      <td align="center" style="padding:32px 16px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:580px;">

          <!-- HEADER -->
          <tr>
            <td style="background:#001f42;border-radius:14px 14px 0 0;padding:28px 40px;text-align:center;">
              <div style="font-size:20px;font-weight:800;color:#d6a23a;letter-spacing:.08em;text-transform:uppercase;">Kavanah Pouch</div>
              <div style="font-size:11px;color:rgba(248,241,223,.6);margin-top:6px;letter-spacing:.1em;text-transform:uppercase;">Daven without distractions</div>
            </td>
          </tr>

          <!-- BODY -->
          <tr>
            <td style="background:#f8f1df;padding:36px 40px;">
              <p style="margin:0 0 6px;font-size:17px;font-weight:700;color:#132133;">Hi ${escHtml(firstName)},</p>
              <p style="margin:0 0 20px;font-size:14px;color:#132133;line-height:1.7;">Thank you for your bulk order inquiry! We&#8217;ve received your request and will follow up within 1&#8211;2 business days with shipping cost and next steps.</p>

              <!-- INQUIRY SUMMARY -->
              <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#fff;border-radius:10px;border:1px solid rgba(19,33,51,.12);margin-bottom:24px;">
                <tr>
                  <td style="padding:20px 24px;">
                    <div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#667085;margin-bottom:14px;">Your Inquiry</div>
                    <table width="100%" cellpadding="0" cellspacing="4" role="presentation">
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;white-space:nowrap;padding-right:16px">Quantity</td>
                        <td style="font-size:13px;color:#132133;font-weight:700;padding:3px 0">${escHtml(qtyLabel)}</td>
                      </tr>
                      ${inquiry.organization_name ? `
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;padding-right:16px">Organization</td>
                        <td style="font-size:13px;color:#132133;font-weight:600;padding:3px 0">${escHtml(inquiry.organization_name)}</td>
                      </tr>` : ''}
                      ${inquiry.shipping_zip ? `
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;padding-right:16px">Ship ZIP</td>
                        <td style="font-size:13px;color:#132133;font-weight:600;padding:3px 0">${escHtml(inquiry.shipping_zip)}</td>
                      </tr>` : ''}
                      ${inquiry.is_dedication ? `
                      <tr>
                        <td style="font-size:13px;color:#667085;font-weight:600;padding:3px 0;padding-right:16px">Dedication</td>
                        <td style="font-size:13px;color:#132133;font-weight:600;padding:3px 0">Yes${inquiry.dedication_text ? ' — ' + escHtml(inquiry.dedication_text) : ''}</td>
                      </tr>` : ''}
                    </table>
                  </td>
                </tr>
              </table>

              <p style="margin:0 0 12px;font-size:14px;color:#132133;line-height:1.7;font-weight:600;">What happens next?</p>
              <p style="margin:0 0 8px;font-size:13px;color:#132133;line-height:1.7;">We&#8217;ll review your inquiry and calculate shipping based on your quantity and destination. We&#8217;ll reach out to you directly with a shipping quote and payment options — no charge until you approve.</p>
              <p style="margin:0 0 28px;font-size:13px;color:#667085;line-height:1.7;">Dedication and custom labeling options will also be discussed if applicable.</p>

              <p style="margin:0 0 2px;font-size:14px;color:#132133;font-weight:600;">Thank you for supporting Kavanah Pouch.</p>
              <p style="margin:0;font-size:13px;color:#667085;font-style:italic;">Daven without distractions,<br>Kavanah Pouch</p>
            </td>
          </tr>

          <!-- FOOTER -->
          <tr>
            <td style="background:#001f42;border-radius:0 0 14px 14px;padding:22px 40px;text-align:center;">
              <p style="margin:0 0 6px;font-size:12px;color:rgba(248,241,223,.7);">
                Questions? <a href="mailto:${escHtml(supportEmail)}" style="color:#d6a23a;text-decoration:none;">${escHtml(supportEmail)}</a>
              </p>
              <p style="margin:0;font-size:11px;color:rgba(248,241,223,.4);">
                Kavanah Pouch &nbsp;&middot;&nbsp;
                <a href="https://kavanahpouch.com" style="color:rgba(248,241,223,.4);text-decoration:none;">KavanahPouch.com</a>
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = [
    `Hi ${firstName},`,
    '',
    'Thank you for your bulk order inquiry. We\'ve received your request and will follow up within 1-2 business days with shipping cost and next steps.',
    '',
    `Quantity: ${qtyLabel}`,
    inquiry.organization_name ? `Organization: ${inquiry.organization_name}` : '',
    inquiry.shipping_zip ? `Ship ZIP: ${inquiry.shipping_zip}` : '',
    inquiry.is_dedication ? `Dedication: Yes${inquiry.dedication_text ? ' — ' + inquiry.dedication_text : ''}` : '',
    '',
    'What happens next?',
    'We\'ll calculate shipping based on your quantity and destination and reach out with a quote. No charge until you approve.',
    '',
    'Daven without distractions,',
    'Kavanah Pouch',
    `Questions? Contact us at ${supportEmail}`,
  ].filter(l => l !== null).join('\n');

  try {
    const { error } = await getResend().emails.send({
      from:    CUSTOMER_FROM(),
      to:      [inquiry.email],
      replyTo: supportEmail,
      subject: 'Bulk Order Inquiry Received — Kavanah Pouch',
      html,
      text,
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    console.log(`Bulk inquiry confirmation sent to ${inquiry.email}`);
  } catch (err) {
    console.error('Bulk inquiry confirmation email failed:', err.message);
    // Don't re-throw — this is a non-critical notification
  }
}

async function notifyNewSupportMessage(msg) {
  await sendOwnerNotification(
    `New support message from ${msg.email}`,
    `<p><strong>New support message!</strong></p>
     <p>Name: ${msg.name || 'N/A'}<br>
     Email: ${msg.email}<br>
     Topic: ${msg.category || 'N/A'}<br>
     Order #: ${msg.order_number || 'N/A'}</p>
     <p>Message:<br>${textToHtml(msg.message)}</p>
     <p><a href="https://kavanahpouch.com/admin/support">View in dashboard</a></p>`
  );
}

async function notifyNewFeedback(feedback) {
  await sendOwnerNotification(
    `New customer feedback${feedback.name ? ' from ' + feedback.name : ''}`,
    `<p><strong>New feedback submitted!</strong></p>
     <p>Name: ${feedback.name || 'Anonymous'}<br>
     Email: ${feedback.email || 'N/A'}<br>
     Use case: ${feedback.usage_context || 'N/A'}<br>
     May use as testimonial: ${feedback.may_use_as_testimonial ? 'Yes' : 'No'}</p>
     <p>Feedback:<br>${textToHtml(feedback.message)}</p>
     <p><a href="https://kavanahpouch.com/admin/feedback">View in dashboard</a></p>`
  );
}

async function notifyNewWaitlistSignup(signup) {
  await sendOwnerNotification(
    `New waitlist signup: ${signup.email}`,
    `<p><strong>New waitlist signup!</strong></p>
     <p>Email: ${signup.email}<br>
     Name: ${signup.name || 'N/A'}<br>
     Interest: ${signup.interest_type || 'N/A'}</p>`
  );
}

// ── Admin password reset email ────────────────────────────────────────────────
async function sendPasswordResetEmail(toEmail, resetUrl) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('RESEND_API_KEY not set — skipping password reset email');
    return;
  }
  const supportEmail = SUPPORT_EMAIL();
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>Reset Your Password</title>
</head>
<body style="margin:0;padding:0;background:#001f42;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" role="presentation" style="background:#001f42;">
    <tr>
      <td align="center" style="padding:48px 16px;">
        <table cellpadding="0" cellspacing="0" role="presentation" style="width:100%;max-width:480px;background:rgba(248,241,223,.07);border:1px solid rgba(248,241,223,.16);border-radius:24px;">
          <tr>
            <td style="padding:36px 40px;text-align:center;">
              <div style="font-size:14px;font-weight:800;color:#d6a23a;letter-spacing:.08em;text-transform:uppercase;margin-bottom:6px;">Kavanah Pouch · Admin</div>
              <h1 style="margin:0 0 8px;font-size:1.5rem;color:#f8f1df;">Reset Your Password</h1>
              <p style="margin:0 0 28px;font-size:.9rem;color:rgba(248,241,223,.6);">Click the button below to set a new password. This link expires in 1 hour.</p>
              <a href="${escHtml(resetUrl)}" style="display:inline-block;background:#d6a23a;color:#001f42;font-weight:800;font-size:.95rem;padding:.85rem 2rem;border-radius:999px;text-decoration:none;">Reset Password</a>
              <p style="margin:24px 0 0;font-size:.8rem;color:rgba(248,241,223,.4);">If you didn&#8217;t request this, ignore this email &#8212; your password won&#8217;t change.</p>
              <p style="margin:8px 0 0;font-size:.8rem;color:rgba(248,241,223,.3);">Or copy this link: <span style="word-break:break-all;">${escHtml(resetUrl)}</span></p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const text = `Reset Your Kavanah Pouch Admin Password\n\nClick the link below to set a new password (expires in 1 hour):\n\n${resetUrl}\n\nIf you didn't request this, ignore this email.`;

  try {
    const { error } = await getResend().emails.send({
      from:    FROM(),
      to:      [toEmail],
      replyTo: supportEmail,
      subject: 'Reset your Kavanah Pouch admin password',
      html,
      text,
    });
    if (error) throw new Error(error.message || JSON.stringify(error));
    console.log(`Password reset email sent to ${toEmail}`);
  } catch (err) {
    console.error('Password reset email failed:', err.message);
    throw err;
  }
}

module.exports = {
  sendOrderConfirmationEmail,
  sendPasswordResetEmail,
  notifyNewOrder,
  notifyNewBulkInquiry,
  sendBulkInquiryConfirmation,
  notifyNewSupportMessage,
  notifyNewFeedback,
  notifyNewWaitlistSignup,
};
