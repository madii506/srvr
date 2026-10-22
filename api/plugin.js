// GET /api/plugin?mint=<mint>  → srvr.jar, built on request with this site's address and your coin inside (drop it in /plugins)
// GET /api/plugin?f=java | plugin | config | gradle   → a source file, as text (add &view=1 to read it in the browser)
// GET /api/plugin?f=src        → the whole source tree as a zip, ready for `gradle build`
const P = require('./_plugin');
const zlib = require('node:zlib');
const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return b => { let c = 0xFFFFFFFF; for (const x of b) c = t[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }; })();
// a plain zip (deflate), which is all a jar is
function zip(files) {
  const parts = [], central = []; let off = 0;
  for (const [name, data] of files) {
    const nb = Buffer.from(name), raw = Buffer.isBuffer(data) ? data : Buffer.from(data), def = zlib.deflateRawSync(raw), crc = CRC(raw);
    const h = Buffer.alloc(30); h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8); h.writeUInt16LE(0, 10); h.writeUInt16LE(0x5a21, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(def.length, 18); h.writeUInt32LE(raw.length, 22); h.writeUInt16LE(nb.length, 26); h.writeUInt16LE(0, 28);
    parts.push(h, nb, def);
    const c = Buffer.alloc(46); c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10); c.writeUInt16LE(0, 12); c.writeUInt16LE(0x5a21, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(def.length, 20); c.writeUInt32LE(raw.length, 24); c.writeUInt16LE(nb.length, 28); c.writeUInt32LE(off, 42);
    central.push(c, nb); off += 30 + nb.length + def.length;
  }
  const cd = Buffer.concat(central), e = Buffer.alloc(22); e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(files.length, 8); e.writeUInt16LE(files.length, 10); e.writeUInt32LE(cd.length, 12); e.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cd, e]);
}
module.exports = (req, res) => {
  const q = req.query || Object.fromEntries(new URL(req.url, 'http://x').searchParams);
  const hostHdr = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  const HOST = (/^(localhost|127\.)/.test(hostHdr) ? 'http://' : 'https://') + hostHdr;
  const MINT = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(q.mint || '')) ? String(q.mint) : '';
  const fill = s => s.replaceAll('%%HOST%%', HOST).replaceAll('%%MINT%%', MINT);
  const names = { java: 'SrvrGate.java', plugin: 'plugin.yml', config: 'config.yml', gradle: 'build.gradle' };
  res.setHeader('Access-Control-Allow-Origin', '*'); res.setHeader('Cache-Control', 'public, max-age=300'); res.setHeader('X-Content-Type-Options', 'nosniff');
  if (names[q.f]) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    if (q.view !== '1') res.setHeader('Content-Disposition', `attachment; filename="${names[q.f]}"`);
    return res.end(fill(P.src[q.f]));
  }
  if (q.f === 'src') {
    const readme = `srvr gate, the srvr plugin\n\nBuild: gradle build → build/libs/srvr.jar\nOr download the built jar for your coin from ${HOST}/api/plugin?mint=<your coin>\n`;
    const z = zip([['srvr-gate/README.txt', readme], ['srvr-gate/build.gradle', P.src.gradle], ['srvr-gate/src/srvr/gate/SrvrGate.java', P.src.java], ['srvr-gate/res/plugin.yml', fill(P.src.plugin)], ['srvr-gate/res/config.yml', fill(P.src.config)]]);
    res.setHeader('Content-Type', 'application/zip'); res.setHeader('Content-Disposition', 'attachment; filename="srvr-gate-src.zip"'); return res.end(z);
  }
  const files = [['META-INF/MANIFEST.MF', 'Manifest-Version: 1.0\r\nCreated-By: srvr\r\n\r\n'], ['plugin.yml', fill(P.src.plugin)], ['config.yml', fill(P.src.config)]];
  for (const [n, b64] of Object.entries(P.cls)) files.push([n, Buffer.from(b64, 'base64')]);
  res.setHeader('Content-Type', 'application/java-archive'); res.setHeader('Content-Disposition', 'attachment; filename="srvr.jar"');
  res.end(zip(files));
};
