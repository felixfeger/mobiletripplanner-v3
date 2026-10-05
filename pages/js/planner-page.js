// Trip planner: pick two stations, compare three modes, see the route on the map.
import { api, Auth, loadNetwork } from './api.js';
import { mountChrome, $, esc, lineBadge, safeColor, Tabs, toast, fmtMin, fmtMiles } from './ui.js';
import { MapView } from './mapview.js';
import { MODES } from './config.js';

mountChrome('plan');

const state = { from: null, to: null, mode: 'fastest', plan: null };
let net, view, modeTabs, picking = null, planToken = 0;
const wide = () => window.matchMedia('(min-width: 900px)').matches;

// ── recents (per device) ─────────────────────────────────────
const RECENT_KEY = 'cm_recent_stations';
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT_KEY)) || []; } catch { return []; } };
function pushRecent(id) {
  try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...recents().filter(x => x !== id)].slice(0, 6))); } catch { /* storage unavailable */ }
}

// ── from / to fields ─────────────────────────────────────────
function paintFields() {
  for (const [key, el] of [['from', $('#fromText')], ['to', $('#toText')]]) {
    const s = state[key];
    el.textContent = s ? s.name : key === 'from' ? 'Choose starting station' : 'Choose destination';
    el.classList.toggle('placeholder', !s);
  }
}

function syncUrl() {
  const q = new URLSearchParams();
  if (state.from) q.set('from', state.from.id);
  if (state.to) q.set('to', state.to.id);
  if (state.from && state.to && state.mode !== 'fastest') q.set('mode', state.mode);
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
}

function setStation(key, s) {
  state[key] = s;
  if (s) pushRecent(s.id);
  paintFields();
  plan();
}

$('#fromBtn').onclick = () => openPicker('from');
$('#toBtn').onclick = () => openPicker('to');
$('#swapBtn').onclick = () => { [state.from, state.to] = [state.to, state.from]; paintFields(); plan(); };

// ── station picker ───────────────────────────────────────────
const picker = $('#picker'), pickerInput = $('#pickerInput'), pickerList = $('#pickerList');

function openPicker(key) {
  picking = key;
  pickerInput.value = '';
  renderPicker('');
  picker.hidden = false;
  pickerInput.focus();
}
const closePicker = () => { picker.hidden = true; picking = null; };
$('#pickerClose').onclick = closePicker;
picker.addEventListener('click', e => { if (e.target === picker) closePicker(); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !picker.hidden) closePicker(); });
pickerInput.addEventListener('input', () => renderPicker(pickerInput.value));

function renderPicker(query) {
  const q = query.trim().toLowerCase();
  let list;
  let heading = '';
  if (q) {
    list = net.stations.filter(s =>
      s.name.toLowerCase().includes(q) || (s.street || '').toLowerCase().includes(q) ||
      s.lineIds.some(id => id.toLowerCase() === q || (net.linesById[id]?.name || '').toLowerCase().includes(q)));
  } else {
    const rec = recents().map(id => net.stationsById[id]).filter(Boolean);
    list = rec.length ? rec : net.stations;
    heading = rec.length ? 'Recent' : 'All stations';
  }
  pickerList.innerHTML = (heading ? `<h3 class="eyebrow pad">${heading}</h3>` : '') +
    (list.slice(0, 60).map(s => `
      <button class="picker-row" data-id="${s.id}">
        <span><strong>${esc(s.name)}</strong>${s.street ? `<small>${esc(s.street)}</small>` : ''}</span>
        <span class="chips">${s.lineIds.map(id => lineBadge(net.linesById[id])).join('')}</span>
      </button>`).join('') || '<p class="muted pad">No matching stations.</p>');
  pickerList.querySelectorAll('.picker-row').forEach(b => b.onclick = () => {
    const key = picking;
    closePicker();
    setStation(key, net.stationsById[b.dataset.id]);
  });
}

// ── planning ─────────────────────────────────────────────────
async function plan() {
  syncUrl();
  const results = $('#results');
  state.plan = null;
  refreshTabs();
  view && view.set({ route: null });

  if (!state.from || !state.to) {
    results.innerHTML = '<p class="hint">Pick a start and a destination to compare routes.</p>';
    view && view.fitAll();
    return;
  }
  if (state.from.id === state.to.id) {
    results.innerHTML = '<p class="hint">Your start and destination are the same station.</p>';
    return;
  }

  const token = ++planToken; // ignore out-of-date responses if the user changes stations quickly
  results.innerHTML = '<div class="empty"><div class="spinner"></div>Finding routes…</div>';
  try {
    const data = await api(`/api/plan?from_station=${state.from.id}&to_station=${state.to.id}`);
    if (token !== planToken) return;
    state.plan = data;
    refreshTabs();
    renderRoute();
  } catch (e) {
    if (token !== planToken) return;
    results.innerHTML = `<p class="hint">${esc(e.message)}</p>`;
  }
}

function refreshTabs() {
  const items = MODES.map(m => {
    const r = state.plan && state.plan.routes[m.id];
    return { id: m.id, label: m.label, sub: r && r.found ? fmtMin(r.totalSeconds) : '' };
  });
  if (!modeTabs) {
    modeTabs = Tabs({ items, active: state.mode, label: 'Routing preference', onChange: id => { state.mode = id; syncUrl(); renderRoute(); } });
    $('#modeTabs').append(modeTabs.el);
  } else {
    modeTabs.setItems(items, true);
    modeTabs.select(state.mode, { silent: true });
  }
}

const modeLabel = id => (MODES.find(m => m.id === id) || {}).label || id;

function renderRoute() {
  const results = $('#results');
  const data = state.plan;
  if (!data) return;
  const route = data.routes[state.mode];

  if (!route || !route.found) {
    const other = MODES.find(m => data.routes[m.id] && data.routes[m.id].found);
    results.innerHTML = `<p class="hint">No route found between ${esc(state.from.name)} and ${esc(state.to.name)}.${other ? '' : ' These stations may not be connected by any line yet.'}</p>`;
    view.set({ route: null });
    return;
  }

  const wait = net.settings.transfer_penalty_sec;
  const facts = [
    route.transfers ? `${route.transfers} transfer${route.transfers > 1 ? 's' : ''}` : 'No transfers',
    route.walkSeconds ? `${fmtMin(route.walkSeconds)} walking (${fmtMiles(route.walkMiles)})` : 'No walking'
  ];

  let rideIndex = 0;
  const legs = route.legs.map(leg => {
    if (leg.type === 'walk') {
      return `<li class="leg leg-walk"><div class="leg-icon" aria-hidden="true">🚶</div>
        <div class="leg-body"><strong>Walk to ${esc(leg.to.name)}</strong>
        <small>${fmtMin(leg.seconds)} · ${fmtMiles(leg.miles)} from ${esc(leg.from.name)}</small></div></li>`;
    }
    const line = data.lines[leg.line_id] || { id: leg.line_id, name: leg.line_id };
    const waitRow = rideIndex++ > 0
      ? `<li class="leg leg-wait"><div class="leg-icon" aria-hidden="true">⏱</div><div class="leg-body"><small>Allow about ${fmtMin(wait)} to board</small></div></li>` : '';
    const stops = leg.stops.length - 1;
    return `${waitRow}<li class="leg leg-ride" style="--leg:${safeColor(line.color, '#2563EB')}">
      <div class="leg-icon">${lineBadge(line)}</div>
      <div class="leg-body">
        <strong>${esc(line.name)} <span class="toward">toward ${esc(leg.headsign)}</span></strong>
        <small>${esc(leg.from.name)} → ${esc(leg.to.name)} · ${fmtMin(leg.seconds)}</small>
        <details><summary>${stops} stop${stops === 1 ? '' : 's'}</summary>
          <ol class="stop-list">${leg.stops.map(s => `<li>${esc(s.name)}</li>`).join('')}</ol></details>
      </div></li>`;
  }).join('');

  results.innerHTML = `
    <div class="route-summary">
      <div class="route-time"><strong>${Math.max(1, Math.round(route.totalSeconds / 60))}</strong><span>min</span></div>
      <ul class="facts">${facts.map(f => `<li>${esc(f)}</li>`).join('')}</ul>
    </div>
    ${route.same_as ? `<p class="same-note">Same route as “${esc(modeLabel(route.same_as))}” — it's the best option for this trip either way.</p>` : ''}
    <ol class="timeline">
      <li class="leg leg-end"><div class="leg-icon"><span class="od-dot from"></span></div><div class="leg-body"><strong>${esc(state.from.name)}</strong></div></li>
      ${legs}
      <li class="leg leg-end"><div class="leg-icon"><span class="od-dot to"></span></div><div class="leg-body"><strong>${esc(state.to.name)}</strong></div></li>
    </ol>
    <div class="route-actions">
      <button class="btn btn-primary" id="saveBtn">Save journey</button>
      <button class="btn btn-ghost" id="shareBtn">Share</button>
    </div>`;

  $('#saveBtn').onclick = saveJourney;
  $('#shareBtn').onclick = share;
  view.set({ route });
  view.fitRoute(route);
}

async function saveJourney() {
  if (!Auth.loggedIn) { toast('Sign in to save journeys'); $('#accountBtn').click(); return; }
  try {
    await api('/api/journeys', { method: 'POST', body: JSON.stringify({
      from_station_id: state.from.id, to_station_id: state.to.id, from_name: state.from.name, to_name: state.to.name
    }) });
    toast('Journey saved');
  } catch (e) { toast(e.message); }
}

async function share() {
  const url = location.href;
  try {
    if (navigator.share) await navigator.share({ title: 'City Metro trip', url });
    else { await navigator.clipboard.writeText(url); toast('Link copied'); }
  } catch { /* user cancelled */ }
}

// ── boot ─────────────────────────────────────────────────────
async function boot() {
  const results = $('#results');
  try { net = await loadNetwork(); }
  catch (e) { results.innerHTML = `<p class="hint">Couldn't load the network. ${esc(e.message)}</p>`; return; }

  view = new MapView({
    wrap: $('#planMapWrap'), canvas: $('#planCanvas'), net,
    insets: () => ({ top: 70, right: 20, bottom: 20, left: wide() ? 440 : 20 }),
    // Tap a station on the map to fill the first empty field (destination if both are set).
    onStation: s => setStation(!state.from ? 'from' : !state.to ? 'to' : 'to', s)
  });

  const q = new URLSearchParams(location.search);
  state.from = net.stationsById[q.get('from')] || null;
  state.to = net.stationsById[q.get('to')] || null;
  if (MODES.some(m => m.id === q.get('mode'))) state.mode = q.get('mode');

  paintFields();
  refreshTabs();
  view.fitAll();
  if (state.from && state.to) plan();
}

boot();
