const db = require('../db');

// ── Bot detection ──────────────────────────────────────────────────────────────
const BOT_PATTERNS = [
  /bot/i, /crawl/i, /spider/i, /slurp/i, /bingpreview/i, /google/i,
  /facebook/i, /twitter/i, /linkedinbot/i, /whatsapp/i, /telegrambot/i,
  /applebot/i, /duckduckbot/i, /baiduspider/i, /yandex/i, /sogou/i,
  /exabot/i, /facebot/i, /ia_archiver/i, /semrush/i, /ahrefsbot/i,
  /mj12bot/i, /dotbot/i, /rogerbot/i, /screaming/i, /headlesschrome/i,
  /phantomjs/i, /selenium/i, /webdriver/i, /python-requests/i, /curl\//i,
  /wget\//i, /go-http-client/i, /libwww-perl/i, /okhttp/i, /axios/i,
  /node-fetch/i, /postman/i, /insomnia/i, /java\//i, /ruby/i,
];

function isBot(userAgent) {
  if (!userAgent) return false;
  return BOT_PATTERNS.some(p => p.test(userAgent));
}

// ── UA parsing ─────────────────────────────────────────────────────────────────
function parseUserAgent(ua) {
  if (!ua) return { device_type: 'desktop', browser: 'Unknown', operating_system: 'Unknown' };

  let device_type = 'desktop';
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    device_type = 'tablet';
  } else if (/mobile|android|iphone|ipod|windows phone|blackberry|opera mini|iemobile/i.test(ua)) {
    device_type = 'mobile';
  }

  let browser = 'Other';
  if (/edg\//i.test(ua)) browser = 'Edge';
  else if (/opr\//i.test(ua) || /opera/i.test(ua)) browser = 'Opera';
  else if (/chrome\/[0-9]/i.test(ua) && !/chromium/i.test(ua)) browser = 'Chrome';
  else if (/firefox\/[0-9]/i.test(ua)) browser = 'Firefox';
  else if (/safari\/[0-9]/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/msie|trident/i.test(ua)) browser = 'IE';
  else if (/samsung/i.test(ua)) browser = 'Samsung Browser';

  let operating_system = 'Other';
  if (/windows nt/i.test(ua)) operating_system = 'Windows';
  else if (/mac os x/i.test(ua) && !/iphone|ipad|ipod/i.test(ua)) operating_system = 'macOS';
  else if (/iphone|ipad|ipod/i.test(ua)) operating_system = 'iOS';
  else if (/android/i.test(ua)) operating_system = 'Android';
  else if (/linux/i.test(ua)) operating_system = 'Linux';
  else if (/cros/i.test(ua)) operating_system = 'ChromeOS';

  return { device_type, browser, operating_system };
}

// ── Referrer helpers ───────────────────────────────────────────────────────────
function extractDomain(url) {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function categorizeReferrer(referrer, utmSource, utmMedium) {
  const src = (utmSource || '').toLowerCase();
  const med = (utmMedium || '').toLowerCase();

  if (med === 'email' || src === 'email' || src === 'newsletter') return 'Email';
  if (med === 'cpc' || med === 'ppc' || med === 'paid' || src === 'google_ads' || src === 'adwords') return 'Paid Search';
  if (med === 'paid_social' || med === 'paidsocial') return 'Social';
  if (src === 'google') return 'Google';
  if (src === 'bing' || src === 'microsoft') return 'Bing';
  if (src === 'facebook' || src === 'fb') return 'Facebook';
  if (src === 'instagram' || src === 'ig') return 'Instagram';
  if (src === 'tiktok' || src === 'tt') return 'TikTok';
  if (src === 'youtube' || src === 'yt') return 'YouTube';
  if (src === 'whatsapp' || src === 'wa') return 'WhatsApp';
  if (src === 'twitter' || src === 'x' || src === 't.co') return 'Twitter / X';
  if (src === 'linkedin') return 'LinkedIn';
  if (src === 'reddit') return 'Reddit';
  if (src === 'pinterest') return 'Pinterest';

  if (!referrer || referrer.trim() === '') return 'Direct';

  const domain = extractDomain(referrer) || '';
  if (/google\./i.test(domain)) return 'Google';
  if (/bing\.com/i.test(domain)) return 'Bing';
  if (/facebook\.com|fb\.com/i.test(domain)) return 'Facebook';
  if (/instagram\.com/i.test(domain)) return 'Instagram';
  if (/tiktok\.com/i.test(domain)) return 'TikTok';
  if (/youtube\.com|youtu\.be/i.test(domain)) return 'YouTube';
  if (/whatsapp\.com/i.test(domain)) return 'WhatsApp';
  if (/twitter\.com|t\.co|x\.com/i.test(domain)) return 'Twitter / X';
  if (/linkedin\.com/i.test(domain)) return 'LinkedIn';
  if (/reddit\.com/i.test(domain)) return 'Reddit';
  if (/pinterest\.com/i.test(domain)) return 'Pinterest';
  if (/mail\.|gmail\.|yahoo\.|outlook\.|hotmail\./i.test(domain)) return 'Email';

  if (src) return 'Other';
  return domain ? 'Other' : 'Direct';
}

// ── Write helpers ──────────────────────────────────────────────────────────────
async function trackEvent({
  event_type,
  anonymous_visitor_id,
  session_id,
  page_url,
  page_path,
  referrer,
  utm_source,
  utm_medium,
  utm_campaign,
  utm_content,
  utm_term,
  user_agent,
  metadata,
}) {
  const { device_type, browser, operating_system } = parseUserAgent(user_agent);
  await db.query(
    `INSERT INTO analytics_events
       (event_type, anonymous_visitor_id, session_id,
        page_url, page_path, referrer,
        utm_source, utm_medium, utm_campaign, utm_content, utm_term,
        user_agent, device_type, browser, operating_system, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)`,
    [
      event_type,
      anonymous_visitor_id || null,
      session_id || null,
      page_url || null,
      page_path || null,
      referrer || null,
      utm_source || null,
      utm_medium || null,
      utm_campaign || null,
      utm_content || null,
      utm_term || null,
      user_agent || null,
      device_type,
      browser,
      operating_system,
      metadata ? JSON.stringify(metadata) : null,
    ]
  );
}

async function upsertSession({
  anonymous_visitor_id,
  session_id,
  referrer,
  utm_source,
  utm_medium,
  utm_campaign,
  device_type,
  landing_page,
}) {
  const referrer_domain = extractDomain(referrer);
  const source_category = categorizeReferrer(referrer, utm_source, utm_medium);
  await db.query(
    `INSERT INTO analytics_sessions
       (session_id, anonymous_visitor_id, referrer, referrer_domain, source_category,
        utm_source, utm_medium, utm_campaign, device_type, landing_page)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (session_id) DO UPDATE SET updated_at = NOW()`,
    [
      session_id,
      anonymous_visitor_id || null,
      referrer || null,
      referrer_domain,
      source_category,
      utm_source || null,
      utm_medium || null,
      utm_campaign || null,
      device_type || null,
      landing_page || null,
    ]
  );
}

async function markSessionConverted(session_id, order_id) {
  if (!session_id || !order_id) return;
  await db.query(
    `UPDATE analytics_sessions
     SET converted_order_id = $1, updated_at = NOW()
     WHERE session_id = $2`,
    [order_id, session_id]
  );
}

// ── Date filter ────────────────────────────────────────────────────────────────
function getDateFilter(range) {
  switch (range) {
    case 'today':
      return `created_at >= NOW()::date`;
    case '7d':
      return `created_at >= NOW() - INTERVAL '7 days'`;
    case '30d':
      return `created_at >= NOW() - INTERVAL '30 days'`;
    default:
      return 'TRUE';
  }
}

function getSessionDateFilter(range) {
  switch (range) {
    case 'today':
      return `started_at >= NOW()::date`;
    case '7d':
      return `started_at >= NOW() - INTERVAL '7 days'`;
    case '30d':
      return `started_at >= NOW() - INTERVAL '30 days'`;
    default:
      return 'TRUE';
  }
}

function getOrderDateFilter(range) {
  switch (range) {
    case 'today':
      return `created_at >= NOW()::date`;
    case '7d':
      return `created_at >= NOW() - INTERVAL '7 days'`;
    case '30d':
      return `created_at >= NOW() - INTERVAL '30 days'`;
    default:
      return 'TRUE';
  }
}

// ── Read / analytics queries ───────────────────────────────────────────────────
async function getSummary(range) {
  const evFilter = getDateFilter(range);
  const sessFilter = getSessionDateFilter(range);
  const ordFilter = getOrderDateFilter(range);

  const [evRes, sessRes, ordRes, bulkRes] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views,
        COUNT(DISTINCT anonymous_visitor_id) AS unique_visitors
      FROM analytics_events
      WHERE ${evFilter}
    `),
    db.query(`
      SELECT COUNT(*) AS sessions
      FROM analytics_sessions
      WHERE ${sessFilter}
    `),
    db.query(`
      SELECT
        COUNT(*) AS total_orders,
        COALESCE(SUM(total_cents), 0) AS gross_revenue_cents
      FROM orders
      WHERE payment_status = 'paid' AND ${ordFilter}
    `),
    db.query(`
      SELECT COUNT(*) AS bulk_inquiries
      FROM bulk_inquiries
      WHERE ${ordFilter}
    `),
  ]);

  const page_views = parseInt(evRes.rows[0].page_views, 10) || 0;
  const unique_visitors = parseInt(evRes.rows[0].unique_visitors, 10) || 0;
  const sessions = parseInt(sessRes.rows[0].sessions, 10) || 0;
  const total_orders = parseInt(ordRes.rows[0].total_orders, 10) || 0;
  const gross_revenue_cents = parseInt(ordRes.rows[0].gross_revenue_cents, 10) || 0;
  const avg_order_value_cents = total_orders > 0 ? Math.round(gross_revenue_cents / total_orders) : 0;
  const conversion_rate = sessions > 0 ? ((total_orders / sessions) * 100).toFixed(2) : '0.00';
  const bulk_inquiries = parseInt(bulkRes.rows[0].bulk_inquiries, 10) || 0;

  return {
    page_views,
    unique_visitors,
    sessions,
    total_orders,
    gross_revenue_cents,
    avg_order_value_cents,
    conversion_rate,
    bulk_inquiries,
  };
}

async function getDailyStats(range) {
  const evFilter = getDateFilter(range);
  const ordFilter = getOrderDateFilter(range);

  const [evRes, ordRes] = await Promise.all([
    db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views,
        COUNT(DISTINCT anonymous_visitor_id) AS unique_visitors,
        COUNT(DISTINCT session_id) AS sessions
      FROM analytics_events
      WHERE ${evFilter}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `),
    db.query(`
      SELECT
        DATE(created_at) AS date,
        COUNT(*) AS orders
      FROM orders
      WHERE payment_status = 'paid' AND ${ordFilter}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `),
  ]);

  const orderMap = {};
  for (const row of ordRes.rows) {
    orderMap[row.date.toISOString().slice(0, 10)] = parseInt(row.orders, 10);
  }

  return evRes.rows.map(r => {
    const dateStr = r.date.toISOString().slice(0, 10);
    return {
      date: dateStr,
      page_views: parseInt(r.page_views, 10) || 0,
      unique_visitors: parseInt(r.unique_visitors, 10) || 0,
      sessions: parseInt(r.sessions, 10) || 0,
      orders: orderMap[dateStr] || 0,
    };
  });
}

async function getTopReferrers(range) {
  const sessFilter = getSessionDateFilter(range);
  const { rows } = await db.query(`
    SELECT
      s.referrer_domain,
      s.source_category,
      COUNT(DISTINCT s.session_id) AS sessions,
      COUNT(e.id) FILTER (WHERE e.event_type = 'page_view') AS page_views,
      COUNT(DISTINCT s.converted_order_id) FILTER (WHERE s.converted_order_id IS NOT NULL) AS orders
    FROM analytics_sessions s
    LEFT JOIN analytics_events e ON e.session_id = s.session_id
    WHERE ${sessFilter}
    GROUP BY s.referrer_domain, s.source_category
    ORDER BY sessions DESC
    LIMIT 20
  `);

  return rows.map(r => {
    const sessions = parseInt(r.sessions, 10) || 0;
    const orders = parseInt(r.orders, 10) || 0;
    return {
      referrer_domain: r.referrer_domain || 'Direct',
      source_category: r.source_category || 'Direct',
      sessions,
      page_views: parseInt(r.page_views, 10) || 0,
      orders,
      conversion_rate: sessions > 0 ? ((orders / sessions) * 100).toFixed(2) : '0.00',
    };
  });
}

async function getTopPages(range) {
  const evFilter = getDateFilter(range);
  const { rows } = await db.query(`
    SELECT
      page_path,
      COUNT(*) FILTER (WHERE event_type = 'page_view') AS page_views,
      COUNT(DISTINCT anonymous_visitor_id) AS unique_visitors
    FROM analytics_events
    WHERE event_type = 'page_view' AND ${evFilter}
    GROUP BY page_path
    ORDER BY page_views DESC
    LIMIT 20
  `);

  return rows.map(r => ({
    page_path: r.page_path || '/',
    page_views: parseInt(r.page_views, 10) || 0,
    unique_visitors: parseInt(r.unique_visitors, 10) || 0,
  }));
}

async function getDeviceBreakdown(range) {
  const evFilter = getDateFilter(range);
  const { rows } = await db.query(`
    SELECT
      device_type,
      COUNT(*) AS count
    FROM analytics_events
    WHERE event_type = 'page_view' AND ${evFilter}
    GROUP BY device_type
    ORDER BY count DESC
  `);

  const total = rows.reduce((sum, r) => sum + parseInt(r.count, 10), 0);
  return rows.map(r => {
    const count = parseInt(r.count, 10);
    return {
      device_type: r.device_type || 'unknown',
      count,
      pct: total > 0 ? ((count / total) * 100).toFixed(1) : '0.0',
    };
  });
}

async function getFunnel(range) {
  const evFilter = getDateFilter(range);
  const ordFilter = getOrderDateFilter(range);

  const [evRes, ordRes, bulkRes] = await Promise.all([
    db.query(`
      SELECT
        COUNT(*) FILTER (WHERE event_type = 'product_view') AS product_views,
        COUNT(*) FILTER (WHERE event_type = 'video_play') AS video_plays,
        COUNT(*) FILTER (WHERE event_type = 'checkout_started') AS checkout_started,
        COUNT(*) FILTER (WHERE event_type = 'checkout_completed') AS checkout_completed
      FROM analytics_events
      WHERE ${evFilter}
    `),
    db.query(`SELECT COUNT(*) AS cnt FROM orders WHERE payment_status='paid' AND ${ordFilter}`),
    db.query(`SELECT COUNT(*) AS cnt FROM bulk_inquiries WHERE ${ordFilter}`),
  ]);

  const product_views = parseInt(evRes.rows[0].product_views, 10) || 0;
  const video_plays = parseInt(evRes.rows[0].video_plays, 10) || 0;
  const checkout_started = parseInt(evRes.rows[0].checkout_started, 10) || 0;
  const checkout_completed = parseInt(ordRes.rows[0].cnt, 10) || 0;
  const bulk_inquiries = parseInt(bulkRes.rows[0].cnt, 10) || 0;

  const pct = (num, denom) => (denom > 0 ? ((num / denom) * 100).toFixed(1) : '0.0');

  return {
    product_views,
    video_plays,
    checkout_started,
    checkout_completed,
    bulk_inquiries,
    pct_video: pct(video_plays, product_views),
    pct_checkout: pct(checkout_started, product_views),
    pct_completed: pct(checkout_completed, checkout_started),
    pct_bulk: pct(bulk_inquiries, product_views),
  };
}

async function getRecentEvents(range) {
  const evFilter = getDateFilter(range);
  const { rows } = await db.query(`
    SELECT
      id, event_type, anonymous_visitor_id, session_id,
      page_path, referrer, device_type, browser, operating_system, metadata, created_at
    FROM analytics_events
    WHERE ${evFilter}
    ORDER BY created_at DESC
    LIMIT 50
  `);
  return rows;
}

async function getUtmStats(range) {
  const sessFilter = getSessionDateFilter(range);
  const { rows } = await db.query(`
    SELECT
      s.utm_source,
      s.utm_medium,
      s.utm_campaign,
      COUNT(DISTINCT s.session_id) AS sessions,
      COUNT(DISTINCT s.converted_order_id) FILTER (WHERE s.converted_order_id IS NOT NULL) AS orders,
      COALESCE(SUM(o.total_cents), 0) AS revenue_cents
    FROM analytics_sessions s
    LEFT JOIN orders o ON o.id = s.converted_order_id AND o.payment_status = 'paid'
    WHERE (s.utm_source IS NOT NULL OR s.utm_medium IS NOT NULL OR s.utm_campaign IS NOT NULL)
      AND ${sessFilter}
    GROUP BY s.utm_source, s.utm_medium, s.utm_campaign
    ORDER BY sessions DESC
    LIMIT 30
  `);

  return rows.map(r => {
    const sessions = parseInt(r.sessions, 10) || 0;
    const orders = parseInt(r.orders, 10) || 0;
    return {
      utm_source: r.utm_source || '',
      utm_medium: r.utm_medium || '',
      utm_campaign: r.utm_campaign || '',
      sessions,
      orders,
      revenue_cents: parseInt(r.revenue_cents, 10) || 0,
      conversion_rate: sessions > 0 ? ((orders / sessions) * 100).toFixed(2) : '0.00',
    };
  });
}

async function getCouponStats() {
  const { rows } = await db.query(`
    SELECT
      discount_code,
      COUNT(*) AS uses,
      COALESCE(SUM(total_cents), 0) AS revenue_cents,
      COALESCE(SUM(discount_amount_cents), 0) AS total_discount_cents
    FROM orders
    WHERE payment_status = 'paid'
      AND discount_code IS NOT NULL
      AND discount_code != ''
    GROUP BY discount_code
    ORDER BY uses DESC
  `);

  return rows.map(r => ({
    discount_code: r.discount_code,
    uses: parseInt(r.uses, 10),
    revenue_cents: parseInt(r.revenue_cents, 10),
    total_discount_cents: parseInt(r.total_discount_cents, 10),
  }));
}

module.exports = {
  isBot,
  parseUserAgent,
  extractDomain,
  categorizeReferrer,
  trackEvent,
  upsertSession,
  markSessionConverted,
  getDateFilter,
  getSummary,
  getDailyStats,
  getTopReferrers,
  getTopPages,
  getDeviceBreakdown,
  getFunnel,
  getRecentEvents,
  getUtmStats,
  getCouponStats,
};
