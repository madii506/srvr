// srvr boot: two eyes in the dark while the 3D world loads. Then they fall asleep and wait: "enter" wakes them, starts
// the calm music (browsers only allow sound after a click) and the intro. After that one scroll drives everything:
// smooth (inertia) scrolling, the camera's path through the world, the pinned "how it works" steps, the hero's parallax
// and the veil that dims the world behind the tools.
const body = document.body, root = document.documentElement, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('world'), enterBtn = document.getElementById('enter');
const keep = (st => ({ get: k => { try { return st().getItem(k); } catch { return null; } }, set: (k, v) => { try { st().setItem(k, v); } catch {} } }));
const local = keep(() => localStorage), sess = keep(() => sessionStorage);
// no gate and no intro on a shared coin link, a section link, a repeat visit in this tab, or with reduced motion
const quick = reduced || /^\/s\//.test(location.pathname) || location.hash.length > 1 || sess.get('srvr:in') === '1' || new URLSearchParams(location.search).has('skip');
let world = null, fell = false, ready = false, started = false;
const text = () => body.classList.add('text');
const done = () => { text(); body.classList.remove('intro', 'boot', 'gate'); body.classList.add('ready'); };
function fallback() {
  if (fell) return; fell = true; started = true;
  canvas.hidden = true; document.querySelector('.stage .still').hidden = false;
  body.classList.remove('boot', 'gate'); body.classList.add('intro'); setTimeout(text, 80); setTimeout(done, 900);
}
function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }

// ---------------------------------------------------------------- calm music, on by default once you enter; the corner switch mutes it
const music = document.getElementById('music'), snd = document.getElementById('snd');
let soundOn = local.get('srvr:sound') !== 'off', fadeRaf = 0;
function fadeTo(v, ms, then) {
  cancelAnimationFrame(fadeRaf); const v0 = music.volume, t0 = performance.now();
  const f = now => { const k = Math.min(1, (now - t0) / ms); music.volume = Math.max(0, Math.min(1, v0 + (v - v0) * k)); if (k < 1) fadeRaf = requestAnimationFrame(f); else if (then) then(); };
  fadeRaf = requestAnimationFrame(f);
}
const showSnd = on => { snd.classList.toggle('on', on); snd.setAttribute('aria-pressed', String(on)); snd.setAttribute('aria-label', on ? 'sound off' : 'sound on'); };
function playMusic(ms = 2600) { try { music.volume = 0; const p = music.play(); showSnd(true); if (p && p.catch) p.catch(() => showSnd(false)); fadeTo(0.5, ms); } catch { showSnd(false); } }
snd.addEventListener('click', () => {
  const on = music.paused || music.volume < 0.05;
  local.set('srvr:sound', on ? 'on' : 'off'); soundOn = on;
  if (on) playMusic(1200); else { showSnd(false); fadeTo(0, 600, () => music.pause()); }
});

// ---------------------------------------------------------------- the gate
function enter() {
  if (started || !ready) return; started = true; sess.set('srvr:in', '1');
  if (soundOn) playMusic();
  body.classList.add('woke');
  setTimeout(() => { body.classList.remove('boot', 'gate'); body.classList.add('intro'); if (world) world.go(); }, 420);
  setTimeout(done, 17000);
}
enterBtn.addEventListener('click', enter);
addEventListener('keydown', e => { if (!started && ready && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); enter(); } });

if (webgl()) {
  import('./world.js').then(m => {
    world = m.mountWorld(canvas, {
      reduced, wait: !quick,
      onReady: () => { ready = true; if (!quick) { body.classList.add('gate'); enterBtn.hidden = false; try { enterBtn.focus({ preventScroll: true }); } catch {} } },
      onText: text, onDone: done,
    });
    window.__world = world; startTick();
    if (quick) { started = true; body.classList.remove('boot'); body.classList.add('intro'); world.skip(); if (reduced) done(); }
  }).catch(e => { console.warn('world', e); fallback(); });
} else fallback();
// backstop: if the world never loads, open the page anyway
setTimeout(() => { if (!ready && !fell) fallback(); }, 9000);

// ---------------------------------------------------------------- smooth scroll
let lenis = null;
function startLenis() {
  if (reduced || !window.Lenis || lenis) return;
  lenis = new window.Lenis({ lerp: 0.085, wheelMultiplier: 0.95, touchMultiplier: 1.4, smoothWheel: true });
  window.__lenis = lenis;
}
if (window.Lenis) startLenis(); else addEventListener('DOMContentLoaded', startLenis);
addEventListener('load', startLenis);
// in-page links glide there
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[href^="#"]'); if (!a) return;
  const id = a.getAttribute('href'); const el = id.length > 1 && document.querySelector(id); if (!el) return;
  e.preventDefault();
  const off = id === '#how' ? 0 : -58;
  if (lenis) lenis.scrollTo(el, { offset: off, duration: 1.6, easing: t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2) });
  else window.scrollTo({ top: el.getBoundingClientRect().top + scrollY + off, behavior: reduced ? 'auto' : 'smooth' });
  history.replaceState(null, '', id);
});

// ---------------------------------------------------------------- one scroll, many things
const nav = document.querySelector('.nav'), links = [...nav.querySelectorAll('a')];
const heroIn = document.querySelector('.hero-in'), veil = document.getElementById('veil');
const how = document.getElementById('how'), steps = [...document.querySelectorAll('#hSteps li')], bar = document.getElementById('hBar'), count = document.getElementById('hCount');
const prog = document.getElementById('prog');
// the cursor: a small block that follows, looks where it's heading, and grows on things you can press (mouse only)
let cur = null, curEyes = null, cx = -100, cy = -100, ctx = -100, cty = -100, cdown = false, cblink = 0;
if (matchMedia('(pointer: fine)').matches && !reduced) {
  cur = document.getElementById('cur'); curEyes = cur.querySelectorAll('i'); root.classList.add('cur-on');
  addEventListener('pointermove', e => {
    ctx = e.clientX; cty = e.clientY; if (cx < -50) { cx = ctx; cy = cty; }
    const t = e.target, txt = t.closest && t.closest('input,textarea');
    cur.classList.toggle('text', !!txt);
    cur.classList.toggle('hot', !txt && !!((t.closest && t.closest('a,button,summary,select,.brow,.pic,[role=button],[data-open]')) || root.classList.contains('over-block')));
    cur.classList.remove('away');
  }, { passive: true });
  addEventListener('pointerdown', () => { cdown = true; }); addEventListener('pointerup', () => { cdown = false; });
  document.documentElement.addEventListener('mouseleave', () => cur.classList.add('away'));
}
// buttons lean toward the cursor
if (matchMedia('(pointer: fine)').matches && !reduced) {
  document.addEventListener('pointermove', e => {
    const b = e.target.closest && e.target.closest('.cta .btn, .btn.pri, .chips button');
    document.querySelectorAll('.btn.mag').forEach(x => { if (x !== b) { x.classList.remove('mag'); x.style.transform = ''; } });
    if (!b || b.disabled) return;
    const r = b.getBoundingClientRect(), dx = e.clientX - (r.left + r.width / 2), dy = e.clientY - (r.top + r.height / 2);
    b.classList.add('mag'); b.style.transform = `translate(${(dx * 0.18).toFixed(1)}px,${(dy * 0.28).toFixed(1)}px)`;
  }, { passive: true });
}
// labels decode as they arrive
const GLY = 'abcdefghijklmnopqrstuvwxyz0123456789/._';
function scramble(el) {
  const node = [...el.childNodes].find(n => n.nodeType === 3 && n.textContent.trim()); if (!node || el.dataset.sc) return; el.dataset.sc = 1;
  const full = node.textContent, n = full.length, t0 = performance.now(), D = 700;
  const step = now => { const p = Math.min(1, (now - t0) / D), k = Math.floor(p * n);
    node.textContent = full.slice(0, k) + full.slice(k).replace(/[^\s—]/g, () => GLY[(Math.random() * GLY.length) | 0]);
    if (p < 1) requestAnimationFrame(step); else node.textContent = full; };
  requestAnimationFrame(step);
}
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
let lastY = scrollY, vel = 0, lastT = performance.now(), stepOn = 0, ticking = false;
function startTick() { if (ticking) return; ticking = true; requestAnimationFrame(tick); }
function tick(now = performance.now()) {
  if (lenis) lenis.raf(now);
  const y = lenis ? lenis.scroll : scrollY, H = innerHeight, dt = Math.min(0.05, (now - lastT) / 1000) || 0.016; lastT = now;
  vel += ((y - lastY) / Math.max(dt, 0.001) - vel) * 0.15; lastY = y;
  const howTop = how.getBoundingClientRect().top + scrollY, howH = how.offsetHeight;
  const heroP = cl(y / Math.max(1, howTop)), howP = cl((y - howTop) / Math.max(1, howH - H)), afterP = cl((y - (howTop + howH - H)) / (H * 0.9));
  const howF = y < howTop ? 0 : howP * 4;
  if (world) world.setScroll({ heroP, howF: y < howTop ? 0 : Math.max(0.0011, howF), afterP });
  // hero copy drifts up and fades as the camera moves in
  heroIn.style.setProperty('--py', (-y * 0.32).toFixed(1) + 'px'); heroIn.style.setProperty('--po', cl(1 - y / (H * 0.6)).toFixed(3));
  // the veil: the world stays bright for the story, then dims behind the tools
  veil.style.opacity = (0.84 * afterP).toFixed(3);
  // how it works: which step, and how far along
  const i = Math.min(3, Math.floor(howP * 4 + 0.0001));
  if (i !== stepOn) { stepOn = i; steps.forEach((li, k) => li.classList.toggle('on', k === i)); count.textContent = `0${i + 1} / 04`; }
  bar.style.transform = `scaleX(${howP.toFixed(4)})`;
  nav.classList.toggle('solid', y > 40);
  prog.style.transform = `scaleX(${cl(y / Math.max(1, document.documentElement.scrollHeight - H)).toFixed(4)})`;
  if (cur) { cx += (ctx - cx) * 0.24; cy += (cty - cy) * 0.24; const vx = cl((ctx - cx) / 40, -1, 1), vy = cl((cty - cy) / 40, -1, 1);
    cur.style.transform = `translate3d(${cx.toFixed(1)}px,${cy.toFixed(1)}px,0) scale(${cdown ? 0.82 : 1})`;
    if (curEyes) { curEyes[0].style.transform = curEyes[1].style.transform = `translate(${(vx * 2.2).toFixed(2)}px,${(vy * 2).toFixed(2)}px)`; }
    if (now > cblink) { cur.classList.add('blink'); setTimeout(() => cur.classList.remove('blink'), 110); cblink = now + 2400 + Math.random() * 3500; } }
  requestAnimationFrame(tick);
}
startTick();

// how it works: click a step to fly to it
steps.forEach((li, i) => {
  li.tabIndex = 0; li.setAttribute('role', 'button');
  const goStep = () => { const top = how.getBoundingClientRect().top + scrollY, y = top + (how.offsetHeight - innerHeight) * ((i + 0.5) / 4); if (lenis) lenis.scrollTo(y, { duration: 1.3 }); else scrollTo({ top: y, behavior: 'smooth' }); };
  li.addEventListener('click', goStep); li.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); goStep(); } });
});
// every block glyph on the page looks at your cursor; cards tilt toward it
if (matchMedia('(pointer: fine)').matches && !reduced) {
  let gx = 0, gy = 0, gq = false;
  addEventListener('pointermove', e => {
    gx = e.clientX; gy = e.clientY; if (gq) return; gq = true;
    requestAnimationFrame(() => {
      gq = false;
      for (const g of document.querySelectorAll('.gl')) {
        const r = g.getBoundingClientRect(); if (!r.width || r.bottom < 0 || r.top > innerHeight) continue;
        const dx = gx - (r.left + r.width / 2), dy = gy - (r.top + r.height / 2), d = Math.hypot(dx, dy) || 1, k = Math.min(1, d / 140) * r.width * 0.075;
        g.style.setProperty('--gx', (dx / d * k).toFixed(2) + 'px'); g.style.setProperty('--gy', (dy / d * k * 0.8).toFixed(2) + 'px');
      }
    });
  }, { passive: true });
  document.addEventListener('pointermove', e => {
    const c = e.target.closest && e.target.closest('.pv, .pcard, .ownbox');
    document.querySelectorAll('.tilting').forEach(x => { if (x !== c) { x.classList.remove('tilting'); x.style.removeProperty('--rx'); x.style.removeProperty('--ry'); } });
    if (!c) return; const r = c.getBoundingClientRect(), px = (e.clientX - r.left) / r.width - 0.5, py = (e.clientY - r.top) / r.height - 0.5;
    c.classList.add('tilting'); c.style.setProperty('--rx', (-py * 5).toFixed(2) + 'deg'); c.style.setProperty('--ry', (px * 7).toFixed(2) + 'deg');
  }, { passive: true });
}

// the current section, underlined in the nav
const secs = links.map(a => document.querySelector(a.getAttribute('href'))).filter(Boolean);
const io = new IntersectionObserver(es => {
  for (const e of es) if (e.isIntersecting) links.forEach(a => a.classList.toggle('on', a.getAttribute('href') === '#' + e.target.id));
}, { rootMargin: '-45% 0px -50% 0px' });
secs.forEach(s => io.observe(s));

// headings rise in word by word; blocks ease in as they arrive
for (const h of document.querySelectorAll('h2')) {
  const words = h.textContent.trim().split(/\s+/);
  h.innerHTML = words.map((w, i) => `<span class="wd"><span style="transition-delay:${(i * 0.045).toFixed(3)}s">${w.replace(/&/g, '&amp;').replace(/</g, '&lt;')}</span></span>`).join(' ');
  h.setAttribute('aria-label', words.join(' '));
}
const rv = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); if (e.target.matches('.eb') && !reduced) scramble(e.target); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('h2').forEach(h => { h.classList.add('reveal'); rv.observe(h); });
document.querySelectorAll('.band .eb, .launch, .board, .join, .pingf, .chips, .own, .faq details, .how .eb, .hsteps, .hbar, .how .legend').forEach((el, i) => {
  el.classList.add('reveal'); if (el.matches('.faq details')) el.style.transitionDelay = ((i % 10) * 0.05) + 's'; rv.observe(el);
});

import('./app.js').then(m => m.start({ get lenis() { return lenis; } })).catch(e => console.error('app', e));
