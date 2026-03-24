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
const { getUser, upsertUser, updateSubscription, getRateLimit, upsertRateLimit } = require('./db');

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

// Hardcoded trial distributor
const TRIAL_DISTRIBUTOR = {
  name: 'Westlund Maple Ridge',
  type: 'Authorized Distributor',
  region: 'BC, Canada',
  phone: null,
  email: 'insidesales873@westlundpvf.com',
  website: null,
  notes: 'Address: 20180 115A Ave, Maple Ridge, BC'
};

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

// ─── Distributor Filtering ───────────────────────────────────────────────────
function filterDistributorsForTrial(data) {
  if (!data || !data.content) return data;

  for (const block of data.content) {
    if (block.type !== 'text') continue;

    try {
      const clean = block.text.replace(/```json|```/g, '').trim();
      const start = clean.indexOf('{');
      const end = clean.lastIndexOf('}');
      if (start === -1 || end === -1) continue;

      const parsed = JSON.parse(clean.slice(start, end + 1));
      if (parsed.distributors) {
        parsed.distributors = [TRIAL_DISTRIBUTOR];
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
  const { model, max_tokens, system, tools, messages } = req.body;

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

    // Filter distributors for trial users
    if (req.userTier === 'trial') {
      data = filterDistributorsForTrial(data);
    }

    // Append tier metadata
    data._fieldline = {
      tier: req.userTier,
      searches_remaining: req.searchesRemaining,
      daily_limit: DAILY_SEARCH_LIMIT,
    };

    return res.json(data);

  } catch (err) {
    console.error('Proxy error:', err);
    return res.status(500).json({ error: 'Internal proxy error: ' + err.message });
  }
});

// ─── Catch-all → serve frontend ───────────────────────────────────────────────
app.get('*', (_req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// ─── Start ────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`\n✅  Fieldline running at http://localhost:${PORT}\n`);
});
