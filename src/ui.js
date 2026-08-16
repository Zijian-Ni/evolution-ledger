import './style.css';
import { Ledger, formatMarkdown } from './core.js';
import { t, STRINGS } from './i18n.js';
import { parseAITextToDrafts, applyDraftsToLedger } from './parse-ai.js';

const state = {
  lang: localStorage.getItem('el_lang') || 'en',
  ledger: null,
  filter: 'all',
  query: '',
  selected: null,
  pasteOpen: false,
  pasteText: '',
  pastePreview: null,
  formOpen: false,
};

const ICONS = {
  hypothesis: '💡', change: '🔧', eval: '📊', decision: '⚖️', rollback: '↩️', note: '📝',
};

const app = document.getElementById('app');

function esc(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
        <button class="btn" id="pasteBtn">🤖 ${lang === 'en' ? 'Paste AI answer' : '粘贴 AI 回答'}</button>
        <button class="btn" id="cycleBtn">＋ ${lang === 'en' ? 'Add cycle' : '添加 cycle'}</button>
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
      <div class="stat"><div class="k">${t(lang, 'passRate')}</div><div class="v ${stats.passRate != null && stats.passRate >= 60 ? 'ok' : 'bad'}">${stats.passRate ?? '—'}${stats.passRate != null ? '%' : ''}</div></div>
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
  </aside>

  ${renderPasteModal(lang)}
  ${renderCycleModal(lang)}
  ${renderThemeDock(lang)}
  `;

  bind();
  applySavedBg();
}

function renderThemeDock(lang) {
  return `
  <div class="el-theme-dock">
    <button class="el-theme-toggle" id="themeToggle" title="Background">🎨</button>
    <div class="el-theme-panel" id="themePanel" hidden>
      <div class="el-theme-title">${lang === 'en' ? 'Background' : '背景'}</div>
      <div class="el-theme-presets">
        <button data-bg="aurora" class="el-preset">Aurora</button>
        <button data-bg="midnight" class="el-preset">Midnight</button>
        <button data-bg="nebula" class="el-preset">Nebula</button>
        <button data-bg="ember" class="el-preset">Ember</button>
      </div>
      <label class="el-theme-upload">${lang === 'en' ? 'Custom image / GIF' : '自定义图片/动图'}
        <input type="file" id="bgUpload" accept="image/*,.gif" hidden />
      </label>
      <input type="range" id="bgOpacity" min="10" max="85" value="30" />
      <button class="btn btn--ghost" id="bgClear">${lang === 'en' ? 'Clear custom' : '清除自定义'}</button>
    </div>
  </div>
  <div class="el-custom-bg" id="customBgLayer" aria-hidden="true"></div>`;
}

function renderPasteModal(lang) {
  if (!state.pasteOpen) return '';
  const preview = state.pastePreview;
  return `
  <div class="modal-root show" id="pasteModal">
    <div class="modal-card modal-wide">
      <div class="modal-head">
        <div>
          <h2>🤖 ${lang === 'en' ? 'Paste AI answer → structured cycle' : '粘贴 AI 回答 → 结构化 cycle'}</h2>
          <p class="modal-sub">${lang === 'en'
            ? 'Don’t dump a monologue as a note. We parse hypothesis / change / eval / decision, show gaps, then append as a hash-chained cycle.'
            : '别把整段独白塞成 note。我们会解析 假设/改动/评测/决策，标出缺项，再以哈希链式 cycle 写入。'}</p>
        </div>
        <button class="btn btn--ghost" id="closePaste">✕</button>
      </div>
      <textarea id="pasteArea" class="modal-textarea" placeholder="${lang === 'en'
        ? 'Example:\\n## Hypothesis\\nIf we add a health probe...\\n## Change\\npolicy AGENTS.md: no check → Reflex 7\\n## Eval\\nmetric silent_failure_days: 8 → 0 days PASS\\n## Decision\\nkeep — detected within one heartbeat'
        : '示例：\\n## 假设\\n如果加健康探针...\\n## 改动\\npolicy AGENTS.md: 无检查 → Reflex 7\\n## 评测\\n指标 silent_failure_days: 8 → 0 days 通过\\n## 决策\\n保留 — 一个心跳内发现'}">${esc(state.pasteText)}</textarea>
      <div class="modal-actions">
        <button class="btn" id="previewPaste">${lang === 'en' ? 'Preview structure' : '预览结构'}</button>
        <button class="btn btn--primary" id="commitPaste" ${preview ? '' : 'disabled'}>${lang === 'en' ? 'Append to ledger' : '写入账本'}</button>
      </div>
      ${preview ? renderPastePreview(preview, lang) : `<p class="modal-hint">${lang === 'en' ? 'Tip: use headings like Hypothesis / Change / Eval / Decision for best results.' : '提示：用「假设/改动/评测/决策」标题效果最好。'}</p>`}
    </div>
  </div>`;
}

function renderPastePreview(preview, lang) {
  const { cycles, orphans, warnings } = preview;
  return `
  <div class="paste-preview">
    ${warnings?.length ? `<div class="warn-box">${warnings.map(w => `<div>⚠️ ${esc(w)}</div>`).join('')}</div>` : ''}
    <div class="preview-stats">
      <span>${cycles.length} cycle(s)</span>
      <span>${orphans.length} note(s)</span>
    </div>
    ${cycles.map((c, i) => `
      <article class="preview-cycle">
        <header>Cycle ${i + 1}</header>
        <div class="preview-row"><b>💡 hypothesis</b><span>${esc(c.hypothesis?.title || '')}</span></div>
        <div class="preview-row"><b>🔧 change</b><span>${esc(c.change?.summary || c.change?.title || '—')} ${c.change?.path ? '· ' + esc(c.change.path) : ''}</span></div>
        <div class="preview-row"><b>📊 eval</b><span>${esc(c.eval?.metric || '—')}: ${esc(c.eval?.before ?? '—')} → ${esc(c.eval?.after ?? '—')} ${esc(c.eval?.unit || '')} ${c.eval?.passed === true ? 'PASS' : c.eval?.passed === false ? 'FAIL' : 'TBD'}</span></div>
        <div class="preview-row"><b>⚖️ decision</b><span>${esc(c.decision?.action || c.decision || 'iterate')} — ${esc(c.decisionReason || c.decision?.reason || '')}</span></div>
      </article>`).join('')}
    ${orphans.map(o => `<div class="preview-row"><b>📝 note</b><span>${esc(o.title)}</span></div>`).join('')}
  </div>`;
}

function renderCycleModal(lang) {
  if (!state.formOpen) return '';
  return `
  <div class="modal-root show" id="cycleModal">
    <div class="modal-card modal-wide">
      <div class="modal-head">
        <div>
          <h2>＋ ${lang === 'en' ? 'Record evolution cycle' : '记录进化 cycle'}</h2>
          <p class="modal-sub">${lang === 'en' ? 'Hypothesis → Change → Eval → Decision (optional auto-rollback)' : '假设 → 改动 → 评测 → 决策（可选自动回滚）'}</p>
        </div>
        <button class="btn btn--ghost" id="closeCycle">✕</button>
      </div>
      <div class="form-grid">
        <label>Agent<input id="fAgent" value="xiaoluo" /></label>
        <label>${lang === 'en' ? 'Hypothesis title' : '假设标题'}<input id="fHTitle" placeholder="Tool-liveness reflex" /></label>
        <label class="full">${lang === 'en' ? 'Hypothesis body' : '假设内容'}<textarea id="fHBody" rows="2"></textarea></label>
        <label>Change kind
          <select id="fKind">
            ${['prompt','skill','tool','config','memory','model','policy','other'].map(k => `<option value="${k}">${k}</option>`).join('')}
          </select>
        </label>
        <label>Path<input id="fPath" placeholder="AGENTS.md#Reflex-7" /></label>
        <label class="full">Before<textarea id="fBefore" rows="2"></textarea></label>
        <label class="full">After<textarea id="fAfter" rows="2"></textarea></label>
        <label>Metric<input id="fMetric" placeholder="query_latency" /></label>
        <label>Before → After
          <div class="inline-2">
            <input id="fMBefore" placeholder="180" />
            <input id="fMAfter" placeholder="0.4" />
          </div>
        </label>
        <label>Unit<input id="fUnit" placeholder="s" /></label>
        <label>Passed
          <select id="fPassed">
            <option value="true">PASS</option>
            <option value="false">FAIL</option>
            <option value="null">Unknown</option>
          </select>
        </label>
        <label>Decision
          <select id="fDecision">
            <option value="keep">keep</option>
            <option value="revert">revert (auto rollback)</option>
            <option value="iterate">iterate</option>
          </select>
        </label>
        <label class="full">${lang === 'en' ? 'Decision reason' : '决策理由'}<textarea id="fReason" rows="2"></textarea></label>
      </div>
      <div class="modal-actions">
        <button class="btn btn--primary" id="commitCycle">${lang === 'en' ? 'Append cycle' : '写入 cycle'}</button>
      </div>
    </div>
  </div>`;
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
        <span class="${e.eval.passed === true ? 'pass' : e.eval.passed === false ? 'fail' : ''}">${e.eval.passed === true ? 'PASS' : e.eval.passed === false ? 'FAIL' : 'TBD'}</span>
      </div>`;
    }
    if (e.change?.path) {
      metric += `<div class="metric"><span>path</span><span>${esc(e.change.path)}</span></div>`;
    }
    if (e.decision?.action) {
      metric += `<div class="metric"><span>decision</span><span>${esc(e.decision.action)}</span></div>`;
    }
    const follows = e.meta?.follows ? `<span class="link-pill">↳ ${esc(String(e.meta.follows).slice(0, 8))}…</span>` : '';
    return `
    <article class="entry ${isRolled ? 'reverted' : ''}" data-type="${e.type}" data-hash="${e.hash}" style="animation-delay:${Math.min(i * 30, 400)}ms">
      <div class="entry-head">
        <span class="tag ${e.type}">${ICONS[e.type] || ''} ${e.type}</span>
        <span class="agent-tag">@${esc(e.agent)}</span>
        ${isRolled ? `<span class="tag rollback">reverted</span>` : ''}
        ${follows}
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
  const related = state.ledger.entries.filter(x =>
    x.hash === e.meta?.follows || x.meta?.follows === e.hash || x.rollbackOf === e.hash || e.rollbackOf === x.hash
  );

  body.innerHTML = `
    <h2 style="margin-top:0">${ICONS[e.type] || ''} ${esc(e.title || e.type)}</h2>
    <dl class="kv">
      <dt>type</dt><dd>${esc(e.type)}</dd>
      <dt>agent</dt><dd>${esc(e.agent)}</dd>
      <dt>time</dt><dd>${esc(e.ts)}</dd>
      <dt>hash</dt><dd>${esc(e.hash)}</dd>
      <dt>prevHash</dt><dd>${esc(e.prevHash || '—')}</dd>
      ${e.rollbackOf ? `<dt>rolls back</dt><dd>${esc(e.rollbackOf)}</dd>` : ''}
      ${e.meta?.follows ? `<dt>follows</dt><dd>${esc(e.meta.follows)}</dd>` : ''}
    </dl>
    ${e.body ? `<p style="color:var(--muted);line-height:1.65;white-space:pre-wrap">${esc(e.body)}</p>` : ''}
    ${e.change ? `
      <h3 style="font-size:13px;color:var(--violet)">Change</h3>
      <div class="diff">
        <div class="diff-row"><b>kind</b> ${esc(e.change.kind || '')} · <b>path</b> ${esc(e.change.path || '—')}</div>
        <div class="diff-row diff-before"><b>${t(lang, 'before')}</b><br>${esc(e.change.before ?? '—')}</div>
        <div class="diff-row diff-after"><b>${t(lang, 'after')}</b><br>${esc(e.change.after ?? '—')}</div>
      </div>` : ''}
    ${e.eval ? `
      <h3 style="font-size:13px;color:var(--teal)">Eval</h3>
      <div class="metric" style="display:flex">
        <span>${esc(e.eval.metric)}</span>
        <span>${esc(e.eval.before ?? '—')}</span><span class="arrow">→</span><span>${esc(e.eval.after ?? '—')}</span>
        <span>${esc(e.eval.unit || '')}</span>
        <span class="${e.eval.passed === true ? 'pass' : e.eval.passed === false ? 'fail' : ''}">${e.eval.passed === true ? 'PASS' : e.eval.passed === false ? 'FAIL' : 'TBD'}</span>
      </div>
      ${e.eval.evidence ? `<p class="muted">${esc(e.eval.evidence)}</p>` : ''}
      ${e.eval.notes ? `<p class="muted">${esc(e.eval.notes)}</p>` : ''}` : ''}
    ${e.decision ? `
      <h3 style="font-size:13px;color:var(--pink)">Decision</h3>
      <p><b>${esc(e.decision.action)}</b> — ${esc(e.decision.reason || '')}</p>` : ''}
    ${related.length ? `
      <h3 style="font-size:13px;margin-top:18px">Linked</h3>
      <div class="linked-list">
        ${related.map(r => `<button class="linked-item" data-hash="${r.hash}">${ICONS[r.type] || ''} ${esc(r.type)} · ${esc(r.title || '')}</button>`).join('')}
      </div>` : ''}
    <details style="margin-top:16px"><summary>raw json</summary>
      <pre>${esc(JSON.stringify(e, null, 2))}</pre>
    </details>`;
  document.getElementById('drawer').classList.add('open');
  document.getElementById('backdrop').classList.add('show');
  body.querySelectorAll('.linked-item').forEach(btn => {
    btn.addEventListener('click', () => openDrawer(btn.dataset.hash));
  });
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

function ensureLedger() {
  if (!state.ledger) state.ledger = new Ledger(null);
  return state.ledger;
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
  document.getElementById('pasteBtn')?.addEventListener('click', () => {
    state.pasteOpen = true;
    state.pastePreview = null;
    render();
  });
  document.getElementById('cycleBtn')?.addEventListener('click', () => {
    state.formOpen = true;
    render();
  });
  document.getElementById('closePaste')?.addEventListener('click', () => {
    state.pasteOpen = false;
    render();
  });
  document.getElementById('closeCycle')?.addEventListener('click', () => {
    state.formOpen = false;
    render();
  });
  document.getElementById('pasteArea')?.addEventListener('input', e => {
    state.pasteText = e.target.value;
  });
  document.getElementById('previewPaste')?.addEventListener('click', () => {
    state.pasteText = document.getElementById('pasteArea')?.value || '';
    state.pastePreview = parseAITextToDrafts(state.pasteText);
    render();
  });
  document.getElementById('commitPaste')?.addEventListener('click', () => {
    if (!state.pastePreview) return;
    const L = ensureLedger();
    applyDraftsToLedger(L, state.pastePreview);
    state.pasteOpen = false;
    state.pastePreview = null;
    state.pasteText = '';
    render();
  });
  document.getElementById('commitCycle')?.addEventListener('click', () => {
    const L = ensureLedger();
    const passedRaw = document.getElementById('fPassed')?.value;
    const passed = passedRaw === 'true' ? true : passedRaw === 'false' ? false : null;
    const mBefore = document.getElementById('fMBefore')?.value;
    const mAfter = document.getElementById('fMAfter')?.value;
    L.recordCycle({
      agent: document.getElementById('fAgent')?.value || 'xiaoluo',
      hypothesis: {
        title: document.getElementById('fHTitle')?.value || 'Hypothesis',
        body: document.getElementById('fHBody')?.value || '',
      },
      change: {
        kind: document.getElementById('fKind')?.value || 'other',
        path: document.getElementById('fPath')?.value || '',
        before: document.getElementById('fBefore')?.value || null,
        after: document.getElementById('fAfter')?.value || null,
        summary: document.getElementById('fHTitle')?.value || 'change',
      },
      eval: {
        metric: document.getElementById('fMetric')?.value || 'metric',
        before: mBefore === '' ? null : Number(mBefore),
        after: mAfter === '' ? null : Number(mAfter),
        unit: document.getElementById('fUnit')?.value || '',
        passed,
        notes: '',
      },
      decision: document.getElementById('fDecision')?.value || 'iterate',
      decisionReason: document.getElementById('fReason')?.value || '',
      tags: ['manual'],
    });
    state.formOpen = false;
    render();
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
  document.getElementById('backdrop')?.addEventListener('click', () => {
    closeDrawer();
    if (state.pasteOpen || state.formOpen) {
      state.pasteOpen = false;
      state.formOpen = false;
      render();
    }
  });
  bindEntries();
  bindTheme();

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

function bindTheme() {
  document.getElementById('themeToggle')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const p = document.getElementById('themePanel');
    if (p) p.hidden = !p.hidden;
  });
  document.querySelectorAll('.el-preset').forEach(btn => {
    btn.addEventListener('click', () => {
      localStorage.setItem('el_bg_preset', btn.dataset.bg);
      document.documentElement.dataset.bg = btn.dataset.bg;
      document.querySelectorAll('.el-preset').forEach(b => b.classList.toggle('active', b === btn));
    });
  });
  document.getElementById('bgUpload')?.addEventListener('change', e => {
    const f = e.target.files?.[0];
    if (!f) return;
    const r = new FileReader();
    r.onload = () => {
      try { localStorage.setItem('el_bg_custom', r.result); } catch {}
      applyCustomBg(r.result);
    };
    r.readAsDataURL(f);
  });
  document.getElementById('bgOpacity')?.addEventListener('input', e => {
    localStorage.setItem('el_bg_opacity', e.target.value);
    document.documentElement.style.setProperty('--el-custom-opacity', String(Number(e.target.value) / 100));
  });
  document.getElementById('bgClear')?.addEventListener('click', () => {
    localStorage.removeItem('el_bg_custom');
    applyCustomBg(null);
  });
}

function applySavedBg() {
  const preset = localStorage.getItem('el_bg_preset') || 'aurora';
  document.documentElement.dataset.bg = preset;
  document.querySelectorAll('.el-preset').forEach(b => b.classList.toggle('active', b.dataset.bg === preset));
  const op = localStorage.getItem('el_bg_opacity') || '30';
  document.documentElement.style.setProperty('--el-custom-opacity', String(Number(op) / 100));
  const opEl = document.getElementById('bgOpacity');
  if (opEl) opEl.value = op;
  const custom = localStorage.getItem('el_bg_custom');
  if (custom) applyCustomBg(custom);
}

function applyCustomBg(url) {
  const layer = document.getElementById('customBgLayer');
  if (!layer) return;
  if (url) {
    layer.style.backgroundImage = `url(${url})`;
    layer.classList.add('show');
  } else {
    layer.style.backgroundImage = '';
    layer.classList.remove('show');
  }
}

function bindEntries() {
  document.querySelectorAll('.entry').forEach(el => {
    el.addEventListener('click', () => openDrawer(el.dataset.hash));
  });
}

document.documentElement.setAttribute('data-lang', state.lang);
render();
loadDemo();
