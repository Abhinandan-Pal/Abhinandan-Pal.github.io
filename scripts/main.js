// scripts/main.js
//
// Module entry orchestrator. On DOMContentLoaded, hydrates the document
// and installs every progressive enhancement in the documented order:
// reveal → parallax → magnetic → kinetic → nav → transitions. The motif
// is deferred behind requestIdleCallback so it never competes with the
// hero entrance choreography for the main thread.
//

/* global __AP_BUILD_DATE__ */

import { content } from './data.js';
import { hydrate } from './render.js';
import { installReveal } from './reveal.js';
import { installMagnetic } from './magnetic.js';
import { installSpotlight } from './spotlight.js';
import { installKineticHeading } from './kinetic-heading.js';
import { installNav } from './nav.js';
import { installTransitions } from './transitions.js';

// Build constant — replaced at build time, falls through to today's date.
const BUILD_DATE = (typeof __AP_BUILD_DATE__ !== 'undefined')
  ? __AP_BUILD_DATE__
  : new Date().toISOString().slice(0, 10);

function boot() {
  // Hydrate from data.js (removes empty sections, wires reveal indices,
  // replaces meta tokens). Runs before any IO installs so observers
  // never bind to soon-to-be-removed nodes.
  hydrate(content, { buildDate: BUILD_DATE });

  // Toggle hero is-loaded class so the entrance choreography in
  // motion.css plays.
  const hero = document.querySelector('.ap-hero');
  if (hero) hero.classList.add('is-loaded');

  // Install enhancements in the documented order.
  installReveal();
  installMagnetic();
  installSpotlight();
  installKineticHeading();
  installNav();
  installTransitions();

  // Install parallax + motif (canvas is now a fixed full-page background).
  const canvas = document.querySelector('canvas[data-motif]');
  if (canvas) {
    deferMotif(canvas);
  }
}

function deferMotif(canvas) {
  const start = () => {
    import('./motif/runtime.js').then(({ installMotif }) => {
      installMotif(canvas);
    }).catch(err => {
      // eslint-disable-next-line no-console
      console.warn('[motif] failed to install:', err);
    });
  };
  if (typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(start, { timeout: 2000 });
  } else {
    setTimeout(start, 200);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
  boot();
}
