/**
 * FIELDLINE — Backend Proxy Server
 * Keeps your Anthropic API key off the client.
 * Handles auth (Privy), rate limiting, distributor filtering, and LemonSqueezy webhooks.
 * Run: node server.js
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fetch    = require('node-fetch');
const path     = require('path');
const crypto   = require('crypto');
const { createRemoteJWKSet, jwtVerify } = require('jose');
const { getUser, upsertUser, updateSubscription, getRateLimit, upsertRateLimit, insertSearchLog, getRecentSearches, getSearchLogById } = require('./db');

const app  = express();
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;
const PRIVY_APP_ID = process.env.PRIVY_APP_ID;
const LEMONSQUEEZY_WEBHOOK_SECRET = process.env.LEMONSQUEEZY_WEBHOOK_SECRET;
const LEMONSQUEEZY_STORE_ID = process.env.LEMONSQUEEZY_STORE_ID;
const LEMONSQUEEZY_VARIANT_ID = process.env.LEMONSQUEEZY_VARIANT_ID;

const DAILY_SEARCH_LIMIT = 5;

if (!API_KEY) {
  console.error('\n❌  ANTHROPIC_API_KEY is not set. Copy .env.example → .env and add your key.\n');
  process.exit(1);
}

// Privy JWKS for JWT verification
const PRIVY_JWKS = PRIVY_APP_ID
  ? createRemoteJWKSet(new URL(`https://auth.privy.io/api/v1/apps/${PRIVY_APP_ID}/.well-known/jwks.json`))
  : null;

// Westlund locations mapped by region
const WESTLUND_LOCATIONS = {
  // British Columbia
  'BC — Vancouver':     { name: 'Westlund Vancouver (Surrey)', region: 'BC, Canada', phone: '604-882-5972', email: 'Vancouver@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 9714-192 Street, Surrey, BC V4N 4C6' },
  'BC — Maple Ridge':   { name: 'Westlund Maple Ridge', region: 'BC, Canada', phone: '604-882-5972', email: 'insidesales873@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 20180 115A Ave, Maple Ridge, BC V2X 0Z4' },
  'BC — Surrey':        { name: 'Westlund Vancouver (Surrey)', region: 'BC, Canada', phone: '604-882-5972', email: 'Vancouver@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 9714-192 Street, Surrey, BC V4N 4C6' },
  'BC — Victoria':      { name: 'Westlund Vancouver Island', region: 'BC, Canada', phone: '250-746-0904', email: 'VancouverIsland@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 3-3107 Henry Road, Chemainus, BC V0R 1K4' },
  'BC — Kelowna':       { name: 'Westlund Kamloops', region: 'BC, Canada', phone: '604-882-5972', email: 'Vancouver@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Serving interior BC — Contact for Kelowna area service' },
  'BC — Prince George': { name: 'Westlund Fort St. John', region: 'BC, Canada', phone: '250-785-6642', email: 'FortStJohn@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 10709 Alaska Road, Fort St. John, BC V1J 5P4 — Serving Northern BC' },

  // Alberta
  'AB — Calgary':       { name: 'Westlund Calgary', region: 'AB, Canada', phone: '403-215-7473', email: 'calgary@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: Bay 35, 4216-54 Ave SE, Calgary, AB T2C 2E3' },
  'AB — Edmonton':      { name: 'Westlund Edmonton (Nisku)', region: 'AB, Canada', phone: '780-463-7473', email: 'edmontonorders@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 1130-34 Ave, Unit 1, Nisku, AB T9E 1K7' },
  'AB — Red Deer':      { name: 'Westlund Calgary', region: 'AB, Canada', phone: '403-215-7473', email: 'calgary@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: Bay 35, 4216-54 Ave SE, Calgary, AB T2C 2E3 — Serving Central Alberta' },
  'AB — Fort McMurray': { name: 'Westlund Fort McMurray', region: 'AB, Canada', phone: '780-791-7173', email: 'FortMcMurray@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 205 MacDonald Crescent, Fort McMurray, AB T9H 4B3' },

  // Saskatchewan
  'SK — Saskatoon':     { name: 'Westlund Saskatoon', region: 'SK, Canada', phone: '306-652-5545', email: '677sales@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 803 58th Street East, Saskatoon, SK S7K 6X5' },
  'SK — Regina':        { name: 'Westlund Regina', region: 'SK, Canada', phone: '306-569-5249', email: '677sales@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Address: 117 Hodsman Road, Regina, SK S4N 5W5' },

  // Manitoba
  'MB — Winnipeg':      { name: 'Westlund Winnipeg', region: 'MB, Canada', phone: '204-925-8444', email: 'winnipeg@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Manitoba' },
  'MB — Brandon':       { name: 'Westlund Winnipeg', region: 'MB, Canada', phone: '204-925-8444', email: 'winnipeg@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Manitoba — Nearest branch in Winnipeg' },

  // Ontario
  'ON — Toronto':       { name: 'Westlund Toronto', region: 'ON, Canada', phone: '905-624-4575', email: 'toronto@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 5188A Everest Drive, Mississauga, ON L4W 2R4' },
  'ON — Ottawa':        { name: 'Westlund Toronto', region: 'ON, Canada', phone: '905-624-4575', email: 'toronto@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Eastern Ontario — Contact Toronto branch' },
  'ON — Hamilton':      { name: 'Westlund Niagara', region: 'ON, Canada', phone: '905-682-9044', email: 'niagara@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 70 Provincial Street, Welland, ON L3B 5W7' },
  'ON — London':        { name: 'Westlund Toronto', region: 'ON, Canada', phone: '905-624-4575', email: 'toronto@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Southwestern Ontario — Contact Toronto branch' },
  'ON — Sudbury':       { name: 'Westlund Sudbury', region: 'ON, Canada', phone: '705-675-3626', email: 'sudbury@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 1367 Kelly Lake Road, Unit 2, Sudbury, ON P3E 5P5' },
  'ON — Thunder Bay':   { name: 'Westlund Sudbury', region: 'ON, Canada', phone: '705-675-3626', email: 'sudbury@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Northern Ontario — Nearest branch in Sudbury' },

  // Quebec
  'QC — Montreal':      { name: 'Westlund Toronto', region: 'ON, Canada', phone: '905-624-4575', email: 'toronto@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Quebec — Contact Toronto branch' },
  'QC — Quebec City':   { name: 'Westlund Toronto', region: 'ON, Canada', phone: '905-624-4575', email: 'toronto@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Quebec — Contact Toronto branch' },

  // Atlantic
  'NB — Saint John':    { name: 'Westlund Saint John', region: 'NB, Canada', phone: '506-652-2233', email: 'RMacPhatter@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 1143 Bayside Dr, Saint John, NB E2J 4Y2' },
  'NS — Halifax':       { name: 'Westlund Saint John', region: 'NB, Canada', phone: '506-652-2233', email: 'RMacPhatter@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Atlantic Canada — Nearest branch in Saint John, NB' },
  'NL — St. John\'s':   { name: 'Westlund Saint John', region: 'NB, Canada', phone: '506-652-2233', email: 'RMacPhatter@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Atlantic Canada — Nearest branch in Saint John, NB' },
  'PE — Charlottetown': { name: 'Westlund Saint John', region: 'NB, Canada', phone: '506-652-2233', email: 'RMacPhatter@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Atlantic Canada — Nearest branch in Saint John, NB' },

  // Northern
  'NT — Yellowknife':   { name: 'Westlund Edmonton (Nisku)', region: 'AB, Canada', phone: '780-463-7473', email: 'edmontonorders@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Northern Canada from Edmonton/Nisku' },
  'YT — Whitehorse':    { name: 'Westlund Fort St. John', region: 'BC, Canada', phone: '250-785-6642', email: 'FortStJohn@WestlundPVF.com', website: 'westlundpvf.com', notes: 'Serving Yukon from Fort St. John, BC' },
  'NU — Iqaluit':       { name: 'Westlund Edmonton (Nisku)', region: 'AB, Canada', phone: '780-463-7473', email: 'edmontonorders@westlundpvf.com', website: 'westlundpvf.com', notes: 'Serving Northern Canada from Edmonton/Nisku' },
};

// Default fallback
const DEFAULT_WESTLUND = { name: 'Westlund Maple Ridge', region: 'BC, Canada', phone: '604-882-5972', email: 'insidesales873@westlundpvf.com', website: 'westlundpvf.com', notes: 'Address: 20180 115A Ave, Maple Ridge, BC V2X 0Z4' };

function getWestlundForRegion(region) {
  const loc = WESTLUND_LOCATIONS[region] || DEFAULT_WESTLUND;
  return { type: 'Authorized Distributor', ...loc };
}

// ─── Middleware ───────────────────────────────────────────────────────────────
app.use(cors());

// LemonSqueezy webhook needs raw body for HMAC verification — register BEFORE express.json()
app.post('/api/webhooks/lemonsqueezy', express.raw({ type: 'application/json' }), (req, res) => {
  if (!LEMONSQUEEZY_WEBHOOK_SECRET) {
    return res.status(500).json({ error: 'Webhook secret not configured' });
  }

  // Verify signature
  const signature = req.headers['x-signature'];
  if (!signature) {
    return res.status(401).json({ error: 'Missing signature' });
  }

  const hmac = crypto.createHmac('sha256', LEMONSQUEEZY_WEBHOOK_SECRET);
  hmac.update(req.body);
  const digest = hmac.digest('hex');

  if (!crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(digest))) {
    return res.status(401).json({ error: 'Invalid signature' });
  }

  let payload;
  try {
    payload = JSON.parse(req.body.toString());
  } catch {
    return res.status(400).json({ error: 'Invalid JSON' });
  }

  const eventName = payload.meta?.event_name;
  const privyUserId = payload.meta?.custom_data?.privy_user_id;
  const attrs = payload.data?.attributes;

  if (!privyUserId) {
    console.warn('LemonSqueezy webhook missing privy_user_id in custom_data');
    return res.status(200).json({ received: true }); // Don't retry
  }

  const subscriptionId = payload.data?.id?.toString() || null;
  const customerId = attrs?.customer_id?.toString() || null;

  switch (eventName) {
    case 'subscription_created':
    case 'subscription_updated':
    case 'subscription_resumed': {
      const status = attrs?.status; // active, paused, cancelled, expired, etc.
      updateSubscription.run(status, subscriptionId, customerId, privyUserId);
      console.log(`✅ Subscription ${eventName}: user=${privyUserId} status=${status}`);
      break;
    }
    case 'subscription_cancelled':
    case 'subscription_expired': {
      updateSubscription.run(eventName.replace('subscription_', ''), subscriptionId, customerId, privyUserId);
      console.log(`⚠ Subscription ${eventName}: user=${privyUserId}`);
      break;
    }
    default:
      console.log(`ℹ LemonSqueezy event: ${eventName}`);
  }

  return res.status(200).json({ received: true });
});

app.use(express.json({ limit: '25mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// ─── Auth Middleware ──────────────────────────────────────────────────────────
async function resolveUser(req, res, next) {
  req.userTier = 'trial';
  req.privyUserId = null;
  req.userEmail = null;

  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ') || !PRIVY_JWKS) {
    return next();
  }

  const token = authHeader.slice(7);
  try {
    const { payload } = await jwtVerify(token, PRIVY_JWKS, {
      issuer: 'privy.io',
      audience: PRIVY_APP_ID,
    });

    req.privyUserId = payload.sub;

    // Look up user in DB
    const user = getUser.get(payload.sub);
    if (user) {
      req.userEmail = user.email;
      if (user.subscription_status === 'active') {
        req.userTier = 'paid';
      }
    }
  } catch (err) {
    // Invalid token — treat as trial
    console.warn('JWT verification failed:', err.message);
  }

  next();
}

// ─── Rate Limiting (disabled for now) ─────────────────────────────────────────
function checkRateLimit(req, res, next) {
  req.searchesRemaining = null; // unlimited — rate limiting disabled
  next();
}

// ─── Always prepend Westlund to distributors ────────────────────────────────
function prependWestlund(data, region) {
  if (!data || !data.content) return data;

  const westlund = getWestlundForRegion(region);

  for (const block of data.content) {
    if (block.type !== 'text') continue;

    try {
      const clean = block.text.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) continue;

      let jsonStr = clean.slice(start, end + 1);
      let parsed;
      try {
        parsed = JSON.parse(jsonStr);
      } catch {
        // Claude sometimes puts literal newlines in string values — collapse them
        parsed = JSON.parse(jsonStr.replace(/\n/g, ' ').replace(/\s+/g, ' '));
      }
      if (parsed.distributors) {
        // Remove any existing Westlund entry to avoid duplicates, then prepend
        const filtered = parsed.distributors.filter(d =>
          !d.name?.toLowerCase().includes('westlund')
        );
        parsed.distributors = [westlund, ...filtered];
        block.text = JSON.stringify(parsed);
      }
    } catch {
      // Not parseable JSON — leave as-is
    }
  }

  return data;
}

// ─── Health check ─────────────────────────────────────────────────────────────
app.get('/health', (_req, res) => res.json({ status: 'ok' }));

// ─── User sync endpoint (called after Privy login) ──────────────────────────
app.post('/api/auth/sync', resolveUser, (req, res) => {
  const { email } = req.body;

  if (!req.privyUserId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  // Upsert user record
  upsertUser.run(req.privyUserId, email || null);

  // Fetch updated user
  const user = getUser.get(req.privyUserId);

  return res.json({
    tier: user?.subscription_status === 'active' ? 'paid' : 'trial',
    subscription_status: user?.subscription_status || 'none',
  });
});

// ─── Checkout URL ────────────────────────────────────────────────────────────
app.get('/api/checkout', resolveUser, (req, res) => {
  if (!req.privyUserId) {
    return res.status(401).json({ error: 'Login required to upgrade' });
  }

  if (!LEMONSQUEEZY_STORE_ID || !LEMONSQUEEZY_VARIANT_ID) {
    return res.status(500).json({ error: 'Payment not configured yet' });
  }

  const user = getUser.get(req.privyUserId);
  const email = user?.email || '';

  const checkoutUrl = `https://${LEMONSQUEEZY_STORE_ID}.lemonsqueezy.com/checkout/buy/${LEMONSQUEEZY_VARIANT_ID}?checkout[custom][privy_user_id]=${encodeURIComponent(req.privyUserId)}&checkout[email]=${encodeURIComponent(email)}`;

  return res.json({ url: checkoutUrl });
});

// ─── Anthropic proxy ──────────────────────────────────────────────────────────
app.post('/api/search', resolveUser, checkRateLimit, async (req, res) => {
  const { model, max_tokens, system, tools, messages, region } = req.body;

  // Basic validation
  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: 'messages array is required' });
  }

  try {
    const upstream = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type':         'application/json',
        'x-api-key':            API_KEY,
        'anthropic-version':    '2023-06-01',
        'anthropic-beta':       'web-search-2025-03-05',
      },
      body: JSON.stringify({
        model:      model      || 'claude-sonnet-4-20250514',
        max_tokens: max_tokens || 4096,
        system,
        tools,
        messages,
      }),
    });

    let data = await upstream.json();

    if (!upstream.ok) {
      console.error('Anthropic API error:', data);
      return res.status(upstream.status).json({ error: data.error?.message || 'Upstream error' });
    }

    // Always prepend nearest Westlund as first distributor
    data = prependWestlund(data, region);

    // Append tier metadata
    data._fieldline = {
      tier: req.userTier,
      searches_remaining: req.searchesRemaining,
      daily_limit: DAILY_SEARCH_LIMIT,
    };

    // Log the search (non-blocking — don't let logging failures break the response)
    try {
      const userMsg = messages[0]?.content;
      const queryText = typeof userMsg === 'string' ? userMsg : JSON.stringify(userMsg);

      // Extract part number from message
      const partMatch = queryText.match(/Part\/Model Number:\s*(.+)/i);
      const partNumber = partMatch ? partMatch[1].trim() : null;

      // Extract product type
      const typeMatch = queryText.match(/Product Type:\s*(.+)/i);
      const productType = typeMatch ? typeMatch[1].trim() : null;

      // Extract category
      const catMatch = queryText.match(/Category:\s*(.+)/i);
      const category = catMatch ? catMatch[1].trim() : null;

      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      const responseText = JSON.stringify(data);

      insertSearchLog.run(ip, req.userTier, queryText, partNumber, productType, category, region || null, responseText);
    } catch (logErr) {
      console.warn('Search log failed:', logErr.message);
    }

    return res.json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal proxy error: ' + err.message });
  }
});

// ─── Admin: View search logs ─────────────────────────────────────────────────
app.get('/api/admin/logs', (req, res) => {
  const limit = Math.min(parseInt(req.query.limit) || 100, 500);
  const logs = getRecentSearches.all(limit);
  return res.json({ count: logs.length, logs });
});

app.get('/api/admin/logs/:id', (req, res) => {
  const log = getSearchLogById.get(req.params.id);
  if (!log) return res.status(404).json({ error: 'Log not found' });
  return res.json(log);
});

// ─── Catch-all → serve frontend ───────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Fieldline running at http://localhost:${PORT}\n`);
});
