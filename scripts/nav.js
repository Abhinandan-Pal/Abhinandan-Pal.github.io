// scripts/nav.js
//
// Navigation: fix-on-scroll, smooth scroll, scroll-spy, and hamburger overlay.
//

const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
const DESKTOP_MQ = '(min-width: 860px)';
const SMOOTH_SCROLL_MS = 600;
const SCROLLSPY_ROOT_MARGIN = '-40% 0px -40% 0px';

function smoothScrollTo(targetEl, durationMs) {
  return new Promise((resolve) => {
    const startY = window.scrollY;
    const targetY = targetEl.getBoundingClientRect().top + startY;
    const distance = targetY - startY;
    const startTime = performance.now();
    function step(now) {
      const elapsed = now - startTime;
      const t = Math.min(1, elapsed / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      window.scrollTo(0, startY + distance * eased);
      if (t < 1) window.requestAnimationFrame(step);
      else resolve();
    }
    window.requestAnimationFrame(step);
  });
}

function installFixOnScroll(nav) {
  const sentinel = document.querySelector('[data-nav-sentinel]');
  if (!sentinel) return () => {};
  if (typeof window.IntersectionObserver !== 'function') return () => {};
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      // sentinel out of viewport (above) → stuck
      if (e.boundingClientRect.top < 0) nav.setAttribute('data-stuck', '');
      else nav.removeAttribute('data-stuck');
    }
  }, { threshold: 0 });
  io.observe(sentinel);
  return () => io.disconnect();
}

function installSmoothScroll(reducedMotionMq) {
  const handlers = [];
  const links = document.querySelectorAll('a[href^="#"]');
  for (const a of links) {
    const handler = (e) => {
      const href = a.getAttribute('href');
      if (!href || !href.startsWith('#') || href === '#') return;
      const id = href.slice(1);
      const target = document.getElementById(id);
      if (!target) return;
      e.preventDefault();
      // Close overlay if a link click happened inside it
      const overlay = document.getElementById('ap-overlay');
      if (overlay && overlay.open) overlay.close();
      if (reducedMotionMq.matches) {
        target.scrollIntoView({ behavior: 'auto', block: 'start' });
      } else {
        const distance = Math.abs(target.getBoundingClientRect().top);
        if (distance > 4000) {
          smoothScrollTo(target, SMOOTH_SCROLL_MS);
        } else {
          target.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }
      // Update URL hash without reloading
      history.replaceState(null, '', href);
    };
    a.addEventListener('click', handler);
    handlers.push({ el: a, handler });
  }
  return () => {
    for (const { el, handler } of handlers) el.removeEventListener('click', handler);
  };
}

function installHamburger(desktopMq) {
  const toggle = document.querySelector('[data-nav-toggle]');
  const overlay = document.getElementById('ap-overlay');
  if (!toggle || !overlay) return () => {};

  const open = () => {
    if (typeof overlay.showModal === 'function') overlay.showModal();
    else overlay.setAttribute('open', '');
    toggle.setAttribute('aria-expanded', 'true');
  };
  const close = () => {
    if (typeof overlay.close === 'function') overlay.close();
    else overlay.removeAttribute('open');
    toggle.setAttribute('aria-expanded', 'false');
  };
  const onToggle = () => {
    if (overlay.hasAttribute('open') || overlay.open) close();
    else open();
  };
  const onMqChange = () => {
    if (desktopMq.matches && (overlay.hasAttribute('open') || overlay.open)) close();
  };
  const onClose = () => {
    toggle.setAttribute('aria-expanded', 'false');
  };

  toggle.addEventListener('click', onToggle);
  desktopMq.addEventListener('change', onMqChange);
  overlay.addEventListener('close', onClose);

  return () => {
    toggle.removeEventListener('click', onToggle);
    desktopMq.removeEventListener('change', onMqChange);
    overlay.removeEventListener('close', onClose);
  };
}

function installScrollSpy() {
  const sections = document.querySelectorAll('main section[id]');
  if (!sections.length) return () => {};
  if (typeof window.IntersectionObserver !== 'function') return () => {};
  const setActive = (sectionId) => {
    document.querySelectorAll('a[href^="#"]').forEach(a => {
      const href = a.getAttribute('href');
      if (href === `#${sectionId}`) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
    });
  };
  let bestRatio = 0;
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio > bestRatio) {
        bestRatio = e.intersectionRatio;
      }
    }
    // After processing, find the target with the highest ratio
    let best = null;
    let bestSeen = 0;
    for (const s of sections) {
      const rect = s.getBoundingClientRect();
      const visible = Math.max(0, Math.min(rect.bottom, window.innerHeight * 0.6) - Math.max(rect.top, window.innerHeight * 0.4));
      if (visible > bestSeen) { best = s.id; bestSeen = visible; }
    }
    if (best) setActive(best);
  }, { rootMargin: SCROLLSPY_ROOT_MARGIN, threshold: 0 });
  for (const s of sections) io.observe(s);
  return () => io.disconnect();
}

export function installNav() {
  const nav = document.querySelector('nav.ap-nav, [data-nav]');
  if (!nav) return () => {};
  const reducedMotionMq = window.matchMedia(REDUCED_MOTION);
  const desktopMq = window.matchMedia(DESKTOP_MQ);

  const teardowns = [
    installFixOnScroll(nav),
    installSmoothScroll(reducedMotionMq),
    installHamburger(desktopMq),
    installScrollSpy(),
  ];

  return () => {
    for (const t of teardowns) t();
  };
}
