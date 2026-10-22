// GET /api/whitelist?mint=<mint> — the server's door list, in the shape of a Java Edition whitelist.json:
// [{"uuid": "...", "name": "..."}]. Every wallet that linked a name is checked against the chain again on each read:
// a wallet whose token account no longer holds the coin is left out. ?format=names gives one name per line.
// If Solana can't be read, it answers 503 rather than an empty list, so a server never locks everyone out by mistake.
const L = require('./_lib');
async function balances(accts) {               // jsonParsed token accounts, in order; null where none exists
  const out = [];
  for (let i = 0; i < accts.length; i += 100) {
    const r = await L.rpc('getMultipleAccounts', [accts.slice(i, i + 100), { encoding: 'jsonParsed', commitment: 'confirmed' }]);
    for (const a of r.value) { const info = a && a.data && a.data.parsed && a.data.parsed.info; out.push(info ? { mint: info.mint, owner: info.owner, amount: BigInt(info.tokenAmount.amount) } : null); }
  }
  return out;
}
module.exports = async (req, res) => {
  const qy = L.query(req), mint = String(qy.mint || '');
  res.setHeader('Access-Control-Allow-Origin', '*');
  if (!L.isAddr(mint)) return L.send(res, 400, { error: 'Add ?mint=<the coin’s address>.' });
  if (!L.dbReady()) return L.send(res, 503, { error: 'srvr’s records are offline. Keep your current whitelist.' });
  try {
    await L.ready();
    const coin = (await L.q('SELECT status FROM srvr_coins WHERE mint=$1', [mint]))[0];
    if (!coin) return L.send(res, 404, { error: 'No coin with that address was launched on srvr.' });
    const list = await L.remember('wl:' + mint, 45000, async () => {
      const rows = await L.q('SELECT wallet, name, uuid, acct FROM srvr_keys WHERE mint=$1 ORDER BY created_at', [mint]);
      const bal = await balances(rows.map(r => r.acct));
      return rows.filter((r, i) => bal[i] && bal[i].mint === mint && bal[i].owner === r.wallet && bal[i].amount > 0n).map(r => ({ uuid: L.dashed(r.uuid), name: r.name }));
    });
    if (qy.format === 'names') { res.statusCode = 200; res.setHeader('Content-Type', 'text/plain; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=60'); return res.end(list.map(x => x.name).join('\n') + (list.length ? '\n' : '')); }
    res.statusCode = 200; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('Cache-Control', 'public, max-age=0, must-revalidate'); res.setHeader('CDN-Cache-Control', 's-maxage=60, stale-while-revalidate=120');
    res.end(JSON.stringify(list, null, qy.view ? 2 : 0));
  } catch (e) { L.send(res, 503, { error: 'Solana didn’t answer just now. Keep your current whitelist and try again.' }); }
};
