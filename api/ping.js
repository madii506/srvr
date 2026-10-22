// GET /api/ping?q=<address> — one live read of any Java Edition server: online or not, players, version, its message,
// its icon, who's on. Plus any srvr coin that points at it.
const L = require('./_lib');
module.exports = async (req, res) => {
  if (L.limited('ping:' + L.ip(req), 60, 60000)) return L.send(res, 200, { ok: false, error: 'Too many pings. Wait a moment.' });
  const q = String(L.query(req).q || '').trim();
  const a = L.address(q);
  if (!a) return L.send(res, 200, { ok: false, error: q ? `“${q.slice(0, 60)}” isn’t a server address. Try play.example.net.` : 'Type a server address, like play.example.net.' });
  try {
    const st = await L.status(a);
    let coins = [];
    if (L.dbReady()) { try { await L.ready(); coins = await L.q(`SELECT mint, name, symbol FROM srvr_coins WHERE server=$1 AND status='live' ORDER BY live_at DESC LIMIT 3`, [a.key]); } catch {} }
    L.send(res, 200, { ok: true, host: a.key, ...st, icon: st.icon && st.icon.length < 40000 ? st.icon : '', mood: L.mood(st),
      sample: st.sample.map(p => ({ ...p, head: p.uuid ? `https://mc-heads.net/avatar/${p.uuid}/32` : '' })), coins, at: Date.now() }, L.CACHE(20, 60));
  } catch { L.send(res, 200, { ok: false, error: `No status for ${a.key} right now. Check the address, or try again.` }); }
};
