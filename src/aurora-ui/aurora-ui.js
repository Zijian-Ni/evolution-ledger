/**
 * Aurora UI behaviours — the small amount of JS the design system needs.
 * Zero dependencies, framework-agnostic, safe to call twice.
 */

/* ───────────────────────────── theme ───────────────────────────── */

const THEME_KEY = 'aurora-theme';
const THEMES = ['dark', 'light', 'auto'];

export function getTheme() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return THEMES.includes(v) ? v : 'dark';
  } catch {
    return 'dark';
  }
}

export function applyTheme(theme = getTheme()) {
  const resolved =
    theme === 'auto'
      ? matchMedia('(prefers-color-scheme: light)').matches
        ? 'light'
        : 'dark'
      : theme;
  document.documentElement.setAttribute('data-theme', resolved);
  document.documentElement.setAttribute('data-theme-pref', theme);
  try { localStorage.setItem(THEME_KEY, theme); } catch { /* private mode */ }
  return resolved;
}

/** Wire a dark → light → auto cycling button. */
export function initTheme(buttonSelector = '[data-aurora-theme-toggle]') {
  applyTheme();
  const label = { dark: '🌙', light: '☀️', auto: '🌗' };
  const btns = document.querySelectorAll(buttonSelector);
  const sync = () => {
    const pref = getTheme();
    btns.forEach((b) => {
      b.textContent = label[pref];
      b.setAttribute('aria-label', `Theme: ${pref}. Click to change.`);
      b.title = `Theme: ${pref}`;
    });
  };
  btns.forEach((b) =>
    b.addEventListener('click', () => {
      const next = THEMES[(THEMES.indexOf(getTheme()) + 1) % THEMES.length];
      applyTheme(next);
      sync();
    }),
  );
  matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => {
    if (getTheme() === 'auto') applyTheme('auto');
  });
  sync();
}

/* ───────────────────────────── tilt ─────────────────────────────
   ≤3° each axis. Beyond that it reads as a cheap gimmick rather than
   a precision instrument. Pointer devices only.
   ──────────────────────────────────────────────────────────────── */

export function attachTilt(root = document, selector = '.plug-card') {
  if (typeof matchMedia !== 'function') return;
  if (matchMedia('(hover: none), (prefers-reduced-motion: reduce)').matches) return;

  root.querySelectorAll(selector).forEach((card) => {
    if (card.dataset.tiltBound === '1') return;
    card.dataset.tiltBound = '1';

    let frame = 0;
    const onMove = (e) => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        const r = card.getBoundingClientRect();
        const ty = ((e.clientX - r.left) / r.width - 0.5) * 6;
        const tx = (0.5 - (e.clientY - r.top) / r.height) * 6;
        card.style.setProperty('--ty', `${ty.toFixed(2)}deg`);
        card.style.setProperty('--tx', `${tx.toFixed(2)}deg`);
      });
    };
    const reset = () => {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      card.style.setProperty('--tx', '0deg');
      card.style.setProperty('--ty', '0deg');
    };
    card.addEventListener('pointermove', onMove);
    card.addEventListener('pointerleave', reset);
    card.addEventListener('blur', reset, true);
  });
}

/* ───────────────────────────── command palette ─────────────────────────────
   ⌘K / Ctrl-K. No library. Fully keyboard operable: ↑ ↓ Enter Esc.
   ─────────────────────────────────────────────────────────────────────────── */

/**
 * @typedef {{ id: string, label: string, hint?: string, group?: string,
 *             when?: () => boolean, run: () => void }} Command
 */

export class CommandPalette {
  /** @param {Command[]} commands */
  constructor(commands = [], opts = {}) {
    this.commands = commands;
    this.placeholder = opts.placeholder ?? 'Type a command…';
    this.index = 0;
    this.filtered = [];
    this.el = null;
    this._onKeydown = this._onKeydown.bind(this);
  }

  register(cmd) {
    this.commands = this.commands.filter((c) => c.id !== cmd.id).concat(cmd);
    return this;
  }

  mount() {
    if (this.el) return this;
    const host = document.createElement('div');
    host.className = 'palette-scrim';
    host.hidden = true;
    host.innerHTML = `
      <div class="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input class="palette__input" type="text" role="combobox" aria-expanded="true"
               aria-controls="aurora-palette-list" aria-autocomplete="list"
               placeholder="${escapeHtml(this.placeholder)}" />
        <ul class="palette__list" id="aurora-palette-list" role="listbox"></ul>
        <div class="palette__foot">
          <span><span class="kbd">↑</span><span class="kbd">↓</span> navigate</span>
          <span><span class="kbd">↵</span> run</span>
          <span><span class="kbd">esc</span> close</span>
        </div>
      </div>`;
    document.body.appendChild(host);

    this.el = host;
    this.input = host.querySelector('.palette__input');
    this.list = host.querySelector('.palette__list');

    host.addEventListener('click', (e) => { if (e.target === host) this.close(); });
    this.input.addEventListener('input', () => { this.index = 0; this._render(); });
    this.input.addEventListener('keydown', (e) => this._onInputKey(e));
    document.addEventListener('keydown', this._onKeydown);
    return this;
  }

  _onKeydown(e) {
    const isToggle = (e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k';
    if (isToggle) {
      e.preventDefault();
      this.el.hidden ? this.open() : this.close();
    } else if (e.key === 'Escape' && !this.el.hidden) {
      this.close();
    }
  }

  _onInputKey(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); this.index = Math.min(this.index + 1, this.filtered.length - 1); this._render(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); this.index = Math.max(this.index - 1, 0); this._render(); }
    else if (e.key === 'Enter') { e.preventDefault(); this._runSelected(); }
    else if (e.key === 'Home') { e.preventDefault(); this.index = 0; this._render(); }
    else if (e.key === 'End') { e.preventDefault(); this.index = this.filtered.length - 1; this._render(); }
  }

  _runSelected() {
    const cmd = this.filtered[this.index];
    if (!cmd) return;
    this.close();
    try { cmd.run(); } catch (err) { console.error('[palette]', cmd.id, err); }
  }

  open() {
    this.mount();
    this.prevFocus = document.activeElement;
    this.el.hidden = false;
    this.input.value = '';
    this.index = 0;
    this._render();
    this.input.focus();
  }

  close() {
    if (!this.el || this.el.hidden) return;
    this.el.hidden = true;
    if (this.prevFocus?.focus) this.prevFocus.focus();
  }

  destroy() {
    document.removeEventListener('keydown', this._onKeydown);
    this.el?.remove();
    this.el = null;
  }

  _render() {
    const q = (this.input.value || '').trim().toLowerCase();
    const available = this.commands.filter((c) => (c.when ? safeBool(c.when) : true));
    this.filtered = q
      ? available
          .map((c) => ({ c, s: fuzzyScore(`${c.group ?? ''} ${c.label}`.toLowerCase(), q) }))
          .filter((x) => x.s > 0)
          .sort((a, b) => b.s - a.s)
          .map((x) => x.c)
      : available;

    this.index = Math.max(0, Math.min(this.index, this.filtered.length - 1));

    if (!this.filtered.length) {
      this.list.innerHTML = `<li class="palette__empty">No matching command</li>`;
      return;
    }
    this.list.innerHTML = this.filtered
      .map(
        (c, i) => `<li class="palette__item" role="option" data-i="${i}"
             aria-selected="${i === this.index}" id="aurora-palette-opt-${i}">
          ${c.group ? `<span class="chip chip--ghost">${escapeHtml(c.group)}</span>` : ''}
          <span>${escapeHtml(c.label)}</span>
          ${c.hint ? `<span class="hint">${escapeHtml(c.hint)}</span>` : ''}
        </li>`,
      )
      .join('');

    this.input.setAttribute('aria-activedescendant', `aurora-palette-opt-${this.index}`);
    this.list.querySelectorAll('.palette__item').forEach((li) => {
      li.addEventListener('mouseenter', () => { this.index = Number(li.dataset.i); this._render(); });
      li.addEventListener('click', () => { this.index = Number(li.dataset.i); this._runSelected(); });
    });
    this.list.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }
}

/** Subsequence match with a bonus for prefix hits. 0 means "no match". */
export function fuzzyScore(text, query) {
  if (!query) return 1;
  if (text.includes(query)) return 100 + (text.startsWith(query) ? 50 : 0);
  let ti = 0, score = 0;
  for (const ch of query) {
    const found = text.indexOf(ch, ti);
    if (found === -1) return 0;
    score += found === ti ? 2 : 1;
    ti = found + 1;
  }
  return score;
}

const safeBool = (fn) => { try { return !!fn(); } catch { return false; } };

/* ───────────────────────────── toasts ───────────────────────────── */

export function toast(message, kind = 'info', ms = 3200) {
  let host = document.querySelector('.toast-host');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toast-host';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = `toast toast--${kind}`;
  el.textContent = message;
  host.appendChild(el);
  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transition = 'opacity 200ms';
    setTimeout(() => el.remove(), 220);
  }, ms);
  return el;
}

/* ───────────────────────────── small helpers ───────────────────────────── */

export function escapeHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

/** Format a number for a `.readout`: compact but never lying about precision. */
export function readout(value, unit = '') {
  if (value == null || Number.isNaN(value)) return `—${unit ? ` <small>${unit}</small>` : ''}`;
  const n = Number(value);
  const s =
    Math.abs(n) >= 1e9 ? `${(n / 1e9).toFixed(1)}B`
    : Math.abs(n) >= 1e6 ? `${(n / 1e6).toFixed(1)}M`
    : Math.abs(n) >= 1e4 ? `${(n / 1e3).toFixed(1)}k`
    : Number.isInteger(n) ? String(n)
    : n.toFixed(2);
  return unit ? `${s}<small>${unit}</small>` : s;
}

export function formatDuration(ms) {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const m = Math.floor(ms / 60_000);
  const s = Math.round((ms % 60_000) / 1000);
  return `${m}m ${s}s`;
}

/** Enforce the one-ring rule at runtime so drift gets caught in dev. */
export function assertSingleRing() {
  const n = document.querySelectorAll('.aurora-ring').length;
  if (n > 1) console.warn(`[aurora-ui] ${n} .aurora-ring elements on screen — the focus rule allows exactly one.`);
  return n;
}

/** One call to wire up the standard behaviours. */
export function initAuroraUI(opts = {}) {
  initTheme(opts.themeToggle);
  attachTilt(document, opts.tiltSelector);
  const palette = opts.commands ? new CommandPalette(opts.commands, opts).mount() : null;
  if (opts.dev !== false && location.hostname === 'localhost') {
    setTimeout(assertSingleRing, 800);
  }
  return { palette };
}
