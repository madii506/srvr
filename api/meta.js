// GET /m/<mint>  (rewritten to /api/meta?id=) the metadata JSON the coin's on-chain uri points at.
// GET /i/<mint>  (rewritten to /api/meta?img=) the coin's picture, as uploaded at launch.
const L = require('./_lib');
module.exports = async (req, res) => {
  const qy = L.query(req);
  const key = String(qy.img || qy.id || '').replace(/\.\w+$/, '');
  if (!L.isAddr(key) || !L.dbReady()) { res.statusCode = 404; res.setHeader('Cache-Control', 'public, max-age=60'); return res.end(); }
  await L.ready();
  if (qy.img) {
    const r = (await L.q('SELECT image, image_type FROM srvr_coins WHERE mint=$1', [key]).catch(() => []))[0];
    if (!r || !r.image) { res.statusCode = 404; res.setHeader('Cache-Control', 'public, max-age=60'); return res.end(); }
    res.statusCode = 200; res.setHeader('Content-Type', r.image_type || 'image/png');
    res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=31536000, immutable');
    return res.end(Buffer.from(String(r.image), 'base64'));
  }
  const r = (await L.q('SELECT mint, name, symbol, description, server, rent, twitter FROM srvr_coins WHERE mint=$1', [key]).catch(() => []))[0];
  if (!r) return L.send(res, 404, { error: 'not found' }, 'public, max-age=30');
  const site = L.origin(req);
  L.send(res, 200, {
    name: r.name, symbol: r.symbol, description: r.description || `$${r.symbol} has its own server: ${r.server}. hold it to get in.`,
    image: site + '/i/' + r.mint, showName: true, createdOn: site, website: site + '/s/' + r.mint, ...(r.twitter ? { twitter: r.twitter } : {}),
    srvr: { v: 1, server: r.server, rent: { address: r.rent, bps: 10000 }, whitelist: site + '/api/whitelist?mint=' + r.mint },
  }, 'public, max-age=300, s-maxage=86400, stale-while-revalidate=604800');
};
