/* AURORA SKIN · Theme B「链墨 / Ledger Ink」 — evolution-ledger effects
   Injects the paper-fiber grain layer and the cinnabar seal under the hero.
   Additive only; retries after the app renders. */

function mountGrain() {
  if (document.querySelector('.ink-grain')) return;
  const g = document.createElement('div');
  g.className = 'ink-grain';
  g.setAttribute('aria-hidden', 'true');
  document.body.prepend(g);
}

function mountSeal() {
  if (document.querySelector('.ink-seal')) return true;
  const hero = document.querySelector('.hero');
  if (!hero) return false;
  const seal = document.createElement('div');
  seal.className = 'ink-seal';
  seal.setAttribute('aria-hidden', 'true');
  seal.textContent = '存证';
  const cap = document.createElement('span');
  cap.className = 'ink-seal-cap';
  cap.textContent = 'append-only · hash-chained · verified';
  hero.appendChild(seal);
  hero.appendChild(cap);
  return true;
}

function boot() {
  mountGrain();
  if (mountSeal()) return;
  /* hero is rendered by ui.js — wait for it */
  const app = document.getElementById('app');
  if (app && 'MutationObserver' in window) {
    const mo = new MutationObserver(() => {
      if (mountSeal()) mo.disconnect();
    });
    mo.observe(app, { childList: true, subtree: true });
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
