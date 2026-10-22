// /api/coin
//   POST {mint, payer, name, symbol, description, server, rent, twitter, image}
//        record a coin before it launches: its server, its rent wallet and its picture. Returns the metadata uri the
//        coin will point at and the one address its creator fees will be locked to.
//   GET  ?list=1          every live coin, each with its server's live status, its bonding curve and its keys
//   GET  ?mint=<mint>     one coin, with what the chain says about its fees right now
const L = require('./_lib');
const bytes = s => Buffer.byteLength(s, 'utf8');
const INIT_REAL = 793100000000000;

function image(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
  if (!m) return null;
  const b = Buffer.from(m[2], 'base64');
  if (b.length < 64 || b.length > 450 * 1024) return null;
  const png = b[0] === 0x89 && b[1] === 0x50, jpg = b[0] === 0xff && b[1] === 0xd8, webp = b.slice(0, 4).toString() === 'RIFF' && b.slice(8, 12).toString() === 'WEBP';
  if (!(png || jpg || webp)) return null;
  return { buf: b, type: png ? 'image/png' : jpg ? 'image/jpeg' : 'image/webp' };
}
// an optional X link: a handle or an x.com / twitter.com url. null when empty, undefined when it doesn't check out
function xlink(v) {
  v = String(v || '').trim(); if (!v) return null;
  if (/^@?[A-Za-z0-9_]{1,15}$/.test(v)) return 'https://x.com/' + v.replace(/^@/, '');
  if (!/^https?:\/\//i.test(v)) v = 'https://' + v.replace(/^\/+/, '');
  try { const u = new URL(v); if (!/^(www\.|mobile\.)?(x|twitter)\.com$/i.test(u.hostname) || v.length > 200) return undefined; u.protocol = 'https:'; return u.toString(); } catch { return undefined; }
}
// a pump.fun bonding curve, read straight from its account: market cap in SOL, how full the curve is, graduated or not
function curve(acct) {
  if (!acct || !acct.data || acct.data.length < 49) return { exists: false };
  const d = acct.data, u = o => Number(d.readBigUInt64LE(o));
  const vTok = u(8), vSol = u(16), rTok = u(24), supply = u(40), complete = d[48] === 1;
  return { exists: true, complete, mcapSol: vTok ? vSol * supply / vTok / 1e9 : null, progress: complete ? 1 : Math.max(0, Math.min(1, 1 - rTok / INIT_REAL)) };
}
const pub = (r, site) => ({ mint: r.mint, name: r.name, symbol: r.symbol, description: r.description || '', server: r.server, rent: r.rent, payer: r.payer,
  image: site + '/i/' + r.mint, twitter: r.twitter || '', status: r.status, created_at: r.created_at, live_at: r.live_at, sig: r.sig || '' });

async function post(req, res) {
  if (L.limited('coin:' + L.ip(req), 20, 600000)) return L.send(res, 200, { ok: false, error: 'Too many launches from here. Wait a few minutes.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'srvr’s records are offline, so launching is paused. Try again shortly.' });
  const b = await L.body(req, 700 * 1024);
  if (b.tooBig) return L.send(res, 200, { ok: false, error: 'That picture is too big. Keep it under 400 KB.' });
  const mint = String(b.mint || ''), payer = String(b.payer || ''), name = L.clean(b.name, 64), symbol = L.clean(b.symbol, 20).replace(/^\$/, '').toUpperCase();
  const rent = String(b.rent || '').trim() || payer, description = L.clean(b.description, 280), a = L.address(b.server);
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'The new coin address is missing.' });
  if (!L.isAddr(payer)) return L.send(res, 200, { ok: false, error: 'Connect your wallet first.' });
  if (!name || bytes(name) > 32) return L.send(res, 200, { ok: false, error: 'Give it a name of up to 32 characters.' });
  if (!/^[A-Z0-9]{1,10}$/.test(symbol)) return L.send(res, 200, { ok: false, error: 'The ticker is 1–10 letters or numbers.' });
  if (L.BANNED.test(name + ' ' + symbol + ' ' + description)) return L.send(res, 200, { ok: false, error: 'Pick other words. No promises of returns.' });
  if (!a) return L.send(res, 200, { ok: false, error: 'Add your server’s address, like play.yourserver.net.' });
  if (!L.isAddr(rent)) return L.send(res, 200, { ok: false, error: 'The rent wallet isn’t a Solana address.' });
  const twitter = xlink(b.twitter); if (twitter === undefined) return L.send(res, 200, { ok: false, error: 'That X link doesn’t look right. Use @handle or an x.com link.' });
  const img = image(b.image); if (!img) return L.send(res, 200, { ok: false, error: 'The picture didn’t come through. Use a PNG, JPEG or WebP under 400 KB.' });
  try { const acct = await L.rpc('getAccountInfo', [L.bondingCurveOf(mint), { encoding: 'base64' }]); if (acct && acct.value) return L.send(res, 200, { ok: false, error: 'That coin is already launched; its record can’t change.' }); }
  catch { return L.send(res, 200, { ok: false, error: 'Solana didn’t answer just now. Try again in a moment.' }); }
  try {
    await L.ready();
    const old = (await L.q('SELECT payer, status FROM srvr_coins WHERE mint=$1', [mint]))[0];
    if (old && (old.status === 'live' || old.payer !== payer)) return L.send(res, 200, { ok: false, error: 'That coin address is taken. Start again for a new one.' });
    await L.q(`INSERT INTO srvr_coins (mint, name, symbol, description, server, rent, payer, image, image_type, twitter, status)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')
      ON CONFLICT (mint) DO UPDATE SET name=$2, symbol=$3, description=$4, server=$5, rent=$6, image=$8, image_type=$9, twitter=$10, created_at=now()`,
      [mint, name, symbol, description, a.key, rent, payer, img.buf.toString('base64'), img.type, twitter]);
    const site = L.origin(req);
    L.send(res, 200, { ok: true, mint, uri: site + '/m/' + mint, image: site + '/i/' + mint, server: a.key, rent, shares: L.sharesFor(rent) });
  } catch (e) { L.send(res, 200, { ok: false, error: 'srvr’s records didn’t save that. Try again.' }); }
}

async function withStatus(rows) {
  const st = {};
  await L.pool([...new Set(rows.map(r => r.server))], 8, async key => { const a = L.address(key); if (!a) return; try { st[key] = await L.status(a); } catch { st[key] = null; } });
  return st;
}
const lite = s => s ? { online: s.online, players: s.players, max: s.max, version: s.version } : null;

async function list(req, res) {
  if (!L.dbReady()) return L.send(res, 200, { ok: true, coins: [], offline: true });
  try {
    await L.ready();
    const rows = await L.q(`SELECT mint, name, symbol, description, server, rent, payer, twitter, status, created_at, live_at, sig FROM srvr_coins WHERE status='live' ORDER BY live_at DESC LIMIT 100`);
    const keys = Object.fromEntries((await L.q('SELECT mint, count(*)::int AS n FROM srvr_keys GROUP BY mint')).map(r => [r.mint, r.n]));
    let curves = [];
    try { curves = L.MOCK && L.MOCK.curve ? rows.map(r => L.MOCK.curve(r.mint)) : (await L.accounts(rows.map(r => L.bondingCurveOf(r.mint)))).map(curve); } catch { curves = rows.map(() => null); }
    const [st, sol] = await Promise.all([withStatus(rows), L.solUsd()]);
    const site = L.origin(req);
    const coins = rows.map((r, i) => { const s = st[r.server]; return { ...pub(r, site), keys: keys[r.mint] || 0, curve: curves[i] || null, st: lite(s), mood: L.mood(s) }; });
    L.send(res, 200, { ok: true, coins, solUsd: sol, at: Date.now() }, L.CACHE(15));
  } catch (e) { L.send(res, 200, { ok: false, error: 'The board didn’t load. Try again in a moment.' }); }
}

async function one(req, res, mint) {
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'srvr’s records are offline.' });
  try {
    await L.ready();
    const r = (await L.q('SELECT mint, name, symbol, description, server, rent, payer, twitter, status, created_at, live_at, sig FROM srvr_coins WHERE mint=$1', [mint]))[0];
    if (!r) return L.send(res, 200, { ok: false, error: 'No coin with that address was launched on srvr.' });
    const keys = (await L.q('SELECT count(*)::int AS n FROM srvr_keys WHERE mint=$1', [mint]))[0].n;
    const a = L.address(r.server);
    const [route, s, sol] = await Promise.all([
      require('./_pump').routing(mint, addrs => L.accounts(addrs)).catch(() => null),
      a ? L.status(a).catch(() => null) : null,
      L.solUsd(),
    ]);
    const site = L.origin(req);
    L.send(res, 200, { ok: true, coin: { ...pub(r, site), keys }, st: s ? { ...s, icon: s.icon && s.icon.length < 40000 ? s.icon : '' } : null, mood: L.mood(s),
      chain: route ? { exists: route.exists, complete: !!route.complete, routed: !!route.routed, revoked: !!route.revoked, shareholders: route.shareholders || [], waiting: route.waitingLamports || 0, mcapSol: route.mcapSol } : null,
      solUsd: sol }, L.CACHE(10));
  } catch (e) { L.send(res, 200, { ok: false, error: 'That coin didn’t load. Try again in a moment.' }); }
}

module.exports = async (req, res) => {
  if (req.method === 'POST') return post(req, res);
  const qy = L.query(req);
  if (qy.mint) return L.isAddr(qy.mint) ? one(req, res, qy.mint) : L.send(res, 200, { ok: false, error: 'That isn’t a coin address.' });
  return list(req, res);
};
