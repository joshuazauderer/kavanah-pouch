const express = require('express');
const { isBot, trackEvent, upsertSession, parseUserAgent } = require('../services/analyticsService');

const router = express.Router();

router.post('/api/analytics/track', async (req, res) => {
  // Always return 200 regardless of outcome
  res.json({ ok: true });

  try {
    const {
      event_type,
      anonymous_visitor_id,
      session_id,
      is_new_session,
      page_url,
      page_path,
      referrer,
      utm_source,
      utm_medium,
      utm_campaign,
      utm_content,
      utm_term,
      metadata,
    } = req.body;

    // Skip if no event type
    if (!event_type) return;

    // Skip admin pages
    if (page_path && page_path.startsWith('/admin')) return;

    // Skip bots
    const ua = req.headers['user-agent'] || '';
    if (isBot(ua)) return;

    const { device_type } = parseUserAgent(ua);

    // Upsert session on new session or page_view
    if (session_id && (is_new_session || event_type === 'page_view')) {
      await upsertSession({
        anonymous_visitor_id,
        session_id,
        referrer,
        utm_source,
        utm_medium,
        utm_campaign,
        device_type,
        landing_page: page_path || null,
      });
    }

    await trackEvent({
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
      user_agent: ua,
      metadata,
    });
  } catch (err) {
    console.error('Analytics track error:', err.message);
  }
});

module.exports = router;
