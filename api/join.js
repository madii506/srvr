// /api/join — a holder links their wallet and their Java Edition name to a coin's server.
//   POST {mint, wallet, name, ts, sig}  sig = the wallet's signature over msg() below (a message, not a transaction).
//        Checks the signature, that the wallet holds the coin right now, and that the name is a real player. Free.
//   GET  ?mint=&wallet=                 the name this wallet has linked to that coin, if any
//   GET  ?name=<player>                 a real Java Edition player? (name and profile id, for the head preview)
// The server reads the result from /api/whitelist, which checks every wallet's balance again on each sync.
const L = require('./_lib');
const msg = (mint, name, wallet, ts) => `srvr · let me in\ncoin: ${mint}\nplayer: ${name}\nwallet: ${wallet}\ntime: ${ts}`;
module.exports = async (req, res) => {
  // GET ?name=<player>: is that a real Java Edition player? (the page shows their head as you type)
  if (req.method === 'GET' && L.query(req).name != null) {
    const name = String(L.query(req).name || '').trim();
    if (!L.NAME.test(name)) return L.send(res, 200, { ok: false, error: '3–16 letters, numbers or underscores.' });
    if (L.limited('name:' + L.ip(req), 60, 60000)) return L.send(res, 200, { ok: false, error: 'Too many lookups. Wait a moment.' });
    try { const p = await L.profile(name); return L.send(res, 200, p ? { ok: true, name: p.name, uuid: L.dashed(p.id) } : { ok: false, error: `no java edition player called ${name}` }, L.CACHE(600)); }
    catch { return L.send(res, 200, { ok: false, error: 'Mojang didn’t answer just now.' }); }
  }
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'srvr’s records are offline. Try again shortly.' });
  if (req.method === 'GET') {
    const { mint, wallet } = L.query(req);
    if (!L.isAddr(mint) || !L.isAddr(wallet)) return L.send(res, 200, { ok: false, error: 'That request doesn’t look right.' });
    try { await L.ready(); const k = (await L.q('SELECT name, uuid, updated_at FROM srvr_keys WHERE mint=$1 AND wallet=$2', [mint, wallet]))[0];
      return L.send(res, 200, { ok: true, key: k ? { name: k.name, uuid: L.dashed(k.uuid), at: k.updated_at } : null }); }
    catch { return L.send(res, 200, { ok: false, error: 'That didn’t load. Try again.' }); }
  }
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('join:' + L.ip(req), 20, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a few minutes.' });
  const b = await L.body(req, 4 * 1024);
  const mint = String(b.mint || ''), wallet = String(b.wallet || ''), name = String(b.name || '').trim(), ts = Number(b.ts) || 0;
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'Pick a coin first.' });
  if (!L.isAddr(wallet)) return L.send(res, 200, { ok: false, error: 'Connect your wallet first.' });
  if (!L.NAME.test(name)) return L.send(res, 200, { ok: false, error: 'A Java Edition name is 3–16 letters, numbers or underscores.' });
  if (Math.abs(Date.now() - ts) > 10 * 60e3) return L.send(res, 200, { ok: false, error: 'That signature is too old. Sign again.' });
  if (!L.verifySig(wallet, msg(mint, name, wallet, ts), b.sig)) return L.send(res, 200, { ok: false, error: 'The signature didn’t match this wallet. Sign again.' });
  try {
    await L.ready();
    const coin = (await L.q('SELECT mint, symbol, server, status FROM srvr_coins WHERE mint=$1', [mint]))[0];
    if (!coin || coin.status !== 'live') return L.send(res, 200, { ok: false, error: 'That coin isn’t on srvr’s board.' });
    let h; try { h = await L.holding(wallet, mint); } catch { return L.send(res, 200, { ok: false, error: 'Solana didn’t answer just now. Try again in a moment.' }); }
    if (!h.acct || h.amount <= 0n) return L.send(res, 200, { ok: false, error: `This wallet doesn’t hold $${coin.symbol}. Buy some first, then join.` });
    let p; try { p = await L.profile(name); } catch { return L.send(res, 200, { ok: false, error: 'Mojang didn’t answer just now. Try again in a moment.' }); }
    if (!p) return L.send(res, 200, { ok: false, error: `There’s no Java Edition player called ${name}.` });
    const taken = (await L.q('SELECT wallet FROM srvr_keys WHERE mint=$1 AND uuid=$2', [mint, p.id]))[0];
    if (taken && taken.wallet !== wallet) return L.send(res, 200, { ok: false, error: `${p.name} is already linked to another wallet for $${coin.symbol}.` });
    await L.q(`INSERT INTO srvr_keys (mint, wallet, name, uuid, acct) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (mint, wallet) DO UPDATE SET name=$3, uuid=$4, acct=$5, updated_at=now()`, [mint, wallet, p.name, p.id, h.acct]);
    const n = (await L.q('SELECT count(*)::int AS n FROM srvr_keys WHERE mint=$1', [mint]))[0].n;
    L.send(res, 200, { ok: true, name: p.name, uuid: L.dashed(p.id), server: coin.server, symbol: coin.symbol, count: n });
  } catch (e) { L.send(res, 200, { ok: false, error: 'srvr’s records didn’t save that. Try again.' }); }
};
module.exports.msg = msg;
