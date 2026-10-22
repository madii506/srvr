// srvr boot: two eyes in the dark until the 3D world is ready, then the intro plays and the page opens.
// After that one scroll drives everything: smooth (inertia) scrolling, the camera's path through the world, the pinned
// "how it works" steps, the marquee's speed, the hero's parallax and the veil that dims the world behind the tools.
const body = document.body, root = document.documentElement, reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const canvas = document.getElementById('world');
let world = null, fell = false;
const text = () => body.classList.add('text');
const done = () => { text(); body.classList.remove('intro', 'boot'); body.classList.add('ready'); };
function fallback() {
  if (fell) return; fell = true;
  canvas.hidden = true; document.querySelector('.stage .still').hidden = false;
  body.classList.remove('boot'); body.classList.add('intro'); setTimeout(text, 80); setTimeout(done, 900);
}
function webgl() { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch { return false; } }
if (webgl()) {
  import('./world.js').then(m => {
    world = m.mountWorld(canvas, {
      reduced,
      onReady: () => { body.classList.remove('boot'); body.classList.add('intro'); if (reduced) done(); },
      onText: text, onDone: done,
    });
    window.__world = world; startTick();
  }).catch(e => { console.warn('world', e); fallback(); });
} else fallback();
// backstops: the page never stays dark
setTimeout(() => { if (body.classList.contains('boot')) fallback(); }, 7000);
setTimeout(done, 9000);

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
const mq = document.getElementById('mq');
const cl = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
let mqX = 0, lastY = scrollY, vel = 0, lastT = performance.now(), stepOn = 0, ticking = false;
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
  // the marquee: always drifting, faster (and the other way) when you scroll
  if (mq) { const w = mq.firstElementChild.offsetWidth || 1; mqX -= (40 + Math.abs(vel) * 0.35) * dt * (vel < -5 ? -1 : 1); mqX = ((mqX % w) - w) % w; mq.style.transform = `translate3d(${mqX.toFixed(1)}px,0,0)`; }
  nav.classList.toggle('solid', y > 40);
  requestAnimationFrame(tick);
}
startTick();

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
const rv = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('vis'); rv.unobserve(e.target); } }), { rootMargin: '0px 0px -10% 0px' });
document.querySelectorAll('h2').forEach(h => { h.classList.add('reveal'); rv.observe(h); });
document.querySelectorAll('.band .eb, .launch, .board, .join, .pingf, .chips, .own, .faq details, .how .eb, .hsteps, .hbar, .how .legend').forEach((el, i) => {
  el.classList.add('reveal'); if (el.matches('.faq details')) el.style.transitionDelay = ((i % 10) * 0.05) + 's'; rv.observe(el);
});

import('./app.js').then(m => m.start({ get lenis() { return lenis; } })).catch(e => console.error('app', e));
