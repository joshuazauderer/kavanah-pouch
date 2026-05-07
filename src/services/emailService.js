const { Resend } = require('resend');

let _resend = null;

function getResend() {
  if (!_resend) {
    _resend = new Resend(process.env.RESEND_API_KEY);
  }
  return _resend;
}

const OWNER_EMAIL = () => process.env.OWNER_NOTIFICATION_EMAIL;
// artcertify.store is the verified Resend domain on this account
const FROM = 'Kavanah Pouch <noreply@artcertify.store>';

async function sendOwnerNotification(subject, html) {
  const to = OWNER_EMAIL();
  if (!to || !process.env.RESEND_API_KEY) return;
  try {
    const { error } = await getResend().emails.send({
      from: FROM,
      to: [to],
      replyTo: 'support@kavanahpouch.com',
      subject,
      html,
    });
    if (error) console.error('Email send error:', error.message);
  } catch (err) {
    console.error('Email send error:', err.message);
  }
}

function text(str) {
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
  await sendOwnerNotification(
    `New bulk inquiry from ${inquiry.name}`,
    `<p><strong>New bulk order inquiry!</strong></p>
     <p>Name: ${inquiry.name}<br>
     Email: ${inquiry.email}<br>
     Organization: ${inquiry.organization_name || 'N/A'}<br>
     Quantity: ${inquiry.quantity_requested || 'Not specified'}</p>
     <p>Message:<br>${text(inquiry.message || '—')}</p>
     <p><a href="https://kavanahpouch.com/admin/bulk-inquiries">View in dashboard</a></p>`
  );
}

async function notifyNewSupportMessage(msg) {
  await sendOwnerNotification(
    `New support message from ${msg.email}`,
    `<p><strong>New support message!</strong></p>
     <p>Name: ${msg.name || 'N/A'}<br>
     Email: ${msg.email}<br>
     Topic: ${msg.category || 'N/A'}<br>
     Order #: ${msg.order_number || 'N/A'}</p>
     <p>Message:<br>${text(msg.message)}</p>
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
     <p>Feedback:<br>${text(feedback.message)}</p>
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

module.exports = {
  notifyNewOrder,
  notifyNewBulkInquiry,
  notifyNewSupportMessage,
  notifyNewFeedback,
  notifyNewWaitlistSignup,
};
