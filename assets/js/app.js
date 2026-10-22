// srvr's tools: launch a coin for a server (pump.fun, from your wallet), the servers board, join (wallet + game name),
// ping any server, the owner's plugin, and each coin's sheet with "pay the rent". Everything here talks to /api/*;
// nothing on the page holds a key, and every transaction is signed in your own wallet.
const $ = (s, el = document) => el.querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const short = a => (a ? a.slice(0, 4) + '…' + a.slice(-4) : '');
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PUMP = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P', FEES = 'pfeeUxB6jkeY1Hxd7CsFCAjcbHA9rWtchMGdZ6VojVZ';
const D_CREATE = '214,144,76,236,95,139,49,180', D_UPDATE = '111,251,49,6,78,78,106,18';
const isAddr = s => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(String(s || ''));
const fmtUsd = v => (v == null ? '—' : v >= 1e6 ? '$' + (v / 1e6).toFixed(2) + 'M' : v >= 1e3 ? '$' + (v / 1e3).toFixed(1) + 'K' : '$' + v.toFixed(0));
const fmtSol = v => (v == null ? '—' : (v >= 100 ? v.toFixed(0) : v >= 1 ? v.toFixed(1) : v.toFixed(3)) + ' SOL');
const moodTxt = { on: 'players on', sleep: 'online, empty', off: 'offline' };
let CTX = {};

async function api(url, { body, timeout = 20000 } = {}) {
  try {
    const r = await fetch(url, { method: body ? 'POST' : 'GET', headers: body ? { 'content-type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(timeout) });
    return await r.json();
  } catch (e) { return { ok: false, error: /timeout|abort/i.test(String(e && e.name)) ? 'That took too long. Try again.' : 'Couldn’t reach srvr. Check your connection.' }; }
}
let tipT; function tip(t) { let el = $('.tip'); if (!el) { el = document.createElement('div'); el.className = 'tip'; document.body.appendChild(el); } el.textContent = t; el.classList.add('on'); clearTimeout(tipT); tipT = setTimeout(() => el.classList.remove('on'), 1600); $('#sr').textContent = t; }
async function copy(t, what = 'copied') { try { await navigator.clipboard.writeText(t); tip(what); } catch { const a = document.createElement('textarea'); a.value = t; document.body.appendChild(a); a.select(); try { document.execCommand('copy'); tip(what); } catch { tip('couldn’t copy'); } a.remove(); } }
function busyBtn(b, on, label) { if (on) { b.dataset.l = b.dataset.l || b.innerHTML; b.disabled = true; b.innerHTML = `<span class="spin"></span>${esc(label || 'working')}`; } else { b.disabled = false; if (b.dataset.l) b.innerHTML = b.dataset.l; delete b.dataset.l; } }

// ---------------------------------------------------------------- wallets (Phantom, Solflare, Backpack)
const mobileUA = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
const PROVS = [
  { id: 'phantom', name: 'Phantom', get: () => (window.phantom && window.phantom.solana) || (window.solana && window.solana.isPhantom && window.solana), url: 'https://phantom.com', deep: u => 'https://phantom.app/ul/browse/' + encodeURIComponent(u) + '?ref=' + encodeURIComponent(location.origin) },
  { id: 'solflare', name: 'Solflare', get: () => (window.solflare && window.solflare.isSolflare && window.solflare) || null, url: 'https://solflare.com', deep: u => 'https://solflare.com/ul/v1/browse/' + encodeURIComponent(u) + '?ref=' + encodeURIComponent(location.origin) },
  { id: 'backpack', name: 'Backpack', get: () => window.backpack && (window.backpack.solana || window.backpack), url: 'https://backpack.app', deep: null },
];
const W = { me: null, prov: null, id: null, on: new Set() };
const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { v == null ? localStorage.removeItem(k) : localStorage.setItem(k, v); } catch {} } };
function setMe(pk, pr, id) { W.me = pk; W.prov = pr; W.id = id; store.set('srvr:wallet', id); try { pr.on && pr.on('accountChanged', k => { if (k) setMe(k.toString(), pr, id); else forget(); }); } catch {} W.on.forEach(f => f()); }
function forget() { try { W.prov && W.prov.disconnect && W.prov.disconnect(); } catch {} W.me = W.prov = W.id = null; store.set('srvr:wallet', null); W.on.forEach(f => f()); }
async function connectTo(id) {
  const p = PROVS.find(x => x.id === id), pr = p && p.get(); if (!pr) throw new Error(`${p ? p.name : 'That wallet'} isn’t installed here.`);
  try { const r = await pr.connect(), pk = (r && r.publicKey) || pr.publicKey; if (!pk) throw new Error('no key'); setMe(pk.toString(), pr, id); return W.me; }
  catch (e) { throw new Error(/reject|denied|cancel|closed/i.test(String(e && e.message)) ? `You declined it in ${p.name}.` : `${p.name} didn’t connect.`); }
}
(async function reconnect() { const id = store.get('srvr:wallet'), p = PROVS.find(x => x.id === id); if (!p) return; for (let i = 0; i < 8 && !p.get(); i++) await sleep(250); const pr = p.get(); if (!pr) return; try { const r = await pr.connect({ onlyIfTrusted: true }), pk = (r && r.publicKey) || pr.publicKey; if (pk) setMe(pk.toString(), pr, id); } catch {} })();
// the wallet chooser shown inside a form when nothing is connected yet
function chooser(box, after) {
  const found = PROVS.filter(p => p.get());
  if (found.length === 1) return connectTo(found[0].id).then(after);
  box.innerHTML = found.length ? found.map(p => `<button type="button" data-w="${p.id}">${p.name}</button>`).join('')
    : PROVS.map(p => `<a href="${mobileUA && p.deep ? p.deep(location.href) : p.url}" target="_blank" rel="noopener"><span class="dimx">${mobileUA && p.deep ? 'open in' : 'get'}</span> ${p.name} ↗</a>`).join('');
  box.onclick = async e => { const b = e.target.closest('[data-w]'); if (!b) return; try { await connectTo(b.dataset.w); box.innerHTML = ''; after && after(); } catch (er) { tip(er.message); } };
  return Promise.resolve();
}

// ---------------------------------------------------------------- solana, through the page's narrow rpc window
let web3 = null;
function loadWeb3() { if (window.solanaWeb3) return Promise.resolve(window.solanaWeb3); if (web3) return web3; web3 = new Promise((ok, no) => { const s = document.createElement('script'); s.src = '/assets/vendor/web3.min.js'; s.onload = () => ok(window.solanaWeb3); s.onerror = () => { web3 = null; no(new Error('Couldn’t load the Solana library. Check your connection.')); }; document.head.appendChild(s); }); return web3; }
async function rpc(method, params) { const j = await api('/api/rpc', { body: { method, params }, timeout: 25000 }); if (!j.ok) { const e = new Error(explain(j.error, j.logs)); e.logs = j.logs; throw e; } return j.result; }
const toB64 = u => { let s = ''; const a = u instanceof Uint8Array ? u : Uint8Array.from(u); for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => Uint8Array.from(atob(s), c => c.charCodeAt(0));
async function confirmSig(sig) {
  for (let i = 0; i < 50; i++) {
    await sleep(1400);
    const st = await rpc('getSignatureStatuses', [[sig], { searchTransactionHistory: false }]).catch(() => null);
    const s = st && st.value && st.value[0];
    if (s && s.err) throw new Error('It failed on-chain, so nothing changed.');
    if (s && (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized')) return true;
  }
  throw new Error('Solana hasn’t confirmed it yet. Check your wallet’s activity before trying again.');
}
const sendTx = tx => rpc('sendTransaction', [toB64(tx.serialize()), { encoding: 'base64', preflightCommitment: 'confirmed', maxRetries: 5 }]);
async function simulate(tx) {
  const r = await rpc('simulateTransaction', [toB64(tx.serialize()), { encoding: 'base64', sigVerify: false, replaceRecentBlockhash: true, commitment: 'confirmed' }]);
  const v = r && r.value; if (!v) throw new Error('Solana didn’t simulate it.');
  if (v.err) { const e = new Error(explain(v.err, v.logs)); e.logs = v.logs; throw e; }
  return v;
}
function explain(err, logs) {
  const s = (typeof err === 'string' ? err : JSON.stringify(err)) + ' ' + (logs || []).join(' ');
  if (/insufficient lamports|InsufficientFunds|0x1\b|insufficient funds/i.test(s)) return 'Not enough SOL in your wallet for this.';
  if (/already in use/i.test(s)) return 'That coin address is taken. Try again; a new one is made each time.';
  if (/AccountNotFound/i.test(s)) return 'Your wallet has no SOL on it yet.';
  return typeof err === 'string' ? err.slice(0, 200) : 'Solana would reject this: ' + String(JSON.stringify(err)).slice(0, 140);
}
const human = m => { m = String((m && m.message) || m); return /reject|denied|cancel|declined|closed/i.test(m) ? 'You cancelled it in your wallet. Nothing was sent.' : /insufficient|0x1\b|lamports/i.test(m) ? 'Not enough SOL in your wallet for that.' : m.slice(0, 280); };
async function signAll(txs) { if (txs.length > 1 && W.prov.signAllTransactions) return W.prov.signAllTransactions(txs); const out = []; for (const t of txs) out.push(await W.prov.signTransaction(t)); return out; }
function b58(bytes) { const A = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'; let n = 0n; for (const b of bytes) n = n * 256n + BigInt(b); let s = ''; while (n > 0n) { s = A[Number(n % 58n)] + s; n /= 58n; } for (const b of bytes) { if (b === 0) s = '1' + s; else break; } return s; }
function ixs(tx) { const m = tx.message, keys = m.staticAccountKeys.map(x => x.toBase58()); return m.compiledInstructions.map(ix => ({ prog: keys[ix.programIdIndex], keys: ix.accountKeyIndexes.map(i => keys[i]), data: ix.data })); }
const head = d => Array.from(d.slice(0, 8)).join(',');
// read the transactions before signing: the right coin, you as its creator, and every fee to the rent wallet
function check(txs, want) {
  const create = ixs(txs[0]).find(i => i.prog === PUMP && head(i.data) === D_CREATE);
  if (!create) throw new Error('The coin creation is missing, so nothing was signed.');
  if (create.keys[0] !== want.mint) throw new Error('That isn’t the coin made here, so nothing was signed.');
  const d = create.data; let o = 8; for (let q = 0; q < 3; q++) { const n = d[o] | d[o + 1] << 8 | d[o + 2] << 16 | d[o + 3] << 24; o += 4 + n; }
  if (b58(d.slice(o, o + 32)) !== want.me) throw new Error('The coin’s creator isn’t you, so nothing was signed.');
  const up = ixs(txs[1]).find(i => i.prog === FEES && head(i.data) === D_UPDATE);
  if (!up) throw new Error('The fee lock is missing, so nothing was signed.');
  const u = up.data, n = u[8] | u[9] << 8 | u[10] << 16 | u[11] << 24, got = [];
  for (let q = 0, p = 12; q < n; q++, p += 34) got.push({ address: b58(u.slice(p, p + 32)), bps: u[p + 32] | u[p + 33] << 8 });
  if (got.length !== 1 || got[0].address !== want.rent || got[0].bps !== 10000) throw new Error('The fees don’t all go to your rent wallet, so nothing was signed.');
}

// ---------------------------------------------------------------- the coin picture: uploaded, or a block face
let picCanvas = null;
function defaultPic(sym) {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#0a0a0c'; g.fillRect(0, 0, 512, 512);
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  const gr = g.createLinearGradient(0, 106, 0, 406); gr.addColorStop(0, '#f6f7f9'); gr.addColorStop(1, '#d6d9de'); g.fillStyle = gr; rr(106, 106, 300, 300, 46); g.fill();
  g.fillStyle = '#3ee08f'; g.fillRect(184, 196, 38, 62); g.fillRect(290, 196, 38, 62);
  g.fillStyle = '#15171b'; g.fillRect(193, 306, 126, 10);
  if (sym) { g.fillStyle = '#8b9097'; g.font = '600 30px JBM, monospace'; g.textAlign = 'center'; g.fillText('$' + sym, 256, 466); }
  return c;
}
function fromFile(file) {
  return new Promise((ok, no) => {
    if (!/^image\//.test(file.type)) return no(new Error('That isn’t a picture.'));
    if (file.size > 12e6) return no(new Error('That picture is over 12 MB.'));
    const url = URL.createObjectURL(file), im = new Image();
    im.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d'); const s = Math.max(512 / im.width, 512 / im.height), w = im.width * s, h = im.height * s; g.fillStyle = '#fff'; g.fillRect(0, 0, 512, 512); g.drawImage(im, (512 - w) / 2, (512 - h) / 2, w, h); URL.revokeObjectURL(url); ok(c); };
    im.onerror = () => { URL.revokeObjectURL(url); no(new Error('That picture didn’t open.')); };
    im.src = url;
  });
}
function dataUrl(c) { let d = c.toDataURL('image/png'); if (d.length > 520000) { for (const q of [0.9, 0.82, 0.72, 0.6]) { d = c.toDataURL('image/jpeg', q); if (d.length < 520000) break; } } return d; }

// ---------------------------------------------------------------- 02 launch
const STEPS = ['record the coin', 'build the transactions', 'read them before you sign', 'sign in your wallet', 'create the coin on pump.fun', 'lock the rent: 100% of fees to the rent wallet', 'your first buy', 'put it on the board'];
function launch() {
  const f = $('#lf'), go = $('#lfGo'), err = $('#lfErr'), wal = $('#lfWal'), trail = $('#lfSteps'), done = $('#lfDone');
  const name = $('#fName'), sym = $('#fSym'), srv = $('#fSrv'), srvSt = $('#fSrvSt'), rent = $('#fRent'), desc = $('#fDesc'), x = $('#fX'), buy = $('#fBuy'), quote = $('#fQuote');
  const pic = $('#pic'), picIn = $('#picIn'), picImg = $('#picImg');
  trail.innerHTML = STEPS.map(s => `<li><i></i><span>${esc(s)}<small></small></span></li>`).join('');
  const idle = document.createElement('p'); idle.className = 'idle-note'; idle.innerHTML = 'your wallet signs everything. <b>srvr never holds a key</b> and adds no fee. fees lock to the rent wallet in the same launch, for good.'; trail.parentNode.insertBefore(idle, trail);
  const label = () => { go.textContent = W.me ? `launch${sym.value.trim() ? ' $' + sym.value.trim().toUpperCase() : ''}` : 'connect a wallet'; rent.placeholder = W.me ? 'your wallet · ' + short(W.me) : 'your wallet'; };
  W.on.add(label); label(); sym.addEventListener('input', () => { sym.value = sym.value.replace(/[^A-Za-z0-9$]/g, '').toUpperCase().slice(0, 11); label(); });
  // picture
  const setPic = c => { picCanvas = c; picImg.src = c.toDataURL('image/png'); picImg.hidden = false; pic.querySelector('.pic-e').hidden = true; };
  const take = async file => { try { setPic(await fromFile(file)); } catch (e) { err.textContent = e.message; } };
  pic.addEventListener('click', () => picIn.click()); pic.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); picIn.click(); } });
  picIn.addEventListener('change', () => picIn.files[0] && take(picIn.files[0]));
  pic.addEventListener('dragover', e => { e.preventDefault(); pic.classList.add('drag'); }); pic.addEventListener('dragleave', () => pic.classList.remove('drag'));
  pic.addEventListener('drop', e => { e.preventDefault(); pic.classList.remove('drag'); const fl = e.dataTransfer.files[0]; if (fl) take(fl); });
  // the server address gets a live ping as you leave the field
  let pingT;
  const pingSrv = async () => { const v = srv.value.trim(); if (!v) { srvSt.textContent = ''; srvSt.className = 'srvst'; return; } srvSt.className = 'srvst'; srvSt.textContent = 'pinging…';
    const r = await api('/api/ping?q=' + encodeURIComponent(v), { timeout: 15000 });
    if (!r.ok) { srvSt.className = 'srvst bad'; srvSt.textContent = r.error; return; }
    srvSt.className = 'srvst ' + (r.online ? 'ok' : 'warn'); srvSt.textContent = r.online ? `online · ${r.players}/${r.max} on · ${r.version || 'java edition'}` : 'offline right now. you can still launch; its block will sleep until it’s up.'; };
  srv.addEventListener('blur', pingSrv); srv.addEventListener('input', () => { clearTimeout(pingT); pingT = setTimeout(pingSrv, 900); });
  // a first buy, priced on a fresh curve by pump.fun's own math
  let qT; buy.addEventListener('input', () => { buy.value = buy.value.replace(/[^0-9.]/g, '').slice(0, 6); clearTimeout(qT); const v = Number(buy.value); if (!v) { quote.textContent = ''; return; }
    qT = setTimeout(async () => { const r = await api('/api/build?quote=' + Math.round(v * 1e9)); quote.textContent = r.ok ? `≈ ${(r.pct * 100).toFixed(2)}% of supply` : ''; }, 350); });
  const steps = [...trail.children];
  const ui = { step(i, n) { steps.forEach((li, k) => { if (k < i && !li.classList.contains('skip') && !li.classList.contains('warn')) li.className = 'ok'; }); steps[i].className = 'now'; if (n) steps[i].querySelector('small').innerHTML = n; },
    note(i, h) { steps[i].querySelector('small').innerHTML = h; }, skip(i) { steps[i].className = 'skip'; steps[i].querySelector('small').textContent = 'skipped'; }, warn(i, t) { steps[i].className = 'warn'; steps[i].querySelector('small').textContent = t; },
    fail(m) { const cur = steps.find(li => li.className === 'now'); if (cur) cur.className = 'bad'; err.textContent = m; }, end() { steps.forEach(li => { if (li.className === 'now') li.className = 'ok'; }); } };
  const txA = sig => `<a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">tx ${esc(short(sig))} ↗</a>`;
  let running = false;
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    if (running) return;
    if (!W.me) return chooser(wal, label).catch(er => { err.textContent = er.message; });
    const o = { name: name.value.trim(), symbol: sym.value.trim().replace(/^\$/, '').toUpperCase(), server: srv.value.trim(), rent: rent.value.trim() || W.me, desc: desc.value.trim(), x: x.value.trim(), buy: Number(buy.value) || 0 };
    if (!o.name || new TextEncoder().encode(o.name).length > 32) { err.textContent = 'Give it a name of up to 32 characters.'; name.focus(); return; }
    if (!/^[A-Z0-9]{1,10}$/.test(o.symbol)) { err.textContent = 'The ticker is 1–10 letters or numbers.'; sym.focus(); return; }
    if (!/^[a-z0-9.-]+\.[a-z0-9-]+(:\d{1,5})?$/i.test(o.server.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, ''))) { err.textContent = 'Add your server’s address, like play.yourserver.net.'; srv.focus(); return; }
    if (!isAddr(o.rent)) { err.textContent = 'The rent wallet isn’t a Solana address.'; rent.focus(); return; }
    if (o.buy < 0 || o.buy > 5) { err.textContent = 'Keep the first buy between 0 and 5 SOL.'; buy.focus(); return; }
    running = true; busyBtn(go, true, 'launching'); done.hidden = true; steps.forEach(li => { li.className = ''; li.querySelector('small').textContent = ''; });
    $('#launch').scrollIntoView && CTX.lenis && CTX.lenis.scrollTo(f.closest('.launch'), { offset: -80 });
    try {
      const w3 = await loadWeb3();
      const mintKp = w3.Keypair.generate(), mint = mintKp.publicKey.toBase58();
      ui.step(0, 'coin address ' + esc(short(mint)));
      const canvas = picCanvas || defaultPic(o.symbol);
      const rec = await api('/api/coin', { body: { mint, payer: W.me, name: o.name, symbol: o.symbol, description: o.desc, server: o.server, rent: o.rent, twitter: o.x, image: dataUrl(canvas) }, timeout: 30000 });
      if (!rec.ok) throw new Error(rec.error);
      ui.note(0, `coin ${esc(short(mint))} · server ${esc(rec.server)}`);
      ui.step(1);
      const b = await api('/api/build', { body: { mint, payer: W.me, devBuy: String(Math.round(o.buy * 1e9)) }, timeout: 30000 });
      if (!b.ok) throw new Error(b.error);
      const txs = b.txs.map(t => w3.VersionedTransaction.deserialize(fromB64(t)));
      ui.note(1, `${txs.length} transactions · built with pump.fun’s own sdk`);
      ui.step(2); check(txs, { mint, me: W.me, rent: o.rent }); await simulate(txs[0]);
      ui.note(2, `creator is you · 100% of fees → ${esc(short(o.rent))} · locked · simulated`);
      const pname = (PROVS.find(p => p.id === W.id) || {}).name || 'your wallet';
      ui.step(3, 'approve it in ' + pname); let signed; try { signed = await signAll(txs); } catch (er) { throw new Error(human(er)); }
      signed[0].sign([mintKp]);
      if (!signed[0].signatures.every(s => s && s.some(v => v !== 0))) throw new Error('A signature is missing, so nothing was sent.');
      ui.step(4); const sig = await sendTx(signed[0]); ui.note(4, txA(sig)); await confirmSig(sig);
      ui.step(5); let routed = false;
      try { const s2 = await sendTx(signed[1]); ui.note(5, txA(s2) + ' · admin revoked'); await confirmSig(s2); routed = true; } catch (er) { ui.warn(5, 'didn’t confirm: ' + human(er)); }
      if (!routed) throw new Error('The coin is live, but its fees aren’t locked yet. Open its page to lock them.');
      if (signed[2]) { ui.step(6); try { const s3 = await sendTx(signed[2]); ui.note(6, txA(s3)); await confirmSig(s3); } catch { ui.warn(6, 'your first buy didn’t confirm; check your wallet.'); } } else ui.skip(6);
      ui.step(7); let st = null; for (let i = 0; i < 8; i++) { st = await api('/api/settle', { body: { mint, sig } }).catch(() => null); if (st && st.live) break; await sleep(2500); }
      ui.note(7, st && st.live ? 'on the board' : 'the board will pick it up shortly'); ui.end();
      done.hidden = false;
      const share = 'https://x.com/intent/post?text=' + encodeURIComponent(`$${o.symbol} has its own server. hold it to get in.\n\n${location.origin}/s/${mint}`);
      done.innerHTML = `<h3>$${esc(o.symbol)} is live.</h3><p>its fees go to ${esc(short(o.rent))}, locked. now drop srvr.jar in your server’s /plugins and holders can join.</p>
        <div class="acts"><a class="btn pri sm" href="/api/plugin?mint=${esc(mint)}" download>download srvr.jar</a><a class="btn sm" href="https://pump.fun/coin/${esc(mint)}" target="_blank" rel="noopener">pump.fun ↗</a><a class="btn sm" href="${share}" target="_blank" rel="noopener">share on x ↗</a><button class="btn sm" type="button" data-open="${esc(mint)}">its page</button></div>`;
      board(true).then(() => { for (const sel of ['#jCoin', '#oCoin']) { const el = $(sel); if ([...el.options].some(o => o.value === mint)) { el.value = mint; } } $('.jmint').hidden = $('#jCoin').value !== 'paste'; $('.omint').hidden = $('#oCoin').value !== 'paste'; owners(); });
    } catch (er) { ui.fail(esc(human(er))); }
    finally { running = false; busyBtn(go, false); label(); }
  });
}

// ---------------------------------------------------------------- 03 the board, and the coin pickers that use it
let COINS = [], SOLUSD = null, boardAt = 0;
const glyph = (m, cls = '') => `<i class="gl ${m || 'wait'} ${cls}"></i>`;
async function board(force) {
  const el = $('#board'), live = $('#bdLive');
  if (!force && Date.now() - boardAt < 25000) return;
  const r = await api('/api/coin?list=1');
  boardAt = Date.now();
  if (!r.ok) { if (!COINS.length) el.innerHTML = `<div class="empty">${glyph('off', 'big')}<p>${esc(r.error)}</p><button class="btn sm" type="button" id="bdRetry">try again</button></div>`; live.innerHTML = '· offline'; return; }
  COINS = r.coins || []; SOLUSD = r.solUsd;
  live.innerHTML = `<b>●</b> live`;
  if (!COINS.length) el.innerHTML = `<div class="empty">${glyph('sleep', 'big')}<p>no servers yet. the first block could be yours.</p><a class="btn pri sm" href="#launch">launch a server</a></div>`;
  else el.innerHTML = COINS.map(c => { const s = c.st, mc = c.curve && c.curve.mcapSol;
    return `<div class="brow" role="button" tabindex="0" data-open="${esc(c.mint)}">${glyph(c.mood, '')}<div class="nm"><img src="${esc(c.image)}" alt="" loading="lazy"><div><b>${esc(c.name)}</b><small>$${esc(c.symbol)}</small></div></div>
      <div class="sv">${esc(c.server)}</div><div class="pl">${s && s.online ? `${s.players}/${s.max}` : '—'}<small>${moodTxt[c.mood] || 'checking'}</small></div>
      <div class="mc">${SOLUSD && mc ? fmtUsd(mc * SOLUSD) : fmtSol(mc)}<small>${c.keys} ${c.keys === 1 ? 'key' : 'keys'}</small></div>
      <div class="go"><button class="btn sm" type="button" data-join="${esc(c.mint)}">join</button><a class="btn sm" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">pump.fun ↗</a></div></div>`; }).join('');
  fillPickers();
}
function fillPickers() {
  for (const [sel, wrap] of [['#jCoin', '.jmint'], ['#oCoin', '.omint']]) {
    const s = $(sel), keep = s.value;
    s.innerHTML = (COINS.length ? COINS.map(c => `<option value="${esc(c.mint)}">$${esc(c.symbol)} · ${esc(c.server)}</option>`).join('') : '<option value="" disabled selected>no coins on the board yet</option>') + '<option value="paste">paste a coin address…</option>';
    if (keep && [...s.options].some(o => o.value === keep)) s.value = keep;
    $(wrap).hidden = s.value !== 'paste';
  }
  owners();
}
const pickedMint = (sel, inp) => { const v = $(sel).value; return v === 'paste' ? $(inp).value.trim() : v; };

// ---------------------------------------------------------------- 04 join
function join() {
  const f = $('#jf'), go = $('#jGo'), err = $('#jErr'), wal = $('#jfWal'), done = $('#jDone'), nm = $('#jName'), nmSt = $('#jNameSt');
  const label = () => { go.textContent = W.me ? 'sign and join' : 'connect a wallet'; }; W.on.add(label); label();
  $('#jCoin').addEventListener('change', () => { $('.jmint').hidden = $('#jCoin').value !== 'paste'; });
  nm.addEventListener('input', () => { nm.value = nm.value.replace(/[^A-Za-z0-9_]/g, '').slice(0, 16); nmSt.className = ''; nmSt.textContent = nm.value && !/^[A-Za-z0-9_]{3,16}$/.test(nm.value) ? '3–16 letters, numbers or underscores' : ''; });
  f.addEventListener('submit', async e => {
    e.preventDefault(); err.textContent = '';
    if (!W.me) return chooser(wal, label).catch(er => { err.textContent = er.message; });
    const mint = pickedMint('#jCoin', '#jMint'), name = nm.value.trim();
    if (!isAddr(mint)) { err.textContent = 'Pick a coin, or paste its address.'; return; }
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name)) { err.textContent = 'A Java Edition name is 3–16 letters, numbers or underscores.'; nm.focus(); return; }
    if (!W.prov.signMessage) { err.textContent = 'This wallet can’t sign messages. Try Phantom, Solflare or Backpack.'; return; }
    busyBtn(go, true, 'sign in your wallet'); done.hidden = true;
    try {
      const ts = Date.now(), msg = `srvr · let me in\ncoin: ${mint}\nplayer: ${name}\nwallet: ${W.me}\ntime: ${ts}`;
      let r; try { r = await W.prov.signMessage(new TextEncoder().encode(msg), 'utf8'); } catch (er) { throw new Error(human(er)); }
      const sig = r && r.signature ? r.signature : r;
      busyBtn(go, false); busyBtn(go, true, 'checking your wallet');
      const j = await api('/api/join', { body: { mint, wallet: W.me, name, ts, sig: toB64(sig) } });
      if (!j.ok) throw new Error(j.error);
      done.hidden = false;
      done.innerHTML = `<h3>you’re on the list, ${esc(j.name)}.</h3><p>$${esc(j.symbol)}’s server picks it up on its next sync, within two minutes. join <b>${esc(j.server)}</b> in java edition. ${j.count} ${j.count === 1 ? 'holder has' : 'holders have'} keys now.</p><div class="acts"><button class="btn sm" type="button" data-copy="${esc(j.server)}">copy address</button></div>`;
    } catch (er) { err.textContent = er.message; }
    finally { busyBtn(go, false); label(); }
  });
}

// ---------------------------------------------------------------- 05 ping
function renderMotd(segs) { return (segs || []).map(s => `<span style="color:${esc(s.c)};${s.b ? 'font-weight:700' : ''}">${esc(s.t)}</span>`).join(''); }
function ping() {
  const f = $('#pf'), q = $('#pQ'), card = $('#pCard'), btn = f.querySelector('button');
  const run = async v => {
    v = (v || q.value).trim(); if (!v) { q.focus(); return; } q.value = v;
    busyBtn(btn, true, 'pinging'); const r = await api('/api/ping?q=' + encodeURIComponent(v), { timeout: 15000 }); busyBtn(btn, false);
    card.hidden = false;
    if (!r.ok) { card.innerHTML = `${glyph('off', 'huge')}<div><h3>${esc(v)}</h3><p class="err" style="margin-top:10px">${esc(r.error)}</p></div>`; return; }
    card.innerHTML = `${glyph(r.mood, 'huge')}<div><div class="hd">${r.icon ? `<img src="${esc(r.icon)}" alt="">` : ''}<h3>${esc(r.host)}</h3><span class="st ${r.mood}">${moodTxt[r.mood]}</span></div>
      ${r.online && r.motd && r.motd.length ? `<div class="motd">${renderMotd(r.motd)}</div>` : ''}
      <div class="kv"><div><small>players</small>${r.online ? `${r.players.toLocaleString()} / ${r.max.toLocaleString()}` : '—'}</div><div><small>version</small>${esc(r.version || '—')}</div><div><small>read</small>just now</div></div>
      ${r.sample && r.sample.length ? `<div class="heads">${r.sample.map(p => p.head ? `<img src="${esc(p.head)}" alt="${esc(p.name)}" title="${esc(p.name)}" loading="lazy" onerror="this.remove()">` : '').join('')}</div>` : ''}
      ${r.coins && r.coins.length ? `<p class="idle-note" style="margin-top:14px">on srvr: ${r.coins.map(c => `<button class="lk" type="button" data-open="${esc(c.mint)}">$${esc(c.symbol)}</button>`).join(' ')}</p>` : ''}</div>`;
  };
  f.addEventListener('submit', e => { e.preventDefault(); run(); });
  $('#pChips').addEventListener('click', e => { const b = e.target.closest('[data-q]'); if (b) run(b.dataset.q); });
}

// ---------------------------------------------------------------- 06 owners
function owners() {
  const mint = pickedMint('#oCoin', '#oMint'), ok = isAddr(mint), jar = $('#oJar'), feed = $('#oFeed');
  jar.href = ok ? '/api/plugin?mint=' + mint : '/api/plugin'; jar.textContent = ok ? `download srvr.jar for $${(COINS.find(c => c.mint === mint) || {}).symbol || short(mint)}` : 'download srvr.jar';
  feed.href = ok ? '/api/whitelist?mint=' + mint + '&view=1' : '/api/whitelist';
  $('#oCron').textContent = `# every 2 minutes: fetch who holds, then reload the whitelist\n*/2 * * * * curl -fsS "${location.origin}/api/whitelist?mint=${ok ? mint : '<your coin>'}" -o /path/to/server/whitelist.json && mcrcon -p <rcon password> "whitelist reload"`;
}
function ownersInit() {
  $('#oCoin').addEventListener('change', () => { $('.omint').hidden = $('#oCoin').value !== 'paste'; owners(); });
  $('#oMint').addEventListener('input', owners);
  $('#oCopy').addEventListener('click', () => copy($('#oCron').textContent, 'cron line copied'));
  owners();
}

// ---------------------------------------------------------------- a coin's sheet: its server, its rent, its keys
const sheet = $('#sheet'), sheetIn = $('#sheetIn');
async function openCoin(mint, push = true) {
  if (!isAddr(mint)) return;
  sheetIn.innerHTML = `<div class="ctop">${glyph('wait', 'big')}<div><h3>loading…</h3><small>${esc(short(mint))}</small></div></div>`;
  if (!sheet.open) { try { sheet.showModal(); } catch { sheet.setAttribute('open', ''); } CTX.lenis && CTX.lenis.stop(); }
  if (push) history.replaceState(null, '', '/s/' + mint);
  const r = await api('/api/coin?mint=' + mint);
  if (!r.ok) { sheetIn.innerHTML = `<div class="ctop">${glyph('off', 'big')}<div><h3>not found</h3><small>${esc(r.error)}</small></div></div>`; return; }
  const c = r.coin, s = r.st, ch = r.chain || {}, mc = ch.mcapSol, locked = ch.routed && ch.revoked && ch.shareholders.length === 1 && ch.shareholders[0].address === c.rent;
  sheetIn.innerHTML = `<div class="ctop"><img src="${esc(c.image)}" alt=""><div><h3>${esc(c.name)} <span style="color:var(--dim)">$${esc(c.symbol)}</span></h3><small>${esc(c.mint)}</small></div></div>
    ${c.description ? `<p style="color:var(--dim);font-size:14.5px">${esc(c.description)}</p>` : ''}
    <div class="cbox"><div class="hd"><span class="lb">server</span>${glyph(r.mood)}</div>
      <div class="hd"><b style="font:600 17px/1.3 var(--mono);word-break:break-all">${esc(c.server)}</b><button class="btn sm" type="button" data-copy="${esc(c.server)}">copy</button></div>
      <div class="kv" style="margin-top:0"><div><small>status</small>${moodTxt[r.mood]}</div><div><small>players</small>${s && s.online ? `${s.players}/${s.max}` : '—'}</div><div><small>version</small>${esc((s && s.version) || '—')}</div></div></div>
    <div class="cbox"><div class="hd"><span class="lb">the rent</span><span class="lb" style="color:${locked ? 'var(--g)' : 'var(--a)'}">${locked ? 'locked on chain' : ch.exists ? 'not locked yet' : 'not on chain yet'}</span></div>
      <div class="addr">100% of creator fees → ${esc(c.rent)}</div>
      <div class="kv" style="margin-top:0"><div><small>fees waiting</small>${ch.waiting ? fmtSol(ch.waiting / 1e9) : '0 SOL'}</div><div><small>market cap</small>${r.solUsd && mc ? fmtUsd(mc * r.solUsd) : fmtSol(mc)}</div><div><small>keys</small>${c.keys}</div></div>
      <div class="acts"><button class="btn sm pri" type="button" data-rent="${esc(c.mint)}" ${ch.routed ? '' : 'disabled'}>pay the rent</button><span class="idle-note" data-rentst></span></div></div>
    <div class="acts"><button class="btn sm" type="button" data-join="${esc(c.mint)}">join this server</button><a class="btn sm" href="/api/plugin?mint=${esc(c.mint)}" download>srvr.jar</a><a class="btn sm" href="https://pump.fun/coin/${esc(c.mint)}" target="_blank" rel="noopener">pump.fun ↗</a><a class="btn sm" href="https://dexscreener.com/solana/${esc(c.mint)}" target="_blank" rel="noopener">chart ↗</a>${c.twitter ? `<a class="btn sm" href="${esc(c.twitter)}" target="_blank" rel="noopener">x ↗</a>` : ''}<button class="btn sm" type="button" data-copy="${location.origin}/s/${esc(c.mint)}">copy link</button></div>`;
}
function closeSheet() { try { sheet.close(); } catch { sheet.removeAttribute('open'); } CTX.lenis && CTX.lenis.start(); if (location.pathname.startsWith('/s/')) history.replaceState(null, '', '/'); }
// "pay the rent": anyone can push a coin's waiting creator fees out to its rent wallet (you pay the network fee)
async function payRent(mint, btn) {
  const st = btn.parentNode.querySelector('[data-rentst]');
  if (!W.me) { const box = document.createElement('div'); box.className = 'wallets'; btn.parentNode.after(box); return chooser(box, () => { box.remove(); payRent(mint, btn); }).catch(e => { st.textContent = e.message; }); }
  busyBtn(btn, true, 'building');
  try {
    const w3 = await loadWeb3();
    const b = await api('/api/feed', { body: { mint, payer: W.me } }); if (!b.ok) throw new Error(b.error);
    if (!b.waiting) throw new Error('No fees are waiting right now.');
    const tx = w3.VersionedTransaction.deserialize(fromB64(b.tx));
    busyBtn(btn, false); busyBtn(btn, true, 'sign in your wallet');
    let signed; try { [signed] = await signAll([tx]); } catch (er) { throw new Error(human(er)); }
    busyBtn(btn, false); busyBtn(btn, true, 'sending');
    const sig = await sendTx(signed); await confirmSig(sig);
    st.innerHTML = `paid ${fmtSol(b.waiting / 1e9)} to the rent wallet · <a href="https://solscan.io/tx/${esc(sig)}" target="_blank" rel="noopener">tx ↗</a>`;
  } catch (er) { st.textContent = human(er); }
  finally { busyBtn(btn, false); }
}

// ---------------------------------------------------------------- the CA pill, once srvr's own coin is live
function ca() {
  const c = (window.SRVR || {}).ca, x = (window.SRVR || {}).x, el = $('#ca'); if (!c) return;
  el.hidden = false;
  el.innerHTML = `<code>${esc(short(c))}</code><button type="button" data-copy="${esc(c)}">copy</button><a href="https://pump.fun/coin/${esc(c)}" target="_blank" rel="noopener">buy ↗</a><a href="https://dexscreener.com/solana/${esc(c)}" target="_blank" rel="noopener">chart ↗</a>${x ? `<a href="${esc(x)}" target="_blank" rel="noopener">x ↗</a>` : ''}`;
}

export function start(ctx = {}) {
  CTX = ctx;
  launch(); join(); ping(); ownersInit(); ca();
  board(true); setInterval(() => { if (!document.hidden) board(true); }, 30000);
  // one click handler for every data-* action on the page
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-open],[data-join],[data-copy],[data-rent],#sheetX,#bdRetry'); if (!t) return;
    if (t.id === 'sheetX') return closeSheet();
    if (t.id === 'bdRetry') return board(true);
    if (t.dataset.copy) return copy(t.dataset.copy);
    if (t.dataset.rent) return payRent(t.dataset.rent, t);
    if (t.dataset.join) {
      e.preventDefault(); if (sheet.open) closeSheet();
      const s = $('#jCoin'); if (![...s.options].some(o => o.value === t.dataset.join)) { s.value = 'paste'; $('#jMint').value = t.dataset.join; $('.jmint').hidden = false; } else { s.value = t.dataset.join; $('.jmint').hidden = true; }
      const go = () => $('#jName').focus({ preventScroll: true });
      if (CTX.lenis) CTX.lenis.scrollTo('#join', { offset: -58, duration: 1.2, onComplete: go }); else { $('#join').scrollIntoView({ behavior: 'smooth' }); setTimeout(go, 700); }
      return;
    }
    if (t.dataset.open) { e.preventDefault(); openCoin(t.dataset.open); }
  });
  document.addEventListener('keydown', e => { const t = e.target.closest && e.target.closest('.brow'); if (t && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCoin(t.dataset.open); } });
  sheet.addEventListener('close', () => { CTX.lenis && CTX.lenis.start(); if (location.pathname.startsWith('/s/')) history.replaceState(null, '', '/'); });
  sheet.addEventListener('click', e => { if (e.target === sheet) closeSheet(); });
  // a shared coin link: /s/<mint>
  const m = location.pathname.match(/^\/s\/([1-9A-HJ-NP-Za-km-z]{32,44})$/);
  if (m) setTimeout(() => openCoin(m[1], false), document.body.classList.contains('ready') ? 0 : 3800);
}
