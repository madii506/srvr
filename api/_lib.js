// srvr's shared server code. Every upstream call has a timeout and an honest failure message.
// Upstreams: Solana RPC, mcstatus.io (live server status, no key; mcsrvstat.us as the fallback), Mojang's public
// profile lookup, Coinbase's public SOL price. Nothing here holds a key: there is no wallet on this server.
const crypto = require('crypto');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0 Safari/537.36';
const RPCS = (process.env.RPC_URLS || 'https://solana-rpc.publicnode.com,https://api.mainnet-beta.solana.com').split(',').map(s => s.trim()).filter(Boolean);
const MOCK = process.env.NI_MOCK ? require(process.env.NI_MOCK) : null;   // dev only: canned upstreams

function send(res, code, obj, cache = 'no-store') {
  res.statusCode = code; res.setHeader('Content-Type', 'application/json; charset=utf-8');
  if (/s-maxage/.test(cache)) { res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); res.setHeader('CDN-Cache-Control', cache.replace(/max-age=0,\s*/, '')); }
  else res.setHeader('Cache-Control', cache);
  res.end(JSON.stringify(obj));
}
const CACHE = (s, swr = s * 10) => `public, max-age=0, s-maxage=${s}, stale-while-revalidate=${swr}`;
function query(req) { if (req.query) return req.query; return Object.fromEntries(new URL(req.url, 'http://x').searchParams); }
async function body(req, max = 64 * 1024) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') { if (req.body.length > max) return { tooBig: true }; try { return JSON.parse(req.body); } catch { return {}; } }
  const chunks = []; let n = 0; for await (const c of req) { chunks.push(c); n += c.length; if (n > max) return { tooBig: true }; }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); } catch { return {}; }
}
function ip(req) { return String(req.headers['x-forwarded-for'] || (req.socket && req.socket.remoteAddress) || '?').split(',')[0].trim(); }
const hits = new Map();
function limited(key, n, ms) { const now = Date.now(), a = (hits.get(key) || []).filter(t => now - t < ms); a.push(now); hits.set(key, a); if (hits.size > 5000) hits.delete(hits.keys().next().value); return a.length > n; }

async function getJson(url, opt = {}, ms = 9000) {
  if (MOCK) return MOCK.fetch(url, opt);
  const r = await fetch(url, { ...opt, headers: { 'user-agent': UA, accept: 'application/json', ...(opt.headers || {}) }, signal: AbortSignal.timeout(ms) });
  const t = await r.text(); let j = null; try { j = JSON.parse(t); } catch {}
  return { status: r.status, ok: r.ok, json: j, text: t };
}
async function rpcRaw(method, params, ms = 12000) {
  let last;
  for (const u of RPCS) {
    try {
      const r = await getJson(u, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) }, ms);
      if (r.json && (r.json.result !== undefined || (r.json.error && (method === 'sendTransaction' || method === 'simulateTransaction')))) return r.json;
      last = new Error((r.json && r.json.error && r.json.error.message) || 'rpc ' + r.status);
    } catch (e) { last = e; }
  }
  throw last || new Error('rpc failed');
}
async function rpc(method, params, ms) { const j = await rpcRaw(method, params, ms); if (j.error) throw new Error(j.error.message || 'rpc error'); return j.result; }
async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) { const k = i++; try { await fn(items[k], k); } catch {} } })); }
const memo = new Map();
async function remember(key, ms, fn) {
  const m = memo.get(key); if (m && m.v !== undefined && Date.now() - m.at < ms) return m.v;
  if (m && m.p) return m.p;
  const p = fn().then(v => { memo.set(key, { at: Date.now(), v }); if (memo.size > 800) memo.delete(memo.keys().next().value); return v; })
    .catch(e => { if (m && m.v !== undefined) { memo.set(key, { at: m.at, v: m.v }); return m.v; } memo.delete(key); throw e; });
  memo.set(key, { ...(m || { at: 0 }), p }); return p;
}

// ---------- Solana bits without @solana/web3.js: base58, program-derived addresses, signatures ----------
const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
function b58enc(buf) {
  let n = 0n; for (const b of buf) n = n * 256n + BigInt(b);
  let s = ''; while (n > 0n) { s = B58[Number(n % 58n)] + s; n /= 58n; }
  for (const b of buf) { if (b === 0) s = '1' + s; else break; }
  return s;
}
function b58dec(str) {
  let n = 0n; for (const c of str) { const i = B58.indexOf(c); if (i < 0) throw new Error('bad base58'); n = n * 58n + BigInt(i); }
  const out = []; while (n > 0n) { out.unshift(Number(n % 256n)); n /= 256n; }
  for (const c of str) { if (c === '1') out.unshift(0); else break; }
  return Buffer.from(out);
}
const P25519 = (1n << 255n) - 19n;
const modp = a => ((a % P25519) + P25519) % P25519;
function powp(b, e) { let r = 1n; b = modp(b); while (e > 0n) { if (e & 1n) r = r * b % P25519; b = b * b % P25519; e >>= 1n; } return r; }
const D25519 = modp(-121665n * powp(121666n, P25519 - 2n));
const SQRTM1 = powp(2n, (P25519 - 1n) / 4n);
function onCurve(bytes) {
  const b = Buffer.from(bytes); b[31] &= 0x7f;
  let y = 0n; for (let i = 31; i >= 0; i--) y = (y << 8n) + BigInt(b[i]);
  if (y >= P25519) return false;
  const y2 = y * y % P25519, u = modp(y2 - 1n), v = modp(D25519 * y2 + 1n);
  const x2 = u * powp(v, P25519 - 2n) % P25519;
  if (x2 === 0n) return true;
  let x = powp(x2, (P25519 + 3n) / 8n);
  if (x * x % P25519 === x2) return true;
  x = x * SQRTM1 % P25519;
  return x * x % P25519 === x2;
}
function pda(seeds, programId) {
  const prog = b58dec(programId);
  for (let bump = 255; bump >= 0; bump--) {
    const h = crypto.createHash('sha256');
    for (const sd of seeds) h.update(Buffer.from(sd));
    h.update(Buffer.from([bump])); h.update(prog); h.update(Buffer.from('ProgramDerivedAddress'));
    const k = h.digest(); if (!onCurve(k)) return b58enc(k);
  }
  throw new Error('no pda');
}
const isAddr = s => typeof s === 'string' && /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s);
// a wallet's signature over a message (ed25519), checked with Node's own crypto
function verifySig(wallet, message, sig) {
  try {
    const pub = b58dec(wallet); if (pub.length !== 32) return false;
    const key = crypto.createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), pub]), format: 'der', type: 'spki' });
    const s = Buffer.isBuffer(sig) ? sig : Buffer.from(String(sig), 'base64'); if (s.length !== 64) return false;
    return crypto.verify(null, Buffer.from(message, 'utf8'), key, s);
  } catch { return false; }
}

// ---------- pump.fun addresses (computed here so reading the chain needs no SDK) ----------
const SYSTEM = '11111111111111111111111111111111';
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', PUMP_FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const bondingCurveOf = mint => pda([Buffer.from('bonding-curve'), b58dec(mint)], PUMP);
const sharingConfigOf = mint => pda([Buffer.from('sharing-config'), b58dec(mint)], PUMP_FEES);
const creatorVaultOf = mint => pda([Buffer.from('creator-vault'), b58dec(sharingConfigOf(mint))], PUMP);
const PREFUND = 0.001;                 // SOL the launcher sends a brand-new rent wallet, so it exists before fees arrive
const sharesFor = rent => [{ address: rent, bps: 10000 }];
async function accounts(addrs) {             // raw accounts in order, null where none exists
  const out = [];
  for (let i = 0; i < addrs.length; i += 100) {
    const r = await rpc('getMultipleAccounts', [addrs.slice(i, i + 100), { encoding: 'base64', commitment: 'confirmed' }]);
    for (const a of r.value) out.push(a ? { data: Buffer.from(a.data[0], 'base64'), lamports: a.lamports, owner: a.owner } : null);
  }
  return out;
}
const RPC_URL = () => RPCS[0];
// how much of a coin a wallet holds right now (raw units), and the token account holding most of it
async function holding(wallet, mint) {
  const r = await rpc('getTokenAccountsByOwner', [wallet, { mint }, { encoding: 'jsonParsed', commitment: 'confirmed' }]);
  let best = null, total = 0n;
  for (const a of (r && r.value) || []) {
    const amt = BigInt((((a.account || {}).data || {}).parsed || {}).info ? a.account.data.parsed.info.tokenAmount.amount : '0');
    total += amt; if (!best || amt > best.amt) best = { acct: a.pubkey, amt };
  }
  return { amount: total, acct: best && best.amt > 0n ? best.acct : null };
}
// SOL in dollars, from Coinbase's public price (for showing market caps); null if it doesn't answer
async function solUsd() {
  try { return await remember('sol-usd', 60000, async () => { const r = await getJson('https://api.coinbase.com/v2/prices/SOL-USD/spot', {}, 5000); const v = Number(r.json && r.json.data && r.json.data.amount); if (!v) throw new Error('no price'); return v; }); }
  catch { return null; }
}

// ---------- servers: addresses, live status, player names ----------
function address(raw) {
  let s = String(raw || '').trim().toLowerCase().replace(/^[a-z]+:\/\//, '').replace(/\/.*$/, '').replace(/\s+/g, '');
  const m = /^([a-z0-9.-]{1,253}|\[[0-9a-f:]+\])(?::(\d{1,5}))?$/.exec(s);
  if (!m || !/\./.test(m[1]) || /^\.|\.\.|\.$/.test(m[1])) return null;
  const port = m[2] ? +m[2] : 25565;
  if (port < 1 || port > 65535) return null;
  return { host: m[1], port, key: port === 25565 ? m[1] : `${m[1]}:${port}` };
}
// § formatting codes → safe segments the page renders with textContent
const COL = { 0: '#000000', 1: '#0000AA', 2: '#00AA00', 3: '#00AAAA', 4: '#AA0000', 5: '#AA00AA', 6: '#FFAA00', 7: '#AAAAAA', 8: '#555555', 9: '#5555FF', a: '#55FF55', b: '#55FFFF', c: '#FF5555', d: '#FF55FF', e: '#FFFF55', f: '#FFFFFF' };
function motd(raw) {
  const out = []; let st = { c: '#AAAAAA', b: 0 }; let buf = '';
  const flush = () => { if (buf) out.push({ t: buf, ...st }); buf = ''; };
  const txt = String(raw || '').replace(/\r/g, '').slice(0, 400);
  for (let i = 0; i < txt.length; i++) {
    const ch = txt[i];
    if ((ch === '§' || ch === '&') && i + 1 < txt.length && /[0-9a-fk-or]/i.test(txt[i + 1])) {
      flush(); const k = txt[++i].toLowerCase();
      if (COL[k]) st = { c: COL[k], b: 0 }; else if (k === 'l') st = { ...st, b: 1 }; else if (k === 'r') st = { c: '#AAAAAA', b: 0 };
      continue;
    }
    buf += ch;
  }
  flush();
  return out.map(x => ({ ...x, t: x.t.replace(/[^\S\n]{3,}/g, '  ') }));
}
const plain = s => String(s || '').replace(/§[0-9a-fk-or]/gi, '').trim();
async function statusNow(a) {
  try {
    const r = await getJson(`https://api.mcstatus.io/v2/status/java/${encodeURIComponent(a.key)}`, {}, 6500);
    const j = r.json;
    if (j && typeof j.online === 'boolean') {
      return { online: j.online, players: j.players ? j.players.online | 0 : 0, max: j.players ? j.players.max | 0 : 0, version: j.version ? plain(j.version.name_clean || j.version.name_raw) : '',
        motd: motd(j.motd && j.motd.raw), motdText: j.motd ? plain(j.motd.clean) : '', icon: j.icon || '', sample: ((j.players && j.players.list) || []).slice(0, 12).map(p => ({ name: plain(p.name_clean || p.name_raw), uuid: p.uuid })),
        software: j.software || '', src: 'mcstatus.io' };
    }
  } catch {}
  const r = await getJson(`https://api.mcsrvstat.us/3/${encodeURIComponent(a.key)}`, {}, 6500);
  const j = r.json; if (!j) throw new Error('no status');
  const raw = j.motd && Array.isArray(j.motd.raw) ? j.motd.raw.join('\n') : '';
  return { online: !!j.online, players: j.players ? j.players.online | 0 : 0, max: j.players ? j.players.max | 0 : 0, version: plain(j.version || ''),
    motd: motd(raw), motdText: j.motd && Array.isArray(j.motd.clean) ? j.motd.clean.join(' ') : '', icon: j.icon || '', sample: ((j.players && j.players.list) || []).slice(0, 12).map(p => ({ name: p.name, uuid: p.uuid })),
    software: j.software || '', src: 'mcsrvstat.us' };
}
const status = a => remember('st:' + a.key, 30000, () => statusNow(a));
// the block's mood: players on → awake, online and empty → asleep, unreachable → off
const mood = s => (!s || !s.online ? 'off' : s.players > 0 ? 'on' : 'sleep');
const NAME = /^[A-Za-z0-9_]{3,16}$/;
// a Java Edition player name → its profile id, from Mojang. null when nobody has that name.
async function profile(name) {
  return remember('mj:' + name.toLowerCase(), 3600e3, async () => {
    for (const u of [`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(name)}`, `https://api.minecraftservices.com/minecraft/profile/lookup/name/${encodeURIComponent(name)}`]) {
      try {
        const r = await getJson(u, {}, 6000);
        if (r.json && /^[0-9a-f]{32}$/i.test(r.json.id || '')) return { id: r.json.id.toLowerCase(), name: r.json.name || name };
        if (r.status === 404 || r.status === 204) return null;
      } catch {}
    }
    throw new Error('Mojang didn’t answer');
  });
}
const dashed = id => String(id).replace(/^(.{8})(.{4})(.{4})(.{4})(.{12})$/, '$1-$2-$3-$4-$5');

// ---------- the database: Postgres (Neon on Vercel; PGlite in local dev) ----------
let pg = null, made = null;
async function q(text, params = []) {
  if (process.env.NI_PGLITE) {
    if (!pg) { const { PGlite } = require('@electric-sql/pglite'); pg = new PGlite(process.env.NI_PGLITE); }
    return (await pg.query(text, params)).rows;
  }
  if (!pg) { const { neon } = require('@neondatabase/serverless'); pg = neon(dbUrl()); }
  return pg.query(text, params);
}
function dbUrl() { const e = process.env; return e.SRVR_DATABASE_URL || e.DATABASE_URL || e.POSTGRES_URL || e.STORAGE_URL || e.STORAGE_DATABASE_URL || e.DATABASE_POSTGRES_URL || ''; }
const dbReady = () => !!(process.env.NI_PGLITE || dbUrl());
function ready() {
  if (!made) made = (async () => {
    for (const st of [
      `CREATE TABLE IF NOT EXISTS srvr_coins (mint text PRIMARY KEY, name text NOT NULL, symbol text NOT NULL, description text, server text NOT NULL,
        rent text NOT NULL, payer text NOT NULL, image text, image_type text, twitter text, status text NOT NULL DEFAULT 'pending',
        created_at timestamptz NOT NULL DEFAULT now(), live_at timestamptz, sig text)`,
      `CREATE INDEX IF NOT EXISTS srvr_coins_live ON srvr_coins(status, live_at DESC)`,
      `CREATE TABLE IF NOT EXISTS srvr_keys (id bigserial PRIMARY KEY, mint text NOT NULL, wallet text NOT NULL, name text NOT NULL, uuid text NOT NULL,
        acct text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now())`,
      `CREATE UNIQUE INDEX IF NOT EXISTS srvr_keys_wallet ON srvr_keys(mint, wallet)`,
      `CREATE UNIQUE INDEX IF NOT EXISTS srvr_keys_uuid ON srvr_keys(mint, uuid)`,
    ]) { try { await q(st); } catch (e) { if (!/already exists|duplicate key/i.test(String(e && e.message))) throw e; } }
  })().catch(e => { made = null; console.error('srvr db setup', e && e.message); throw e; });
  return made;
}

const BANNED = /\b(guarantee[ds]?|100x|1000x|risk[- ]free|cant lose|can't lose)\b/i;
const clean = (s, n) => String(s == null ? '' : s).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, n);
function origin(req) { const h = req.headers['x-forwarded-host'] || req.headers.host || 'localhost'; const proto = req.headers['x-forwarded-proto'] || (/^localhost|^127\./.test(h) ? 'http' : 'https'); return proto + '://' + String(h).split(',')[0].trim(); }

module.exports = {
  UA, MOCK, send, CACHE, query, body, ip, limited, getJson, rpc, rpcRaw, pool, remember, b58enc, b58dec, pda, isAddr, verifySig,
  SYSTEM, PUMP, PUMP_FEES, bondingCurveOf, sharingConfigOf, creatorVaultOf, PREFUND, sharesFor, accounts, RPC_URL, holding, solUsd,
  address, motd, status, mood, NAME, profile, dashed, q, ready, dbReady, BANNED, clean, origin,
};
