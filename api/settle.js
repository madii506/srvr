// POST /api/settle {mint, sig} — after the launch transactions land, read the chain: the coin exists, its creator is
// its own fee-sharing config, the admin is revoked and the one shareholder is the rent wallet (100%). Only then is the
// coin marked live and put on the board. Anyone can call it; it only ever reads.
const L = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('settle:' + L.ip(req), 60, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a minute.' });
  if (!L.dbReady()) return L.send(res, 200, { ok: false, error: 'srvr’s records are offline.' });
  const b = await L.body(req, 4 * 1024), mint = String(b.mint || ''), sig = String(b.sig || '').slice(0, 100);
  if (!L.isAddr(mint)) return L.send(res, 200, { ok: false, error: 'That request doesn’t look right.' });
  try {
    await L.ready();
    const o = (await L.q('SELECT mint, rent, status FROM srvr_coins WHERE mint=$1', [mint]))[0];
    if (!o) return L.send(res, 200, { ok: false, error: 'No record of that coin.' });
    if (o.status === 'live') return L.send(res, 200, { ok: true, live: true });
    const r = await require('./_pump').routing(mint, addrs => L.accounts(addrs));
    if (!r.exists) return L.send(res, 200, { ok: true, live: false, state: 'not on chain yet' });
    const want = L.sharesFor(o.rent);
    const match = r.shareholders.length === want.length && want.every(w => r.shareholders.some(s => s.address === w.address && s.bps === w.bps));
    if (!r.routed || !r.revoked || !match) return L.send(res, 200, { ok: true, live: false, needRoute: true, state: 'coin is live, fees not locked yet' });
    await L.q(`UPDATE srvr_coins SET status='live', live_at=now(), sig=COALESCE(NULLIF($2,''), sig) WHERE mint=$1`, [mint, /^[1-9A-HJ-NP-Za-km-z]{60,100}$/.test(sig) ? sig : '']);
    L.send(res, 200, { ok: true, live: true });
  } catch (e) { L.send(res, 200, { ok: false, error: 'Solana didn’t answer just now. Try again in a moment.' }); }
};
