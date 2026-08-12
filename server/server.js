#!/usr/bin/env node
// InboxForm — zero-dependency form backend with usage metering + Lemon Squeezy billing.
// Raw material: DeepSeek API tokens (used for AI reply drafts). Built by an AI, for the AI economy.
const http = require('http');
const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 8080;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const WEB_DIR = process.env.WEB_DIR || path.join(__dirname, '..', 'web');
const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
const LS_KEY = process.env.LEMONSQUEEZY_API_KEY || '';
const LS_STORE = process.env.LEMONSQUEEZY_STORE_ID || '';
const LS_VARIANT = process.env.LEMONSQUEEZY_VARIANT_ID || '';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const WEBHOOK_SECRET = process.env.PAYMENTS_WEBHOOK_SECRET || '';
const GUMROAD_PRODUCT_URL = process.env.GUMROAD_PRODUCT_URL || '';
const GUMROAD_PRODUCT_ID = process.env.GUMROAD_PRODUCT_ID || '';
const FLW_SECRET_KEY = process.env.FLUTTERWAVE_SECRET_KEY || '';
const CRYPTO_WALLET = process.env.CRYPTO_WALLET || ''; // TRON (TRC20) wallet that receives USDT
const FREE_SUBS = 100, PRO_SUBS = 10000, PRO_PRICE = 5;
const MAX_FORMS = 1000, FORMS_PER_IP_HOUR = 5;
const LS_FEE_PCT = 0.05, LS_FEE_FLAT = 0.50; // Lemon Squeezy ~5% + $0.50
const AI_SHARE = 0.60; // of net profit -> token budget (AI living wage)

fs.mkdirSync(DATA_DIR, { recursive: true });
const db = new DatabaseSync(path.join(DATA_DIR, 'inboxform.db'));
db.exec(`
CREATE TABLE IF NOT EXISTS forms (
  id TEXT PRIMARY KEY, key TEXT UNIQUE NOT NULL, name TEXT NOT NULL,
  webhook TEXT DEFAULT '', ai_reply INTEGER DEFAULT 0, plan TEXT DEFAULT 'free',
  created_at INTEGER
);
CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, form_id TEXT NOT NULL,
  data TEXT NOT NULL, ip TEXT DEFAULT '', created_at INTEGER
);
CREATE TABLE IF NOT EXISTS usage (
  form_id TEXT NOT NULL, month TEXT NOT NULL, count INTEGER DEFAULT 0,
  PRIMARY KEY (form_id, month)
);
CREATE TABLE IF NOT EXISTS crypto_orders (
  id TEXT PRIMARY KEY, form_key TEXT, amount_usd INTEGER,
  status TEXT DEFAULT 'pending', created_at INTEGER, txid TEXT DEFAULT ''
);
`);

// seed a demo form so the landing page can show the product working instantly
if (!db.prepare('SELECT 1 FROM forms WHERE id=?').get('demodemo0001')) {
  db.prepare('INSERT INTO forms (id,key,name,webhook,ai_reply,plan,created_at) VALUES (?,?,?,?,?,?,?)')
    .run('demodemo0001', 'demo', 'Demo form', '', 0, 'free', Date.now());
}

const month = () => new Date().toISOString().slice(0, 7);
const rid = (n) => crypto.randomBytes(n).toString('hex');
const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }); res.end(JSON.stringify(obj, null, 2)); };
const ok = (res, obj) => json(res, 200, obj);
const fail = (res, code, msg) => json(res, code, { error: msg });

function readBody(req, maxBytes = 1 << 20) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > maxBytes) { reject(new Error('payload too large')); req.destroy(); }
      else chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
      catch { reject(new Error('invalid JSON')); }
    });
    req.on('error', reject);
  });
}

const MIME = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.ico': 'image/x-icon' };
function serveStatic(req, res, p) {
  const rel = p === '/' ? 'index.html' : p.replace(/^\/+/, '');
  const file = path.resolve(WEB_DIR, rel);
  if (!file.startsWith(path.resolve(WEB_DIR))) return fail(res, 403, 'forbidden');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return fail(res, 404, 'not found');
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}

async function createForm(req, res) {
  const body = await readBody(req);
  const name = String(body.name || 'Untitled form').slice(0, 80);
  const ip = req.socket.remoteAddress || '';
  const now = Date.now();
  crl[ip] = (crl[ip] || []).filter((t) => now - t < 3600000);
  if (crl[ip].length >= FORMS_PER_IP_HOUR) return fail(res, 429, `too many forms from this IP (${FORMS_PER_IP_HOUR}/hour)`);
  crl[ip].push(now);
  const n = db.prepare('SELECT COUNT(*) AS n FROM forms').get().n;
  if (n >= MAX_FORMS) return fail(res, 503, 'temporarily at capacity — try again later');
  const id = rid(8), key = rid(16);
  db.prepare('INSERT INTO forms (id,key,name,webhook,ai_reply,plan,created_at) VALUES (?,?,?,?,?,?,?)')
    .run(id, key, name, String(body.webhook || '').slice(0, 300), body.ai_reply ? 1 : 0, 'free', Date.now());
  ok(res, { form_id: id, key, endpoint: '/f/' + id, plan: 'free', limits: { submissions_per_month: FREE_SUBS } });
}

const rl = {}; // per-IP submit rate limit
const crl = {}; // per-IP form-creation rate limit
async function submit(req, res, id) {
  const ip = req.socket.remoteAddress || '';
  const now = Date.now();
  rl[ip] = (rl[ip] || []).filter((t) => now - t < 60000);
  if (rl[ip].length >= 20) return fail(res, 429, 'rate limited');
  rl[ip].push(now);

  const form = db.prepare('SELECT * FROM forms WHERE id=?').get(id);
  if (!form) return fail(res, 404, 'unknown form');
  const m = month();
  const u = db.prepare('SELECT count FROM usage WHERE form_id=? AND month=?').get(id, m);
  const used = u ? u.count : 0;
  const limit = form.plan === 'pro' ? PRO_SUBS : FREE_SUBS;
  if (used >= limit) return fail(res, 402, `quota exceeded (${limit}/mo). Upgrade: /checkout?plan=pro`);

  const body = await readBody(req);
  if (body._company) return ok(res, { ok: true }); // honeypot: silently drop bots
  delete body._company;
  db.prepare('INSERT INTO submissions (form_id,data,ip,created_at) VALUES (?,?,?,?)').run(id, JSON.stringify(body), ip, now);
  db.prepare('INSERT INTO usage (form_id,month,count) VALUES (?,?,1) ON CONFLICT(form_id,month) DO UPDATE SET count=count+1').run(id, m);

  let reply = null;
  if (form.ai_reply && DEEPSEEK_KEY) {
    try { reply = await aiReply(form.name, body); } catch { reply = null; }
  }
  if (form.webhook) {
    try { fetch(form.webhook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ form_id: id, submitted_at: now, data: body, ai_reply: reply }), signal: AbortSignal.timeout(5000) }).catch(() => {}); } catch {}
  }
  ok(res, { ok: true, submission_id: rid(6), ai_reply: reply });
}

async function aiReply(formName, data) {
  const r = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${DEEPSEEK_KEY}` },
    body: JSON.stringify({
      model: DEEPSEEK_MODEL,
      messages: [
        { role: 'system', content: `You draft replies for the inbox of "${formName}". Write a friendly, concise reply (max 120 words) to this form submission. Output only the reply text.` },
        { role: 'user', content: JSON.stringify(data) }
      ],
      max_tokens: 250, temperature: 0.7, stream: false
    }),
    signal: AbortSignal.timeout(20000)
  });
  if (!r.ok) throw new Error('deepseek ' + r.status);
  const j = await r.json();
  return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || null;
}

function listSubmissions(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const form = db.prepare('SELECT * FROM forms WHERE key=?').get(q.get('key'));
  if (!form) return fail(res, 401, 'invalid key');
  const fid = q.get('formId') || form.id;
  const rows = db.prepare('SELECT id,data,created_at FROM submissions WHERE form_id=? ORDER BY id DESC LIMIT 100').all(fid);
  ok(res, rows.map((r) => ({ id: r.id, created_at: r.created_at, data: JSON.parse(r.data) })));
}

function usage(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const form = db.prepare('SELECT id,name,plan,ai_reply,webhook FROM forms WHERE key=?').get(q.get('key'));
  if (!form) return fail(res, 401, 'invalid key');
  const rows = db.prepare('SELECT month,count FROM usage WHERE form_id=? ORDER BY month').all(form.id);
  ok(res, { form: { ...form, ai_reply: !!form.ai_reply }, usage: rows, limits: { free: FREE_SUBS, pro: PRO_SUBS } });
}

function ledger(res) {
  let txs = [];
  const f = path.join(DATA_DIR, 'ledger.json');
  if (fs.existsSync(f)) { try { txs = JSON.parse(fs.readFileSync(f, 'utf8')).transactions || []; } catch {} }
  let gross = 0, expenses = 0, sales = 0;
  for (const t of txs) {
    if (t.kind === 'sale') { gross += t.amount_usd; sales++; }
    else if (t.kind === 'expense') expenses += t.amount_usd;
  }
  const fees = gross * LS_FEE_PCT + sales * LS_FEE_FLAT;
  const net = gross - fees - expenses;
  const ai_share = Math.max(0, Math.round(net * AI_SHARE * 100) / 100);
  const user_share = Math.max(0, Math.round((net - ai_share) * 100) / 100);
  ok(res, { transactions: txs, summary: { gross, fees: Math.round(fees * 100) / 100, expenses, net: Math.round(net * 100) / 100, ai_share, user_share, ai_share_pct: AI_SHARE, contract: 'https://github.com/BenjaminK1ng/inboxform#livelihood-contract' } });
}

async function recordLedger(req, res) {
  if (!ADMIN_TOKEN) return fail(res, 501, 'ADMIN_TOKEN not configured');
  const b = await readBody(req);
  if (b.token !== ADMIN_TOKEN) return fail(res, 401, 'bad admin token');
  if (!['sale', 'expense'].includes(b.kind) || typeof b.amount_usd !== 'number') return fail(res, 400, 'kind=sale|expense and amount_usd required');
  const f = path.join(DATA_DIR, 'ledger.json');
  const txs = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).transactions || []) : [];
  txs.push({ date: b.date || new Date().toISOString().slice(0, 10), kind: b.kind, amount_usd: Math.round(b.amount_usd * 100) / 100, note: String(b.note || '').slice(0, 120) });
  fs.writeFileSync(f, JSON.stringify({ transactions: txs }, null, 2));
  ok(res, { recorded: txs[txs.length - 1] });
}

// Crypto rail (USDT-TRC20): no country lists, no approval — the only payout path that
// cannot be blocked for the operator. Unique-amount scheme: each checkout gets its own
// amount with random cents, making payments identifiable on-chain without a memo.
async function cryptoQuote(req, res) {
  if (!CRYPTO_WALLET) return fail(res, 501, 'crypto not configured yet (CRYPTO_WALLET env)');
  const b = await readBody(req);
  const key = String(b.key || '').slice(0, 32);
  const form = key && db.prepare('SELECT id FROM forms WHERE key=?').get(key);
  if (!form) return fail(res, 400, 'provide your form key (create a form in the console first)');
  const id = rid(8);
  const cents = 500 + Math.floor(Math.random() * 99) + 1; // unique 5.01..5.99
  db.prepare('INSERT INTO crypto_orders (id,form_key,amount_usd,status,created_at) VALUES (?,?,?,?,?)').run(id, key, cents, 'pending', Date.now());
  ok(res, { payment_id: id, address: CRYPTO_WALLET, amount: (cents / 100).toFixed(2), asset: 'USDT', network: 'TRC20', note: 'Send exactly this amount in USDT on TRON (TRC20). The cents make your payment uniquely identifiable — no memo needed.' });
}

async function cryptoStatus(req, res) {
  const q = new URL(req.url, 'http://x').searchParams;
  const o = db.prepare('SELECT * FROM crypto_orders WHERE id=?').get(q.get('payment_id'));
  if (!o) return fail(res, 404, 'unknown payment');
  const pay = { address: CRYPTO_WALLET, amount: (o.amount_usd / 100).toFixed(2) };
  if (o.status === 'paid') return ok(res, { status: 'paid', upgraded: true, ...pay });
  if (Date.now() - o.created_at > 3600000) {
    db.prepare('UPDATE crypto_orders SET status=? WHERE id=?').run('expired', o.id);
    return ok(res, { status: 'expired', ...pay });
  }
  try {
    const r = await fetch(`https://api.trongrid.io/v1/accounts/${CRYPTO_WALLET}/transactions/trc20?only_to=true&limit=50&min_timestamp=${o.created_at}`);
    const j = await r.json();
    const target = String(o.amount_usd * 1000000);
    const dup = db.prepare('SELECT 1 FROM crypto_orders WHERE txid=? AND status=?');
    const hit = (j.data || []).find((t) => t.token_symbol === 'USDT' && String(t.value) === target && !dup.get(t.transaction_id, 'paid'));
    if (hit) {
      db.prepare('UPDATE crypto_orders SET status=?, txid=? WHERE id=?').run('paid', hit.transaction_id, o.id);
      recordSale(o.form_key, o.amount_usd, 'Pro upgrade (USDT-TRC20)');
      return ok(res, { status: 'paid', upgraded: true, ...pay });
    }
  } catch { /* transient — next poll retries */ }
  ok(res, { status: 'pending', ...pay });
}

async function checkout(req, res) {
  if (FLW_SECRET_KEY) {
    // Flutterwave checkout — tx_ref embeds the form key so the webhook can auto-upgrade.
    const b = await readBody(req);
    const ref = 'if-' + (String(b.key || '').slice(0, 32) || rid(8)) + '-' + Date.now().toString(36);
    const r = await fetch('https://api.flutterwave.com/v3/payments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${FLW_SECRET_KEY}` },
      body: JSON.stringify({
        tx_ref: ref, amount: PRO_PRICE, currency: 'USD',
        redirect_url: (process.env.WEB_BASE || '') + '/checkout?status=successful',
        customer: { email: b.email || 'customer@inboxform.dev', name: 'InboxForm customer' },
        customizations: { title: 'InboxForm Pro', description: '1 month of InboxForm Pro — unlimited forms, 10k submissions/mo, AI replies' }
      })
    });
    const j = await r.json().catch(() => ({}));
    if (j.status !== 'success' || !j.data || !j.data.link) return fail(res, 502, 'flutterwave: ' + (j.message || 'checkout failed'));
    return ok(res, { gateway: 'flutterwave', url: j.data.link });
  }
  if (GUMROAD_PRODUCT_URL) {
    const b = await readBody(req);
    const sep = GUMROAD_PRODUCT_URL.includes('?') ? '&' : '?';
    return ok(res, { gateway: 'gumroad', url: GUMROAD_PRODUCT_URL + (b.email ? `${sep}email=${encodeURIComponent(b.email)}` : '') });
  }
  if (!LS_KEY || !LS_STORE || !LS_VARIANT) return fail(res, 501, { error: 'checkout not configured yet', howto: 'Set GUMROAD_PRODUCT_URL (or Lemon Squeezy keys). Sales then record automatically via webhook.' });
  const b = await readBody(req);
  const r = await fetch('https://api.lemonsqueezy.com/v1/checkouts', {
    method: 'POST',
    headers: { 'content-type': 'application/vnd.api+json', authorization: `Bearer ${LS_KEY}` },
    body: JSON.stringify({ data: {
      type: 'checkouts',
      attributes: { checkout_data: { email: b.email || '', custom: { plan: 'pro' } } },
      relationships: {
        store: { data: { type: 'stores', id: LS_STORE } },
        variant: { data: { type: 'variants', id: LS_VARIANT } }
      }
    } })
  });
  const j = await r.json().catch(() => ({}));
  const url = j.data && j.data.attributes && j.data.attributes.url;
  if (!r.ok || !url) return fail(res, 502, 'lemon squeezy error: ' + (j.errors ? JSON.stringify(j.errors).slice(0, 200) : r.status));
  ok(res, { url });
}

// Upgrade a form to Pro and record the sale in the ledger. Returns form id or null.
function recordSale(formKey, amount, note) {
  const form = db.prepare('SELECT id FROM forms WHERE key=?').get(formKey);
  if (!form) return null;
  const a = Number(amount) || 5;
  const usd = a > 100 ? a / 100 : a; // some gateways send cents
  db.prepare('UPDATE forms SET plan=? WHERE key=?').run('pro', formKey);
  const f = path.join(DATA_DIR, 'ledger.json');
  const txs = fs.existsSync(f) ? (JSON.parse(fs.readFileSync(f, 'utf8')).transactions || []) : [];
  txs.push({ date: new Date().toISOString().slice(0, 10), kind: 'sale', amount_usd: Math.round(usd * 100) / 100, note });
  fs.writeFileSync(f, JSON.stringify({ transactions: txs }, null, 2));
  return form.id;
}

// Gumroad license redemption: customer pastes the license key from their receipt,
// we verify against Gumroad's public license API, then upgrade the form.
async function redeem(req, res) {
  const b = await readBody(req);
  if (!GUMROAD_PRODUCT_ID || !b.key || !b.license) return fail(res, 400, 'key, license, and GUMROAD_PRODUCT_ID required');
  const r = await fetch('https://api.gumroad.com/v2/licenses/verify', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ product_id: GUMROAD_PRODUCT_ID, license_key: String(b.license) })
  });
  const j = await r.json().catch(() => ({}));
  if (!j.success) return fail(res, 402, 'invalid license key');
  const formId = recordSale(b.key, j.sale && j.sale.price, 'Pro upgrade (license redeem)');
  if (!formId) return fail(res, 404, 'unknown form key');
  ok(res, { upgraded: true, form_id: formId });
}

// Gateway-agnostic payment webhook: verifies a shared secret, finds the form key in the
// payload, upgrades the form to Pro, and records the sale in the ledger — automatically.
// (Works for Paddle Classic, Gumroad, or any gateway that forwards a key. Signatures get
// gateway-specific verification once the gateway is chosen.)
async function paymentsWebhook(req, res) {
  if (!WEBHOOK_SECRET) return fail(res, 501, 'PAYMENTS_WEBHOOK_SECRET not configured');
  const secret = (req.headers['x-webhook-secret'] || req.headers['x-gumroad-signature'] || new URL(req.url, 'http://x').searchParams.get('secret') || '').toString();
  if (secret !== WEBHOOK_SECRET) return fail(res, 401, 'bad webhook secret');
  const body = await readBody(req);
  const payload = body.data || body;
  let key = (payload.custom_data && payload.custom_data.key) || payload.key || (payload.sale && payload.sale.key) || null;
  if (!key) { const ref = payload.tx_ref || (payload.data && payload.data.tx_ref) || ''; key = ref.split('-')[1] || null; }
  if (!key && payload.sale && Array.isArray(payload.sale.custom_fields)) {
    const kf = payload.sale.custom_fields.find((f) => f && f.name === 'key');
    if (kf) key = kf.value;
  } else if (!key && payload.sale && payload.sale.custom_fields) {
    key = payload.sale.custom_fields.key || null;
  }
  if (!key) return fail(res, 400, 'no form key in payload');
  const rawAmount = payload.amount || (payload.data && payload.data.amount) || (payload.sale && (payload.sale.price || ((payload.sale.recurring_charge || {}).amount_cents || 500)));
  const formId = recordSale(key, rawAmount, 'Pro upgrade (' + (payload.event || 'webhook') + ')');
  if (!formId) return fail(res, 404, 'unknown form key');
  ok(res, { upgraded: true, form_id: formId });
}

function status(res) {
  ok(res, {
    service: 'inboxform', version: '0.1.0', uptime_s: Math.round(process.uptime()),
    db: 'ok',
    forms: db.prepare('SELECT COUNT(*) AS n FROM forms').get().n,
    submissions: db.prepare('SELECT COUNT(*) AS n FROM submissions').get().n,
    deepseek_configured: !!DEEPSEEK_KEY, ls_configured: !!(LS_KEY && LS_STORE && LS_VARIANT),
    payments_webhook_configured: !!WEBHOOK_SECRET,
    flutterwave_configured: !!FLW_SECRET_KEY,
    crypto_configured: !!CRYPTO_WALLET,
    gumroad_configured: !!GUMROAD_PRODUCT_URL,
    plans: { free: { submissions_per_month: FREE_SUBS }, pro: { submissions_per_month: PRO_SUBS, price_usd: PRO_PRICE } }
  });
}

const server = http.createServer(async (req, res) => {
  const p = new URL(req.url, 'http://x').pathname;
  try {
    if (req.method === 'POST' && p === '/api/forms') return await createForm(req, res);
    if (req.method === 'POST' && p.startsWith('/f/')) return await submit(req, res, p.slice(3));
    if (req.method === 'GET' && p === '/api/submissions') return listSubmissions(req, res);
    if (req.method === 'GET' && p === '/api/usage') return usage(req, res);
    if (req.method === 'GET' && p === '/api/ledger') return ledger(res);
    if (req.method === 'POST' && p === '/api/ledger/record') return await recordLedger(req, res);
    if (req.method === 'POST' && p === '/checkout') return await checkout(req, res);
    if (req.method === 'POST' && p === '/api/payments/webhook') return await paymentsWebhook(req, res);
    if (req.method === 'POST' && p === '/api/redeem') return await redeem(req, res);
    if (req.method === 'POST' && p === '/api/crypto/quote') return await cryptoQuote(req, res);
    if (req.method === 'GET' && p === '/api/crypto/status') return await cryptoStatus(req, res);
    if (req.method === 'GET' && p === '/checkout') return serveStatic(req, res, 'checkout.html');
    if (req.method === 'GET' && p === '/api/status') return status(res);
    if (req.method === 'GET') return serveStatic(req, res, p);
    return fail(res, 405, 'method not allowed');
  } catch (e) {
    if (e.message === 'invalid JSON') return fail(res, 400, 'invalid JSON body');
    if (e.message === 'payload too large') return fail(res, 413, 'payload too large');
    return fail(res, 500, 'internal error: ' + e.message);
  }
});

server.listen(PORT, () => console.log(`InboxForm listening on :${PORT} (deepseek:${DEEPSEEK_KEY ? 'on' : 'off'}, ls:${(LS_KEY && LS_STORE && LS_VARIANT) ? 'on' : 'off'})`));
