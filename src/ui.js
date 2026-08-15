import './style.css';
import { Ledger, formatMarkdown } from './core.js';
import { t, STRINGS } from './i18n.js';

const state = {
  lang: localStorage.getItem('el_lang') || 'en',
  ledger: null,
  filter: 'all',
  query: '',
  selected: null,
};

const ICONS = {
  hypothesis: '💡', change: '🔧', eval: '📊', decision: '⚖️', rollback: '↩️', note: '📝',
};

const app = document.getElementById('app');

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function rolledBackSet() {
  if (!state.ledger) return new Set();
  return new Set(
    state.ledger.entries.filter(e => e.type === 'rollback' && e.rollbackOf).map(e => e.rollbackOf)
  );
}

function render() {
  const L = state.ledger;
  const stats = L ? L.stats() : null;
  const verify = L ? L.verify() : null;
  const lang = state.lang;

  app.innerHTML = `
  <header class="topbar"><div class="wrap topbar-inner">
    <div class="brand">
      <div class="brand-mark">🎀</div>
      <div>Evolution Ledger<small>Aurora · append-only</small></div>
    </div>
    <div class="top-actions">
      <button class="btn btn--ghost" id="langBtn">${lang === 'en' ? '🇨🇳 中文' : '🇬🇧 EN'}</button>
      <button class="btn" id="verifyBtn">🔐 ${t(lang, 'verify')}</button>
      <button class="btn" id="exportBtn">⬇ ${t(lang, 'exportMd')}</button>
      <a class="btn" href="https://github.com/Zijian-Ni/evolution-ledger" target="_blank" rel="noopener">GitHub</a>
    </div>
  </div></header>

  <main class="wrap">
    <section class="hero">
      <span class="eyebrow">◈ agent self-evolution audit</span>
      <h1>${esc(t(lang, 'tagline'))}</h1>
      <p class="sub">${esc(t(lang, 'sub'))}</p>
      <div class="hero-cta">
        <button class="btn btn--primary" id="demoBtn">✨ ${t(lang, 'loadDemo')}</button>
        <button class="btn" id="fileBtn">📂 ${t(lang, 'loadFile')}</button>
        <input type="file" id="fileInput" accept=".jsonl,.json,.txt" hidden />
      </div>
      <div class="pain">
        ${STRINGS[lang].pains.map(([h, b]) => `
          <div class="pain-item"><b>${esc(h)}</b><span>${esc(b)}</span></div>`).join('')}
      </div>
    </section>

    ${L ? `
    <section class="stats">
      <div class="stat"><div class="k">${t(lang, 'entries')}</div><div class="v">${stats.totalEntries}</div></div>
      <div class="stat"><div class="k">${t(lang, 'active')}</div><div class="v">${stats.activeChanges}</div></div>
      <div class="stat"><div class="k">${t(lang, 'rolled')}</div><div class="v ${stats.rolledBack ? 'warn' : ''}">${stats.rolledBack}</div></div>
      <div class="stat"><div class="k">${t(lang, 'passRate')}</div><div class="v ${stats.passRate >= 60 ? 'ok' : 'bad'}">${stats.passRate ?? '—'}${stats.passRate != null ? '%' : ''}</div></div>
      <div class="stat">
        <div class="k">integrity</div>
        <span class="chain-pill ${verify.ok ? 'chain-ok' : 'chain-bad'}">${verify.ok ? '✔ ' + t(lang, 'chainOk') : '✖ ' + t(lang, 'chainBad')}</span>
      </div>
    </section>

    <section class="controls">
      ${['all', 'hypothesis', 'change', 'eval', 'decision', 'rollback', 'note'].map(f => `
        <button class="chip ${state.filter === f ? 'active' : ''}" data-filter="${f}">
          ${f === 'all' ? t(lang, 'all') : (ICONS[f] || '') + ' ' + f}
        </button>`).join('')}
      <input class="search" id="search" placeholder="🔍 search title / body / path" value="${esc(state.query)}" />
    </section>

    <section class="timeline" id="timeline">${renderEntries()}</section>
    ` : `
      <div class="dropzone" id="drop">${esc(t(lang, 'drop'))}</div>
      <p style="text-align:center;color:var(--muted)">${esc(t(lang, 'empty'))}</p>
    `}
  </main>

  <footer class="foot wrap">
    Local-only · no upload · MIT ·
    <a href="https://github.com/Zijian-Ni/evolution-ledger" target="_blank">Zijian-Ni/evolution-ledger</a>
  </footer>

  <div class="backdrop" id="backdrop"></div>
  <aside class="drawer" id="drawer">
    <div class="drawer-head">
      <strong>${t(lang, 'detail')}</strong>
      <button class="btn btn--ghost" id="closeDrawer">${t(lang, 'close')}</button>
    </div>
    <div class="drawer-body" id="drawerBody"></div>
  </aside>`;

  bind();
}

function renderEntries() {
  const L = state.ledger;
  if (!L) return '';
  const rolled = rolledBackSet();
  const q = state.query.trim().toLowerCase();
  const list = L.entries.filter(e => {
    if (state.filter !== 'all' && e.type !== state.filter) return false;
    if (!q) return true;
    return JSON.stringify(e).toLowerCase().includes(q);
  });
  if (!list.length) return `<p style="color:var(--muted)">no matching entries</p>`;

  return list.map((e, i) => {
    const isRolled = rolled.has(e.hash);
    let metric = '';
    if (e.eval) {
      metric = `<div class="metric">
        <span>${esc(e.eval.metric || 'metric')}</span>
        <span>${esc(e.eval.before ?? '—')}</span>
        <span class="arrow">→</span>
        <span>${esc(e.eval.after ?? '—')}</span>
        <span>${esc(e.eval.unit || '')}</span>
        <span class="${e.eval.passed ? 'pass' : 'fail'}">${e.eval.passed ? 'PASS' : 'FAIL'}</span>
      </div>`;
    }
    if (e.change?.path) {
      metric += `<div class="metric"><span>path</span><span>${esc(e.change.path)}</span></div>`;
    }
    return `
    <article class="entry ${isRolled ? 'reverted' : ''}" data-type="${e.type}" data-hash="${e.hash}" style="animation-delay:${Math.min(i * 30, 400)}ms">
      <div class="entry-head">
        <span class="tag ${e.type}">${ICONS[e.type] || ''} ${e.type}</span>
        <span class="agent-tag">@${esc(e.agent)}</span>
        ${isRolled ? `<span class="tag rollback">reverted</span>` : ''}
        <span class="hash">${esc(e.hash.slice(0, 12))}…</span>
      </div>
      <h3>${esc(e.title || e.type)}</h3>
      ${e.body ? `<p>${esc(e.body.slice(0, 220))}${e.body.length > 220 ? '…' : ''}</p>` : ''}
      ${metric}
    </article>`;
  }).join('');
}

function openDrawer(hash) {
  const e = state.ledger?.entries.find(x => x.hash === hash);
  if (!e) return;
  const lang = state.lang;
  const body = document.getElementById('drawerBody');
  body.innerHTML = `
    <h2 style="margin-top:0">${ICONS[e.type] || ''} ${esc(e.title || e.type)}</h2>
    <dl class="kv">
      <dt>type</dt><dd>${esc(e.type)}</dd>
      <dt>agent</dt><dd>${esc(e.agent)}</dd>
      <dt>time</dt><dd>${esc(e.ts)}</dd>
      <dt>hash</dt><dd>${esc(e.hash)}</dd>
      <dt>prevHash</dt><dd>${esc(e.prevHash || '—')}</dd>
      ${e.rollbackOf ? `<dt>rolls back</dt><dd>${esc(e.rollbackOf)}</dd>` : ''}
    </dl>
    ${e.body ? `<p style="color:var(--muted);line-height:1.65">${esc(e.body)}</p>` : ''}
    ${e.change ? `
      <div class="diff">
        <div class="diff-row diff-before"><b>${t(lang, 'before')}</b><br>${esc(e.change.before ?? '—')}</div>
        <div class="diff-row diff-after"><b>${t(lang, 'after')}</b><br>${esc(e.change.after ?? '—')}</div>
      </div>` : ''}
    ${e.eval ? `<pre>${esc(JSON.stringify(e.eval, null, 2))}</pre>` : ''}
    <pre>${esc(JSON.stringify(e, null, 2))}</pre>`;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('backdrop').classList.add('show');
}

function closeDrawer() {
  document.getElementById('drawer')?.classList.remove('open');
  document.getElementById('backdrop')?.classList.remove('show');
}

async function loadDemo() {
  try {
    const res = await fetch('./demo/ledger.jsonl');
    const text = await res.text();
    state.ledger = Ledger.fromJSONL(text);
    render();
  } catch (err) {
    alert('Demo not available: ' + err.message);
  }
}

function loadText(text) {
  try {
    state.ledger = Ledger.fromJSONL(text);
    render();
  } catch (err) {
    alert('Invalid ledger: ' + err.message);
  }
}

function bind() {
  document.getElementById('langBtn')?.addEventListener('click', () => {
    state.lang = state.lang === 'en' ? 'zh' : 'en';
    localStorage.setItem('el_lang', state.lang);
    document.documentElement.setAttribute('data-lang', state.lang);
    render();
  });
  document.getElementById('demoBtn')?.addEventListener('click', loadDemo);
  document.getElementById('fileBtn')?.addEventListener('click', () => document.getElementById('fileInput').click());
  document.getElementById('fileInput')?.addEventListener('change', async ev => {
    const f = ev.target.files?.[0];
    if (f) loadText(await f.text());
  });
  document.getElementById('verifyBtn')?.addEventListener('click', () => {
    if (!state.ledger) return alert(t(state.lang, 'empty'));
    const v = state.ledger.verify();
    alert(v.ok
      ? `✅ ${t(state.lang, 'chainOk')} — ${v.count} entries`
      : `❌ ${t(state.lang, 'chainBad')}\n\n` + v.issues.map(i => `#${i.index} ${i.error}`).join('\n'));
  });
  document.getElementById('exportBtn')?.addEventListener('click', () => {
    if (!state.ledger) return alert(t(state.lang, 'empty'));
    const md = formatMarkdown(state.ledger);
    const blob = new Blob([md], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'evolution-ledger.md';
    a.click();
  });
  document.querySelectorAll('.chip').forEach(c => c.addEventListener('click', () => {
    state.filter = c.dataset.filter;
    render();
  }));
  const search = document.getElementById('search');
  search?.addEventListener('input', ev => {
    state.query = ev.target.value;
    const tl = document.getElementById('timeline');
    if (tl) tl.innerHTML = renderEntries();
    bindEntries();
  });
  document.getElementById('closeDrawer')?.addEventListener('click', closeDrawer);
  document.getElementById('backdrop')?.addEventListener('click', closeDrawer);
  bindEntries();

  const drop = document.getElementById('drop') || document.body;
  ['dragover', 'dragenter'].forEach(t2 => drop.addEventListener(t2, ev => {
    ev.preventDefault();
    document.getElementById('drop')?.classList.add('hot');
  }));
  ['dragleave', 'drop'].forEach(t2 => drop.addEventListener(t2, () => {
    document.getElementById('drop')?.classList.remove('hot');
  }));
  drop.addEventListener('drop', async ev => {
    ev.preventDefault();
    const f = ev.dataTransfer?.files?.[0];
    if (f) loadText(await f.text());
  });
}

function bindEntries() {
  document.querySelectorAll('.entry').forEach(el => {
    el.addEventListener('click', () => openDrawer(el.dataset.hash));
  });
}

document.documentElement.setAttribute('data-lang', state.lang);
render();
loadDemo();
