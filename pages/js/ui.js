// Shared UI: helpers, the Tabs component, and the page chrome (nav + account).
import { api, Auth } from './api.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(v) {
  return v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Only ever allow safe CSS colors into inline styles.
export const safeColor = (c, fallback = '#374151') => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);

export function fmtMin(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60 ? (m % 60) + ' min' : ''}`.trim();
}
export const fmtMiles = mi => (mi < 0.1 ? 'under 0.1 mi' : `${mi.toFixed(mi < 1 ? 2 : 1)} mi`);

export function lineBadge(line, size = '') {
  if (!line) return '';
  const img = line.image_url ? `<img src="${esc(line.image_url)}" alt="" onerror="this.remove()">` : '';
  return `<span class="badge ${size}" style="background:${safeColor(line.color)};color:${safeColor(line.text_color, '#fff')}">${esc(line.id)}${img}</span>`;
}

let toastTimer;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── TABS ─────────────────────────────────────────────────────
// One component used everywhere (station card, trip modes, sign-in).
// Tap or use the arrow keys to switch. Swiping is OFF by default; pass
// `swipePanel` (the element holding the tab's content) to opt back in.
export function Tabs({ items, active, onChange, label = 'Tabs', variant = 'segmented', swipePanel = null }) {
  let current = active ?? (items[0] && items[0].id);
  const el = document.createElement('div');
  el.className = `tabs tabs-${variant}`;
  el.setAttribute('role', 'tablist');
  el.setAttribute('aria-label', label);

  const paint = () => {
    el.innerHTML = items.map(it => `
      <button type="button" role="tab" class="tab${it.id === current ? ' is-active' : ''}" data-id="${esc(it.id)}"
        aria-selected="${it.id === current}" tabindex="${it.id === current ? 0 : -1}"
        ${it.color ? `style="--tab-bg:${safeColor(it.color)};--tab-fg:${safeColor(it.text, '#fff')}"` : ''}>
        <span class="tab-label">${it.html ?? esc(it.label)}</span>${it.sub ? `<span class="tab-sub">${esc(it.sub)}</span>` : ''}
      </button>`).join('');
  };
  const select = (id, { silent = false } = {}) => {
    if (!items.some(i => i.id === id)) return;
    current = id;
    el.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.id === id;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
      b.tabIndex = on ? 0 : -1;
      if (on) b.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    });
    if (!silent && onChange) onChange(id);
  };
  const step = d => {
    const i = items.findIndex(x => x.id === current);
    const n = items[Math.max(0, Math.min(items.length - 1, i + d))];
    if (n && n.id !== current) select(n.id);
  };

  el.addEventListener('click', e => { const b = e.target.closest('.tab'); if (b) select(b.dataset.id); });
  el.addEventListener('keydown', e => {
    const k = { ArrowRight: 1, ArrowLeft: -1 }[e.key];
    if (k) { e.preventDefault(); step(k); el.querySelector('.tab.is-active')?.focus(); }
    if (e.key === 'Home') { e.preventDefault(); select(items[0].id); }
    if (e.key === 'End') { e.preventDefault(); select(items[items.length - 1].id); }
  });

  if (swipePanel) {
    let x0 = null, y0 = null;
    swipePanel.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
    swipePanel.addEventListener('pointerup', e => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1);
    });
  }

  paint();
  return { el, select, get value() { return current; }, setItems(next, keep) { items = next; if (!keep || !items.some(i => i.id === current)) current = items[0] && items[0].id; paint(); } };
}

// ── PAGE CHROME ──────────────────────────────────────────────
export function mountChrome(active) {
  const link = (href, text, id) => `<a href="${href}"${active === id ? ' class="is-current" aria-current="page"' : ''}>${text}</a>`;
  document.body.insertAdjacentHTML('afterbegin', `
    <header class="navbar">
      <button class="nav-logo" id="accountBtn" aria-label="Account"><img src="img/logo.png" alt=""></button>
      <a href="index.html" class="nav-title">City <span>Metro</span></a>
      <nav class="nav-links">${link('index.html', 'Map', 'map')}${link('planner.html', 'Plan trip', 'plan')}</nav>
    </header>
    <div class="overlay" id="accountOverlay" hidden>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
        <button class="dialog-close" id="accountClose" aria-label="Close">✕</button>
        <h2 id="accountTitle">Transit account</h2>
        <div id="accountBody"></div>
      </div>
    </div>`);
  const overlay = $('#accountOverlay');
  const close = () => { overlay.hidden = true; };
  $('#accountBtn').onclick = () => { renderAccount(); overlay.hidden = false; };
  $('#accountClose').onclick = close;
  overlay.addEventListener('click', e => { if (e.target === overlay) close(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
}

function renderAccount() {
  const body = $('#accountBody');
  const user = Auth.user();
  if (Auth.loggedIn && user) return renderUserView(body, user);

  let mode = 'login';
  body.innerHTML = `
    <div id="authTabs"></div>
    <p class="form-error" id="authError" role="alert" hidden></p>
    <label class="field" id="nameField" hidden>Name<input id="authName" autocomplete="name"></label>
    <label class="field">Email<input id="authEmail" type="email" autocomplete="email"></label>
    <label class="field">Password<input id="authPassword" type="password" autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" id="authSubmit">Sign in</button>`;
  const tabs = Tabs({
    label: 'Sign in or sign up', active: 'login',
    items: [{ id: 'login', label: 'Sign in' }, { id: 'signup', label: 'Sign up' }],
    onChange: id => {
      mode = id;
      $('#nameField').hidden = id === 'login';
      $('#authSubmit').textContent = id === 'login' ? 'Sign in' : 'Create account';
    }
  });
  $('#authTabs').append(tabs.el);

  const submit = async () => {
    const err = $('#authError');
    err.hidden = true;
    try {
      const payload = { email: $('#authEmail').value, password: $('#authPassword').value };
      if (mode === 'signup') payload.name = $('#authName').value;
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      Auth.set(data.token, data.user);
      renderAccount();
      toast(`Welcome, ${data.user.name}`);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  $('#authSubmit').onclick = submit;
  body.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

async function renderUserView(body, user) {
  body.innerHTML = `
    <p class="user-name">${esc(user.name)}</p><p class="muted">${esc(user.email)}</p>
    <h3 class="eyebrow">Saved journeys</h3><div id="savedList" class="saved-list"><p class="muted">Loading…</p></div>
    <a class="btn btn-primary btn-block" href="planner.html">Plan a new trip</a>
    <button class="btn btn-ghost btn-block" id="signOut">Sign out</button>`;
  $('#signOut').onclick = () => { Auth.clear(); renderAccount(); };
  const box = $('#savedList');
  try {
    const rows = await api('/api/journeys');
    box.innerHTML = rows.length ? rows.map(j => `
      <div class="saved-row">
        <a href="planner.html?from=${j.from_station_id}&to=${j.to_station_id}">${esc(j.name)}</a>
        <button class="icon-btn" data-del="${j.id}" aria-label="Delete journey">✕</button>
      </div>`).join('') : '<p class="muted">Nothing saved yet.</p>';
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
      await api(`/api/journeys/${b.dataset.del}`, { method: 'DELETE' });
      renderUserView(body, user);
    });
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; if (!Auth.loggedIn) renderAccount(); }
}
