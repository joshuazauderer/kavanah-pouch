(function () {
  'use strict';

  // Skip admin pages
  if (window.location.pathname.indexOf('/admin') === 0) return;

  // ── UUID v4 ──────────────────────────────────────────────────────────────────
  function uuidv4() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
      var r = (Math.random() * 16) | 0;
      var v = c === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  // ── Visitor ID (persistent in localStorage) ──────────────────────────────────
  var VID_KEY = '_kp_vid';
  var visitorId = null;
  try {
    visitorId = localStorage.getItem(VID_KEY);
    if (!visitorId) {
      visitorId = uuidv4();
      localStorage.setItem(VID_KEY, visitorId);
    }
  } catch (e) {
    visitorId = uuidv4();
  }

  // ── Session ID (per-tab, 30-min timeout) ─────────────────────────────────────
  var SID_KEY = '_kp_sid';
  var STIME_KEY = '_kp_stime';
  var SESSION_TIMEOUT = 30 * 60 * 1000; // 30 minutes

  function getOrCreateSession() {
    var sid = null;
    var isNewSession = false;
    try {
      var existing = sessionStorage.getItem(SID_KEY);
      var lastTime = parseInt(sessionStorage.getItem(STIME_KEY) || '0', 10);
      var now = Date.now();

      if (existing && (now - lastTime) < SESSION_TIMEOUT) {
        sid = existing;
        sessionStorage.setItem(STIME_KEY, String(now));
      } else {
        sid = uuidv4();
        isNewSession = true;
        sessionStorage.setItem(SID_KEY, sid);
        sessionStorage.setItem(STIME_KEY, String(now));
      }
    } catch (e) {
      sid = uuidv4();
      isNewSession = true;
    }
    return { sid: sid, isNewSession: isNewSession };
  }

  var sessionInfo = getOrCreateSession();
  var sessionId = sessionInfo.sid;
  var isNewSession = sessionInfo.isNewSession;

  // ── UTM params (persist in sessionStorage, merge across navigations) ─────────
  var UTM_KEY = '_kp_utms';
  var UTM_FIELDS = ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term'];

  function parseUtmsFromUrl() {
    var params = new URLSearchParams(window.location.search);
    var utms = {};
    UTM_FIELDS.forEach(function (f) {
      var val = params.get(f);
      if (val) utms[f] = val;
    });
    return utms;
  }

  function loadStoredUtms() {
    try {
      var raw = sessionStorage.getItem(UTM_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch (e) {
      return {};
    }
  }

  function saveUtms(utms) {
    try {
      sessionStorage.setItem(UTM_KEY, JSON.stringify(utms));
    } catch (e) {}
  }

  var storedUtms = loadStoredUtms();
  var pageUtms = parseUtmsFromUrl();
  // Page UTMs take precedence over stored, but stored fill in gaps
  var currentUtms = Object.assign({}, storedUtms, pageUtms);
  saveUtms(currentUtms);

  // ── Track function ───────────────────────────────────────────────────────────
  function track(eventType, metadata) {
    try {
      var payload = {
        event_type: eventType,
        anonymous_visitor_id: visitorId,
        session_id: sessionId,
        is_new_session: isNewSession,
        page_url: window.location.href,
        page_path: window.location.pathname,
        referrer: document.referrer || '',
        utm_source: currentUtms.utm_source || '',
        utm_medium: currentUtms.utm_medium || '',
        utm_campaign: currentUtms.utm_campaign || '',
        utm_content: currentUtms.utm_content || '',
        utm_term: currentUtms.utm_term || '',
        metadata: metadata || null,
      };

      var body = JSON.stringify(payload);
      var url = '/api/analytics/track';

      if (typeof navigator.sendBeacon === 'function') {
        navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
      } else {
        fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body,
          keepalive: true,
        }).catch(function () {});
      }
    } catch (e) {}
  }

  // ── Page view ────────────────────────────────────────────────────────────────
  track('page_view');

  // ── Product view (homepage only) ─────────────────────────────────────────────
  if (window.location.pathname === '/') {
    track('product_view');
  }

  // ── Video play (once per session) ────────────────────────────────────────────
  function hookVideos() {
    var videos = document.querySelectorAll('video');
    videos.forEach(function (video) {
      var fired = false;
      var vpKey = '_kp_vp_' + sessionId;
      try {
        if (sessionStorage.getItem(vpKey)) fired = true;
      } catch (e) {}

      if (!fired) {
        var handler = function () {
          try {
            if (sessionStorage.getItem(vpKey)) return;
            sessionStorage.setItem(vpKey, '1');
          } catch (e) {}
          track('video_play');
          video.removeEventListener('play', handler);
        };
        video.addEventListener('play', handler);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', hookVideos);
  } else {
    hookVideos();
  }

  // ── Checkout forms: track started + populate hidden fields ───────────────────
  function hookCheckoutForms() {
    var forms = document.querySelectorAll('form[action="/api/checkout"]');
    forms.forEach(function (form) {
      // Add hidden visitor/session fields if not already present
      if (!form.querySelector('input[name="_visitor_id"]')) {
        var vidInput = document.createElement('input');
        vidInput.type = 'hidden';
        vidInput.name = '_visitor_id';
        vidInput.value = visitorId;
        form.appendChild(vidInput);
      } else {
        form.querySelector('input[name="_visitor_id"]').value = visitorId;
      }

      if (!form.querySelector('input[name="_session_id"]')) {
        var sidInput = document.createElement('input');
        sidInput.type = 'hidden';
        sidInput.name = '_session_id';
        sidInput.value = sessionId;
        form.appendChild(sidInput);
      } else {
        form.querySelector('input[name="_session_id"]').value = sessionId;
      }

      form.addEventListener('submit', function () {
        var priceKeyInput = form.querySelector('input[name="priceKey"]');
        var pack = priceKeyInput ? priceKeyInput.value : '';
        track('checkout_started', { pack: pack });
      });
    });
  }

  // ── Bulk inquiry form ────────────────────────────────────────────────────────
  function hookBulkForm() {
    var form = document.querySelector('form[action="/api/bulk-inquiry"]');
    if (!form) return;
    form.addEventListener('submit', function () {
      var qtyInput = form.querySelector('select[name="quantity"], input[name="quantity"]');
      var qty = qtyInput ? qtyInput.value : '';
      track('bulk_inquiry_submitted', { quantity: qty });
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      hookCheckoutForms();
      hookBulkForm();
    });
  } else {
    hookCheckoutForms();
    hookBulkForm();
  }

  // ── Expose for inline scripts ────────────────────────────────────────────────
  window._kpTrack = track;
})();
