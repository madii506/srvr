// POST /api/feed {mint, payer} — "pay the rent": builds pump.fun's distribute_creator_fees for a coin, which
// pushes the fees waiting in its creator vault out to its shareholder (the coin's rent wallet). The payer
// only covers the network fee and gets nothing; the split is whatever was locked at launch.
const L = require('./_lib');
module.exports = async (req, res) => {
  if (req.method !== 'POST') return L.send(res, 405, { ok: false, error: 'POST only.' });
  if (L.limited('feed:' + L.ip(req), 20, 600000)) return L.send(res, 200, { ok: false, error: 'Too many tries. Wait a few minutes.' });
  const b = await L.body(req, 4 * 1024), mint = String(b.mint || ''), payer = String(b.payer || '');
  if (!L.isAddr(mint) || !L.isAddr(payer)) return L.send(res, 200, { ok: false, error: 'That request doesn’t look right.' });
  try {
    const P = require('./_pump');
    const r = await P.routing(mint, addrs => L.accounts(addrs));
    if (!r.exists) return L.send(res, 200, { ok: false, error: 'That coin isn’t on chain.' });
    if (!r.routed) return L.send(res, 200, { ok: false, error: 'That coin’s fees aren’t routed through fee sharing.' });
    const bh = (await L.rpc('getLatestBlockhash', [{ commitment: 'confirmed' }])).value.blockhash;
    const out = await P.buildFeed({ mint, payer, blockhash: bh, getAccounts: addrs => L.accounts(addrs) });
    L.send(res, 200, { ok: true, ...out, waiting: r.waitingLamports, shareholders: r.shareholders });
  } catch (e) { L.send(res, 200, { ok: false, error: 'The payout didn’t build: ' + String(e && e.message || e).slice(0, 140) }); }
};
