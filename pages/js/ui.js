// Shared UI: helpers, icons, the Tabs component, and the page chrome (navbar, hamburger menu, account).
import { api, Auth } from './api.js';

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];

export function esc(v) {
  return v == null ? '' : String(v).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
export const safeColor = (c, fallback = '#374151') => (/^#[0-9a-f]{3,8}$/i.test(c || '') ? c : fallback);

export function fmtMin(sec) {
  const m = Math.max(1, Math.round(sec / 60));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ' ' + (m % 60) + ' min' : ''}`;
}
export const fmtMiles = mi => (mi < 0.1 ? 'under 0.1 mi' : `${mi.toFixed(mi < 1 ? 2 : 1)} mi`);
export const fmtClock = ms => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });

const svg = (d, extra = '') => `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const ICON = {
  walk: svg('<circle cx="13" cy="4.5" r="1.8"/><path d="M9 21l2.2-6.2L9 12.5l1.2-4.7 3 1.6 2.3 3.1M11.2 14.8l2.3 2.2V21"/>'),
  arrow: svg('<path d="M5 12h13M13 6l6 6-6 6"/>'),
  back: svg('<path d="M19 12H6M11 6l-6 6 6 6"/>'),
  close: svg('<path d="M6 6l12 12M18 6L6 18"/>'),
  swap: svg('<path d="M8 4v16M4 8l4-4 4 4M16 20V4M12 16l4 4 4-4"/>'),
  refresh: svg('<path d="M20 11a8 8 0 0 0-14.5-4M4 4v4h4M4 13a8 8 0 0 0 14.5 4M20 20v-4h-4"/>'),
  locate: svg('<path d="M3 11l18-8-8 18-2-8-8-2z"/>'),
  pin: svg('<path d="M12 21s7-6.2 7-11.5A7 7 0 0 0 5 9.5C5 14.8 12 21 12 21z"/><circle cx="12" cy="9.5" r="2.5"/>'),
  check: svg('<path d="M5 12.5l4.5 4.5L19 7.5"/>'),
  chevron: svg('<path d="M9 5l7 7-7 7"/>'),
  search: svg('<circle cx="11" cy="11" r="7.5"/><path d="M21 21l-4.6-4.6"/>'),
  station: svg('<rect x="5" y="3" width="14" height="14" rx="3"/><path d="M5 11h14M8 21l2-4M16 21l-2-4"/><circle cx="9" cy="14" r=".6"/><circle cx="15" cy="14" r=".6"/>'),
  stop: svg('<rect x="4" y="4" width="16" height="13" rx="3"/><path d="M4 11h16M7 17v3M17 17v3"/>')
};

// ── Live-arrival icon: bus.png for buses, trains.png for rail (white PNGs) on a black chip ──
const SIGNAL = '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="#fff" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M5 12a7 7 0 0 1 7-7M5 5.5A13.5 13.5 0 0 1 18.5 19"/><circle cx="6" cy="18" r="1.2" fill="#fff"/></svg>';
window.__liveFallback = img => {
  if (!img.dataset.tried && /trains\.png/.test(img.src)) { img.dataset.tried = '1'; img.src = 'img/train.png'; return; }
  const wrap = img.parentElement;
  if (wrap) wrap.innerHTML = SIGNAL;
};
export function liveIcon(type) {
  const src = type === 'rail' ? 'img/trains.png' : 'img/bus.png';
  return `<span class="live-ic" aria-hidden="true"><img src="${src}" alt="" onerror="window.__liveFallback(this)"></span>`;
}

window.__badgeFallback = img => {
  const s = document.createElement('span');
  s.className = `badge ${img.dataset.size || ''}${img.dataset.round === '1' ? ' round' : ''}`;
  s.style.background = img.dataset.bg; s.style.color = img.dataset.fg; s.textContent = img.dataset.id;
  img.replaceWith(s);
};
// A line with an image shows that image exactly as uploaded — no box, border, rounding or cropping.
// Without an image (or if it fails to load) it falls back to the coloured text badge.
export function lineBadge(line, size = '') {
  if (!line) return '';
  const round = line.type === 'rail';
  const bg = safeColor(line.color), fg = safeColor(line.text_color, '#fff');
  if (line.image_url) {
    return `<img class="line-img ${size}" src="${esc(line.image_url)}" alt="${esc(line.id)}" data-id="${esc(line.id)}" data-bg="${bg}" data-fg="${fg}" data-size="${esc(size)}" data-round="${round ? 1 : 0}" onerror="window.__badgeFallback(this)">`;
  }
  return `<span class="badge ${size}${round ? ' round' : ''}" style="background:${bg};color:${fg}">${esc(line.id)}</span>`;
}

let toastTimer;
export function toast(msg) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.append(el); }
  el.textContent = msg; el.classList.add('show');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}

// ── Tabs: tap or arrow keys. (Swiping is opt-in via `swipePanel`.) ──
export function Tabs({ items, active, onChange, label = 'Tabs', variant = 'segmented', swipePanel = null }) {
  let current = active ?? (items[0] && items[0].id);
  const el = document.createElement('div');
  el.className = `tabs tabs-${variant}`;
  el.setAttribute('role', 'tablist'); el.setAttribute('aria-label', label);

  const paint = () => {
    el.innerHTML = items.map(it => `
      <button type="button" role="tab" class="tab${it.id === current ? ' is-active' : ''}" data-id="${esc(it.id)}"
        aria-selected="${it.id === current}" tabindex="${it.id === current ? 0 : -1}">
        <span class="tab-label">${it.html ?? esc(it.label)}</span>${it.sub ? `<span class="tab-sub">${esc(it.sub)}</span>` : ''}
      </button>`).join('');
  };
  const select = (id, { silent = false } = {}) => {
    if (!items.some(i => i.id === id)) return;
    current = id;
    el.querySelectorAll('.tab').forEach(b => {
      const on = b.dataset.id === id;
      b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on); b.tabIndex = on ? 0 : -1;
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
  });
  if (swipePanel) {
    let x0 = null, y0 = null;
    swipePanel.addEventListener('pointerdown', e => { x0 = e.clientX; y0 = e.clientY; });
    swipePanel.addEventListener('pointerup', e => {
      if (x0 == null) return;
      const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 2) step(dx < 0 ? 1 : -1);
    });
  }
  paint();
  return { el, select, get value() { return current; }, setItems(next, keep) { items = next; if (!keep || !items.some(i => i.id === current)) current = items[0] && items[0].id; paint(); } };
}

// ── Pager: a tab bar + panes. Desktop shows the active pane; on mobile the panes sit side by side and swipe. ──
export function Pager({ items, active, onChange, label = 'Direction' }) {
  let current = active ?? items[0].id;
  const el = document.createElement('div');
  el.className = 'pager-wrap';
  const tabs = Tabs({ items: items.map(i => ({ id: i.id, label: i.label, sub: i.sub })), active: current, label, onChange: id => go(id) });
  const pager = document.createElement('div');
  pager.className = 'pager';
  const mark = () => pager.querySelectorAll('.pane').forEach(p => p.classList.toggle('is-active', p.dataset.id === current));
  const build = () => { pager.innerHTML = items.map(i => `<section class="pane" data-id="${esc(i.id)}" aria-label="${esc(i.label)}">${i.html}</section>`).join(''); mark(); };
  function go(id, { scroll = true } = {}) {
    current = id; mark();
    if (scroll && pager.scrollWidth > pager.clientWidth + 1) pager.scrollTo({ left: items.findIndex(x => x.id === id) * pager.clientWidth, behavior: 'smooth' });
    onChange && onChange(id);
  }
  let t;
  pager.addEventListener('scroll', () => {
    clearTimeout(t);
    t = setTimeout(() => {
      const i = Math.round(pager.scrollLeft / Math.max(1, pager.clientWidth));
      if (items[i] && items[i].id !== current) { current = items[i].id; tabs.select(current, { silent: true }); mark(); onChange && onChange(current); }
    }, 70);
  });
  build();
  el.append(tabs.el, pager);
  return {
    el, pager, tabs, get value() { return current; },
    // re-render pane content in place (live refresh) without losing the swipe position
    update(next, nextTabs) { items = next; const left = pager.scrollLeft; build(); pager.scrollLeft = left; if (nextTabs) tabs.setItems(items.map(i => ({ id: i.id, label: i.label, sub: i.sub })), true), tabs.select(current, { silent: true }); }
  };
}

// ── Page chrome (navbar as it was before: white bar, logo button, blue "Metro", hamburger on mobile) ──
export function mountChrome(active) {
  const a = (href, text, id) => `<a href="${href}"${active === id ? ' class="active" aria-current="page"' : ''}>${text}</a>`;
  document.body.insertAdjacentHTML('afterbegin', `
    <nav class="navbar">
      <button class="nav-logo-btn" id="accountBtn" aria-label="Account"><img src="img/logo.png" alt="City Metro"></button>
      <a href="index.html" class="nav-title">City <span>Metro</span></a>
      <nav class="nav-links" aria-label="Main">${a('index.html', 'Map', 'map')}${a('planner.html', 'Plan Trip', 'plan')}</nav>
      <button class="hamburger" id="menuBtn" aria-label="Menu" aria-expanded="false" aria-controls="navDrawer"><span></span><span></span><span></span></button>
    </nav>
    <div class="nav-drawer" id="navDrawer">${a('index.html', 'Map', 'map')}${a('planner.html', 'Plan Trip', 'plan')}</div>
    <div class="overlay" id="accountOverlay" hidden>
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="accountTitle">
        <button class="dialog-close" id="accountClose" aria-label="Close">${ICON.close}</button>
        <h2 id="accountTitle">Transit account</h2>
        <div id="accountBody"></div>
      </div>
    </div>`);
  const overlay = $('#accountOverlay'), drawer = $('#navDrawer'), menu = $('#menuBtn');
  const closeMenu = () => { drawer.classList.remove('open'); menu.setAttribute('aria-expanded', 'false'); };
  menu.onclick = () => { const open = drawer.classList.toggle('open'); menu.setAttribute('aria-expanded', String(open)); };
  drawer.addEventListener('click', e => { if (e.target.closest('a')) closeMenu(); });
  $('#accountBtn').onclick = () => { closeMenu(); renderAccount(); overlay.hidden = false; };
  $('#accountClose').onclick = () => { overlay.hidden = true; };
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.hidden = true; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') { overlay.hidden = true; closeMenu(); } });
  window.addEventListener('resize', () => { if (innerWidth >= 900) closeMenu(); });
}

function renderAccount() {
  const body = $('#accountBody'), user = Auth.user();
  if (Auth.loggedIn && user) return renderUserView(body, user);
  let mode = 'login';
  body.innerHTML = `
    <div id="authTabs"></div>
    <p class="form-error" id="authError" role="alert" hidden></p>
    <label class="field" id="nameField" hidden>Name<input id="authName" autocomplete="name"></label>
    <label class="field">Email<input id="authEmail" type="email" autocomplete="email"></label>
    <label class="field">Password<input id="authPassword" type="password" autocomplete="current-password"></label>
    <button class="btn btn-primary btn-block" id="authSubmit">Sign in</button>`;
  $('#authTabs').append(Tabs({
    label: 'Sign in or sign up', active: 'login',
    items: [{ id: 'login', label: 'Sign in' }, { id: 'signup', label: 'Sign up' }],
    onChange: id => { mode = id; $('#nameField').hidden = id === 'login'; $('#authSubmit').textContent = id === 'login' ? 'Sign in' : 'Create account'; }
  }).el);
  const submit = async () => {
    const err = $('#authError'); err.hidden = true;
    try {
      const payload = { email: $('#authEmail').value, password: $('#authPassword').value };
      if (mode === 'signup') payload.name = $('#authName').value;
      const data = await api(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) });
      Auth.set(data.token, data.user); renderAccount(); toast(`Welcome, ${data.user.name}`);
    } catch (e) { err.textContent = e.message; err.hidden = false; }
  };
  $('#authSubmit').onclick = submit;
  body.addEventListener('keydown', e => { if (e.key === 'Enter') submit(); });
}

async function renderUserView(body, user) {
  body.innerHTML = `
    <p class="user-name">${esc(user.name)}</p><p class="muted">${esc(user.email)}</p>
    <h3 class="eyebrow">Saved journeys</h3><div id="savedList"><p class="muted">Loading…</p></div>
    <a class="btn btn-primary btn-block" href="planner.html">Plan a new trip</a>
    <button class="btn btn-ghost btn-block" id="signOut">Sign out</button>`;
  $('#signOut').onclick = () => { Auth.clear(); renderAccount(); };
  const box = $('#savedList');
  try {
    const rows = await api('/api/journeys');
    box.innerHTML = rows.length ? rows.map(j => `
      <div class="saved-row"><a href="planner.html?from=${j.from_station_id}&to=${j.to_station_id}">${esc(j.name)}</a>
        <button class="icon-btn" data-del="${j.id}" aria-label="Delete journey">${ICON.close}</button></div>`).join('') : '<p class="muted">Nothing saved yet.</p>';
    box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => { await api(`/api/journeys/${b.dataset.del}`, { method: 'DELETE' }); renderUserView(body, user); });
  } catch (e) { box.innerHTML = `<p class="muted">${esc(e.message)}</p>`; if (!Auth.loggedIn) renderAccount(); }
}
