/**
 * Packing slip HTML renderer.
 *
 * Layout: 2 slips per 8.5 × 11" page, print-optimized, minimal colour (B&W-safe).
 * Pass an array of order objects (each with `.items` array).
 * Pass `includePrices` boolean.
 */

function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(cents) {
  return '$' + (cents / 100).toFixed(2);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}

function buildAddress(o) {
  const lines = [
    esc(o.shipping_name || o.customer_name),
    esc(o.shipping_address_line1),
    o.shipping_address_line2 ? esc(o.shipping_address_line2) : null,
    [
      esc(o.shipping_city),
      esc(o.shipping_state),
      esc(o.shipping_postal_code),
    ].filter(Boolean).join(', '),
    esc(o.shipping_country),
  ].filter(Boolean);
  return lines.join('<br>');
}

function renderSlip(order, includePrices) {
  const items = (order.items || []);

  const itemRows = items.map(i => {
    const qtyText = `${i.quantity_pouches} pouch${i.quantity_pouches !== 1 ? 'es' : ''}`;
    return `
      <tr>
        <td class="item-name">${esc(i.name)}</td>
        <td class="item-qty">${qtyText}</td>
        ${includePrices ? `<td class="item-price">${fmt(i.total_amount_cents)}</td>` : ''}
      </tr>`;
  }).join('');

  let priceSummary = '';
  if (includePrices) {
    priceSummary = `
      <table class="price-table">
        <tr><td>Subtotal</td><td>${fmt(order.subtotal_cents)}</td></tr>
        ${order.shipping_cents > 0 ? `<tr><td>Shipping</td><td>${fmt(order.shipping_cents)}</td></tr>` : ''}
        ${order.tax_cents > 0 ? `<tr><td>Tax</td><td>${fmt(order.tax_cents)}</td></tr>` : ''}
        ${(order.discount_amount_cents > 0) ? `<tr class="discount-row"><td>Discount${order.discount_code ? ' (' + esc(order.discount_code) + ')' : ''}</td><td>−${fmt(order.discount_amount_cents)}</td></tr>` : ''}
        <tr class="total-row"><td><strong>Total</strong></td><td><strong>${fmt(order.total_cents)}</strong></td></tr>
      </table>`;
  }

  return `
    <div class="slip">
      <div class="slip-header">
        <div class="slip-brand">Kavanah Pouch</div>
        <div class="slip-meta">
          <div><strong>Order:</strong> ${esc(order.order_number)}</div>
          <div><strong>Date:</strong> ${fmtDate(order.created_at)}</div>
        </div>
      </div>

      <div class="slip-body">
        <div class="slip-section">
          <div class="section-label">Ship To</div>
          <div class="address">${buildAddress(order)}</div>
        </div>

        <div class="slip-section">
          <div class="section-label">Items</div>
          <table class="items-table">
            <thead>
              <tr>
                <th class="item-name">Item</th>
                <th class="item-qty">Qty</th>
                ${includePrices ? '<th class="item-price">Price</th>' : ''}
              </tr>
            </thead>
            <tbody>${itemRows}</tbody>
          </table>
          ${priceSummary}
        </div>
      </div>

      <div class="slip-footer">
        <div class="thank-you">Thank you for your order!</div>
        <div class="support-info">Questions? support@kavanahpouch.com · kavanahpouch.com</div>
      </div>
    </div>`;
}

/**
 * Generate a full print-ready HTML document for one or more orders.
 * Orders are laid out 2 per page (using CSS print breaks).
 */
function renderPackingSlipDocument(orders, includePrices = true) {
  const slips = orders.map(o => renderSlip(o, includePrices)).join('\n');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Packing Slips — Kavanah Pouch</title>
  <style>
    /* ── Reset ─────────────────────────────────────────────────────────────── */
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    /* ── Print page setup ───────────────────────────────────────────────────
       Each "page-pair" holds exactly 2 slips — one for the top half,
       one for the bottom half of the sheet.  The pair starts a new
       printed page.  Each slip is half a letter page (5.5 × 8 in content). */
    @page { size: letter; margin: 0.45in; }

    body {
      font-family: system-ui, -apple-system, sans-serif;
      font-size: 11px;
      color: #000;
      background: #fff;
    }

    /* ── Screen preview ─────────────────────────────────────────────────── */
    @media screen {
      body { background: #e5e7eb; padding: 1.5rem; }
      .page-pair {
        background: #fff;
        width: 8.5in;
        min-height: 11in;
        margin: 0 auto 2rem;
        box-shadow: 0 4px 24px rgba(0,0,0,.18);
        padding: 0.45in;
        display: flex;
        flex-direction: column;
      }
      .print-actions {
        position: fixed;
        top: 1rem;
        right: 1rem;
        display: flex;
        gap: .5rem;
        z-index: 9999;
      }
      .print-btn {
        padding: .6rem 1.4rem;
        background: #001f42;
        color: #fff;
        font-family: inherit;
        font-size: .9rem;
        font-weight: 700;
        border: none;
        border-radius: 999px;
        cursor: pointer;
        text-decoration: none;
      }
      .print-btn:hover { background: #0a3060; }
      .print-btn.gold { background: #d6a23a; color: #001f42; }
      .print-btn.gold:hover { background: #e0b353; }
    }

    /* ── Print: page-pair breaks ────────────────────────────────────────── */
    @media print {
      .print-actions { display: none; }
      .page-pair {
        display: flex;
        flex-direction: column;
        height: 10.1in; /* fits inside letter with 0.45in margins each side */
        page-break-after: always;
        break-after: page;
      }
      .page-pair:last-child {
        page-break-after: avoid;
        break-after: avoid;
      }
    }

    /* ── Slip layout (fills half the page-pair) ─────────────────────────── */
    .slip {
      flex: 1;
      display: flex;
      flex-direction: column;
      padding: 0 0 1rem;
      overflow: hidden;
    }

    /* Dashed separator between the two slips on a page */
    .slip + .slip {
      border-top: 1.5px dashed #999;
      padding-top: 1rem;
      margin-top: 1rem;
    }

    /* ── Slip header ─────────────────────────────────────────────────────── */
    .slip-header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      border-bottom: 2px solid #000;
      padding-bottom: .5rem;
      margin-bottom: .75rem;
    }
    .slip-brand {
      font-size: 20px;
      font-weight: 800;
      letter-spacing: -.01em;
      text-transform: uppercase;
    }
    .slip-meta {
      text-align: right;
      font-size: 11px;
      line-height: 1.6;
    }

    /* ── Slip body ───────────────────────────────────────────────────────── */
    .slip-body {
      display: flex;
      gap: 2rem;
      flex: 1;
      align-items: flex-start;
    }

    .slip-section { flex: 1; }
    .section-label {
      font-size: 9px;
      font-weight: 800;
      letter-spacing: .12em;
      text-transform: uppercase;
      color: #555;
      margin-bottom: .35rem;
      border-bottom: 1px solid #ccc;
      padding-bottom: .15rem;
    }

    .address { font-size: 12px; line-height: 1.65; }

    /* ── Items table ─────────────────────────────────────────────────────── */
    .items-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 11px;
    }
    .items-table th {
      text-align: left;
      font-size: 9px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: .08em;
      color: #555;
      padding: .2rem 0;
      border-bottom: 1px solid #ccc;
    }
    .items-table td {
      padding: .3rem 0;
      border-bottom: 1px solid #e5e7eb;
      vertical-align: top;
    }
    .item-name { width: 60%; }
    .item-qty { width: 20%; }
    .item-price { width: 20%; text-align: right; }
    th.item-price { text-align: right; }

    /* ── Price summary table ─────────────────────────────────────────────── */
    .price-table {
      width: 55%;
      margin-left: auto;
      margin-top: .5rem;
      border-collapse: collapse;
      font-size: 10px;
    }
    .price-table td { padding: .15rem 0; }
    .price-table td:last-child { text-align: right; padding-left: .5rem; }
    .price-table tr.discount-row td { color: #16a34a; }
    .price-table tr.total-row td {
      border-top: 1px solid #000;
      padding-top: .25rem;
      font-size: 11px;
    }

    /* ── Slip footer ─────────────────────────────────────────────────────── */
    .slip-footer {
      margin-top: auto;
      padding-top: .5rem;
      border-top: 1px solid #e5e7eb;
      text-align: center;
    }
    .thank-you {
      font-size: 13px;
      font-weight: 700;
      margin-bottom: .15rem;
    }
    .support-info { font-size: 9px; color: #555; letter-spacing: .03em; }
  </style>
</head>
<body>
  <div class="print-actions">
    <button class="print-btn gold" onclick="window.print()">🖨 Print</button>
    <button class="print-btn" onclick="window.close()">✕ Close</button>
  </div>

  ${buildPagePairs(orders, includePrices)}

  <script>
    // Auto-open print dialog after a short paint delay
    window.addEventListener('load', () => {
      setTimeout(() => window.print(), 400);
    });
  </script>
</body>
</html>`;
}

/**
 * Group orders into pairs and wrap each pair in a .page-pair div.
 */
function buildPagePairs(orders, includePrices) {
  const pairs = [];
  for (let i = 0; i < orders.length; i += 2) {
    const a = orders[i];
    const b = orders[i + 1];
    const slipA = renderSlip(a, includePrices);
    const slipB = b ? renderSlip(b, includePrices) : '<div class="slip"></div>';
    pairs.push(`<div class="page-pair">${slipA}${slipB}</div>`);
  }
  return pairs.join('\n');
}

module.exports = { renderPackingSlipDocument };
