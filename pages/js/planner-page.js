// Trip planner. Views:
//   search  – pick start / destination (inline suggestions)          [Transit screenshot 2]
//   options – mode tabs (fastest / fewest transfers / least walking)   [screenshot 3]
//   detail  – route guide: summary, LIVE arrivals, all steps           [screenshots 4–5]
//   vehicle – tap ONE live vehicle (list or map): "N stops away", next stop, GO / ARRIVE AT  [vehicle sheet]
//   nav     – one step at a time, "Next step" … "Finish"
//   done    – "Journey complete"
// Live arrivals appear only here (bus.png / trains.png icons on a black chip).
import { api, Auth, loadNetwork } from './api.js';
import { MODES } from './config.js';
import { mountChrome, $, esc, lineBadge, safeColor, Tabs, toast, fmtMin, fmtMiles, fmtClock, ICON, liveIcon } from './ui.js';
import { MapView } from './mapview.js';
import { departures, trackVehicle } from './arrivals.js';
import { vehicleSheet, vehicleRows, trackedMark } from './vehiclesheet.js';
import { renderLineScreen } from './linescreen.js';

mountChrome('plan');

const app = $('#app'), side = $('#side'), body = $('#planBody'), foot = $('#planFoot');
const inputs = { from: $('#fromInput'), to: $('#toInput') };
const S = { from: null, to: null, mode: 'fastest', plan: null, view: 'search', field: 'from', dirty: false, step: 0, loading: false, error: '', t0: Date.now() };
let net, view, modeTabs, planToken = 0;
const wide = () => matchMedia('(min-width: 900px)').matches;

$('#backBtn').innerHTML = ICON.back; $('#swapBtn').innerHTML = ICON.swap;
$('#refreshBtn').innerHTML = ICON.refresh; $('#clearBtn').innerHTML = ICON.close;

// ── recents (per device) ──
const RECENT = 'cm_recent_stations';
const recents = () => { try { return JSON.parse(localStorage.getItem(RECENT)) || []; } catch { return []; } };
const pushRecent = id => { try { localStorage.setItem(RECENT, JSON.stringify([id, ...recents().filter(x => x !== id)].slice(0, 6))); } catch { /* storage off */ } };

const route = () => (S.plan && S.plan.routes[S.mode]) || null;
const modeLabel = id => (MODES.find(m => m.id === id) || {}).label || id;
const lineOf = id => (S.plan && S.plan.lines[id]) || net.linesById[id] || { id, name: id, color: '#374151' };

function syncUrl() {
  const q = new URLSearchParams();
  if (S.from) q.set('from', S.from.id);
  if (S.to) q.set('to', S.to.id);
  if (S.from && S.to && S.mode !== 'fastest') q.set('mode', S.mode);
  history.replaceState(null, '', q.toString() ? `?${q}` : location.pathname);
}

// ── live timing (the only place live arrivals are shown) ──
function boardInfo(r) {
  const leg = r.legs.find(l => l.type === 'ride');
  if (!leg) return null;
  const dirs = departures(leg.from.id, leg.line_id, net);
  const d = dirs.find(x => x.headsign === leg.headsign) || dirs.find(x => x.etas.length) || dirs[0];
  return { leg, line: lineOf(leg.line_id), etas: d ? d.etas : [] };
}
function timing(r) {
  const wait = net.settings.transfer_penalty_sec;
  let walkBefore = 0;
  for (const l of r.legs) { if (l.type === 'ride') break; walkBefore += l.seconds; }
  const b = boardInfo(r), e = b && b.etas[0];
  const boardAt = S.t0 + Math.max(e != null ? e * 60 : 0, walkBefore) * 1000;
  const leaveAt = boardAt - walkBefore * 1000;
  let t = leaveAt, rides = 0;
  const legs = r.legs.map(l => {
    if (l.type === 'ride') { if (rides === 0) t = Math.max(t, boardAt); else t += wait * 1000; rides++; }
    const start = t; t += l.seconds * 1000; return { start, end: t };
  });
  return { leaveAt, arriveAt: t, goIn: e != null ? Math.max(e, Math.ceil(walkBefore / 60)) : null, live: e != null, legs };
}

// ── view switching ──
function setView(v) { S.view = v; app.dataset.view = v; render(); }

function render() {
  const r = route();
  $('#headTitle').textContent = S.from && S.to ? `${S.from.name} → ${S.to.name}` : '';
  ({ search: renderSearch, options: renderOptions, detail: renderDetail, vehicle: renderVehicle, nav: renderNav, done: renderDone })[S.view]();
  requestAnimationFrame(mapSync);
}

const insets = () => wide() ? { top: 20, right: 110, bottom: 20, left: 20 }
  : { top: 20, right: 10, bottom: ['detail', 'nav', 'vehicle'].includes(S.view) ? side.offsetHeight + 10 : 10, left: 10 };

const routeLines = r => new Set(r.legs.filter(l => l.type === 'ride').map(l => l.line_id));
const vehicleById = id => (net.vehicles || []).find(x => String(x.id) === String(id));
function mapSync() {
  if (!view) return;
  const r = route();
  if (S.view === 'search' || !r || !r.found) { view.set({ route: null, activeLeg: null, tracked: null, vehicleLines: null }); return; }
  const lines = routeLines(r);
  if (S.view === 'vehicle') {
    const v = vehicleById(S.vehId), st = net.stationsById[S.vehStation];
    view.set({ route: r, activeLeg: null, vehicleLines: lines, tracked: v ? trackedMark(net, v, S.vehStation) : null });
    view._focus = null;
    if (v) view.map.fit([[v.x, v.y], ...(st ? [[st.x, st.y]] : [])], { maxScale: 1.6, pad: 70, minBox: 220 });
    return;
  }
  if (S.view === 'nav') {
    const leg = r.legs[S.step];
    view.set({ route: r, activeLeg: S.step, tracked: null, vehicleLines: leg.type === 'ride' ? new Set([leg.line_id]) : lines });
    view._focus = null;
    view.map.fit(leg.points, { maxScale: 1.8, pad: 70 });
  } else { view.set({ route: r, activeLeg: null, tracked: null, vehicleLines: lines }); view.fitRoute(r); }
}

// ── search ──
function renderSearch() {
  foot.innerHTML = '';
  const q = S.dirty ? inputs[S.field].value.trim().toLowerCase() : '';
  let list, heading = '';
  if (q) {
    list = net.stations.filter(s => s.name.toLowerCase().includes(q) || (s.street || '').toLowerCase().includes(q) ||
      s.lineIds.some(id => id.toLowerCase() === q || (net.linesById[id]?.name || '').toLowerCase().includes(q)));
  } else {
    const rec = recents().map(id => net.stationsById[id]).filter(Boolean);
    list = [...rec, ...net.stations.filter(s => !rec.includes(s)).sort((a, b) => a.name.localeCompare(b.name))];
    heading = rec.length ? 'Recent' : 'Stops and stations';
  }
  const row = s => `<button class="sug" data-id="${s.id}"><span class="sug-ic">${s.type === 'stop' ? ICON.stop : ICON.station}</span>
    <span class="sug-main"><strong>${esc(s.name)}</strong><span class="chips">${s.lineIds.map(id => lineBadge(net.linesById[id])).join('')}</span></span></button>`;
  const recCount = q ? 0 : recents().filter(id => net.stationsById[id]).length;
  body.innerHTML = (heading ? `<h3 class="eyebrow">${heading}</h3>` : '') +
    (list.slice(0, 60).map((s, i) => (!q && recCount && i === recCount ? '<h3 class="eyebrow">Stops and stations</h3>' : '') + row(s)).join('') || '<p class="hint">No matching stations.</p>');
  body.querySelectorAll('.sug').forEach(b => b.onclick = () => choose(S.field, net.stationsById[b.dataset.id]));
}

function choose(field, st) {
  S[field] = st; inputs[field].value = st.name; pushRecent(st.id); S.dirty = false; S.plan = null; syncUrl();
  const other = field === 'from' ? 'to' : 'from';
  if (!S[other]) { S.field = other; inputs[other].focus(); return; }
  inputs.from.blur(); inputs.to.blur();
  planTrip();
}

for (const f of ['from', 'to']) {
  inputs[f].addEventListener('focus', () => {
    S.field = f; S.dirty = false; inputs[f].select();
    if (S.view !== 'search') { S.view = 'search'; app.dataset.view = 'search'; }
    render();
  });
  inputs[f].addEventListener('input', () => { S.dirty = true; S[f] = null; S.plan = null; renderSearch(); });
}
$('#swapBtn').onclick = () => {
  [S.from, S.to] = [S.to, S.from];
  inputs.from.value = S.from ? S.from.name : ''; inputs.to.value = S.to ? S.to.name : '';
  if (S.from && S.to) planTrip(); else render();
};
$('#clearBtn').onclick = () => { S.from = S.to = S.plan = null; inputs.from.value = inputs.to.value = ''; syncUrl(); S.field = 'from'; setView('search'); inputs.from.focus(); };
$('#refreshBtn').onclick = () => planTrip();
const goBack = () => setView(S.view === 'vehicle' ? (S.vehBack || 'detail') : ({ detail: 'options', nav: 'detail', done: 'options' }[S.view] || 'options'));
$('#backBtn').onclick = goBack;

// ── plan ──
async function planTrip() {
  syncUrl();
  if (!S.from || !S.to) return;
  if (S.from.id === S.to.id) { S.error = 'Your start and destination are the same station.'; S.plan = null; return setView('options'); }
  const token = ++planToken;
  S.loading = true; S.error = ''; S.t0 = Date.now(); setView('options');
  try {
    const data = await api(`/api/plan?from_station=${S.from.id}&to_station=${S.to.id}`);
    if (token !== planToken) return;
    S.plan = data;
  } catch (e) { if (token !== planToken) return; S.plan = null; S.error = e.message; }
  S.loading = false;
  refreshTabs(); render();
}

function refreshTabs() {
  const items = MODES.map(m => { const r = S.plan && S.plan.routes[m.id]; return { id: m.id, label: m.label, sub: r && r.found ? fmtMin(r.totalSeconds) : '' }; });
  if (!modeTabs) {
    modeTabs = Tabs({ items, active: S.mode, label: 'Routing preference', onChange: id => { S.mode = id; syncUrl(); render(); } });
    $('#modeTabs').append(modeTabs.el);
  } else { modeTabs.setItems(items, true); modeTabs.select(S.mode, { silent: true }); }
}

// ── shared pieces ──
function segbar(r, thin = false) {
  return `<div class="segbar" aria-hidden="true">${r.legs.map(l => {
    const flex = Math.max(l.seconds, r.totalSeconds * 0.1);
    if (l.type === 'walk') return `<span class="seg walk${thin ? ' thin' : ''}" style="flex:${flex}">${thin ? '' : ICON.walk.replace('width="20" height="20"', 'width="16" height="16"') + Math.round(l.seconds / 60)}</span>`;
    const ln = lineOf(l.line_id);
    return `<span class="seg${thin ? ' thin' : ''}" style="flex:${flex};background:${safeColor(ln.color)};color:${safeColor(ln.text_color, '#fff')}">${thin ? '' : esc(ln.id) + ' · ' + Math.round(l.seconds / 60)}</span>`;
  }).join('')}</div>`;
}
const facts = r => [r.transfers ? `${r.transfers} transfer${r.transfers > 1 ? 's' : ''}` : 'No transfers', r.walkSeconds ? `${fmtMin(r.walkSeconds)} walking` : 'No walking']
  .map(f => `<span class="fact">${esc(f)}</span>`).join('');

// ── options ──
function renderOptions() {
  foot.innerHTML = '';
  if (S.loading) { body.innerHTML = '<div class="empty"><div class="spinner"></div>Finding routes…</div>'; return; }
  if (S.error) { body.innerHTML = `<p class="hint">${esc(S.error)}</p>`; return; }
  const r = route();
  if (!S.plan || !r || !r.found) { body.innerHTML = `<p class="hint">No route found between ${esc(S.from && S.from.name)} and ${esc(S.to && S.to.name)}.<br>These stations may not be connected yet.</p>`; return; }
  const tm = timing(r), b = boardInfo(r);
  const others = MODES.filter(m => m.id !== S.mode && S.plan.routes[m.id] && S.plan.routes[m.id].found);

  body.innerHTML = `
    <article class="route-card" id="routeCard" tabindex="0" role="button" aria-label="Open route guide">
      <div class="rc-top"><div><span class="rc-min">${Math.max(1, Math.round(r.totalSeconds / 60))}</span><span class="rc-unit">min</span></div>
        <div class="rc-times">${fmtClock(tm.leaveAt)} → ${fmtClock(tm.arriveAt)}</div></div>
      ${segbar(r)}
      <div class="rc-meta">${facts(r)}</div>
      <div class="rc-go">${tm.live && b ? `Go in <b>${tm.goIn} min</b> ${liveIcon(b.line.type)}` : '<span class="muted">Live times unavailable — showing estimates</span>'}<span class="rc-open">${ICON.chevron}</span></div>
    </article>
    ${r.same_as ? `<p class="same-note">Same route as “${esc(modeLabel(r.same_as))}” — it's the best choice for this trip either way.</p>` : ''}
    ${others.length ? '<h3 class="eyebrow">Other options</h3>' : ''}
    ${others.map(m => { const o = S.plan.routes[m.id]; return `<button class="alt-row" data-mode="${m.id}"><span><strong>${esc(m.label)}</strong><small>${o.same_as ? 'Same route as ' + esc(modeLabel(o.same_as)) : o.transfers + ' transfer' + (o.transfers === 1 ? '' : 's') + ' · ' + (o.walkSeconds ? fmtMin(o.walkSeconds) + ' walking' : 'no walking')}</small></span><span class="alt-time">${Math.max(1, Math.round(o.totalSeconds / 60))} min</span></button>`; }).join('')}`;
  const open = () => setView('detail');
  $('#routeCard').onclick = open;
  $('#routeCard').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); open(); } };
  body.querySelectorAll('.alt-row').forEach(el => el.onclick = () => { S.mode = el.dataset.mode; modeTabs.select(S.mode, { silent: true }); syncUrl(); render(); });
}

// ── route guide (all steps) ──
function renderDetail() {
  const r = route();
  if (!r || !r.found) return setView('options');
  const tm = timing(r), b = boardInfo(r), wait = net.settings.transfer_penalty_sec;
  let rides = 0;
  const steps = r.legs.map((l, i) => {
    const t = tm.legs[i];
    if (l.type === 'walk') return `<li class="step walk">${ICON.walk}<span>Walk ${fmtMin(l.seconds)} to ${esc(l.to.name)} <span class="muted">· ${fmtMiles(l.miles)}</span></span></li>`;
    const ln = lineOf(l.line_id), n = l.stops.length - 1;
    const wt = rides++ > 0 ? `<li class="wait-note">Transfer — allow about ${fmtMin(wait)} to board</li>` : '';
    return `${wt}<li class="step ride" style="--c:${safeColor(ln.color)}">
      <div class="step-line tap" role="button" tabindex="0" data-line="${esc(ln.id)}" data-station="${l.from.id}" aria-label="Open ${esc(ln.name)}">${lineBadge(ln, 'lg')}<div><strong>${ICON.arrow.replace('width="20" height="20"', 'width="16" height="16"')} ${esc(l.headsign)}</strong><small>${esc(ln.name)}</small></div></div>
      <div class="stop-row"><span>${esc(l.from.name)}</span><span>${fmtClock(t.start)}</span></div>
      <details><summary>${n} stop${n === 1 ? '' : 's'}</summary><ol class="stoplist" style="--c:${safeColor(ln.color)}">${l.stops.slice(1, -1).map(s => `<li>${esc(s.name)}</li>`).join('') || '<li class="muted">Non-stop</li>'}</ol></details>
      <div class="stop-row"><span>${esc(l.to.name)}</span><span>${fmtClock(t.end)}</span></div></li>`;
  }).join('');

  const tiles = b && b.etas.length
    ? `<div class="tiles">${b.etas.slice(0, 4).map((m, i) => `<div class="tile${i ? '' : ' first'}">${i ? '' : liveIcon(b.line.type)}<b>${m}</b><span class="u">minutes</span></div>`).join('')}</div>`
    : '<p class="muted">No live vehicles are heading to this stop right now — times are estimates.</p>';
  const seenLine = new Set();
  const vehicles = r.legs.filter(l => l.type === 'ride' && !seenLine.has(l.line_id) && seenLine.add(l.line_id))
    .map(l => `<div class="tiles-row"><h3 class="eyebrow">Live vehicles on ${esc(lineOf(l.line_id).name)}</h3><div class="ls-vehs">${vehicleRows(net, l.line_id, l.from.id)}</div></div>`).join('');

  body.innerHTML = `
    <div class="summary">
      <h2>Leave at ${fmtClock(tm.leaveAt)}</h2>
      <div class="summary-row"><span>Arrive at ${fmtClock(tm.arriveAt)}</span><span>${Math.max(1, Math.round(r.totalSeconds / 60))} min</span></div>
      ${segbar(r, true)}
    </div>
    ${b ? `<div class="tiles-row"><h3 class="eyebrow">Next ${esc(b.line.name)} at ${esc(b.leg.from.name)}</h3>${tiles}</div>` : ''}
    <div class="facts-row"><span class="fact">${esc(modeLabel(S.mode))}</span>${facts(r)}</div>
    ${vehicles}
    <ol class="steps">${steps}</ol>
    <div class="dest-card">${ICON.pin}<span>${esc(S.to.name)}</span><span>${fmtClock(tm.arriveAt)}</span></div>`;

  foot.innerHTML = `<button class="btn-sec" id="saveBtn">Save</button><button class="btn-sec" id="shareBtn">Share</button><button class="btn-go" id="goBtn">GO</button>`;
  $('#goBtn').onclick = () => { S.step = 0; side.dataset.state = 'peek'; setView('nav'); };
  $('#saveBtn').onclick = saveJourney; $('#shareBtn').onclick = share;
  bindVehicleRows('preview');
  bindLineTaps();
}

// ── step-by-step ──
function describe(l) {
  return l.type === 'walk' ? `walk to ${l.to.name}` : `take ${lineOf(l.line_id).name} toward ${l.headsign}`;
}
function renderNav() {
  const r = route();
  if (!r || !r.found) return setView('options');
  const n = r.legs.length, i = Math.min(S.step, n - 1), l = r.legs[i], tm = timing(r), t = tm.legs[i], last = i === n - 1;
  let card, nextUp;
  if (l.type === 'walk') {
    card = `<div class="nav-card"><div class="nav-ic"><span class="glyph">${ICON.walk}</span><span class="nav-step-label">Walk</span></div>
      <h2>Walk to ${esc(l.to.name)}</h2><p class="sub">${fmtMin(l.seconds)} · ${fmtMiles(l.miles)}</p>
      <p class="muted">Follow the dotted path on the map from ${esc(l.from.name)}.</p></div>`;
  } else {
    const ln = lineOf(l.line_id), stops = l.stops.length - 1, first = r.legs.findIndex(x => x.type === 'ride') === i;
    const b = first ? boardInfo(r) : null;
    card = `<div class="nav-card ride" style="--c:${safeColor(ln.color)}"><div class="nav-ic tap" role="button" tabindex="0" data-line="${esc(ln.id)}" data-station="${l.from.id}" aria-label="Open ${esc(ln.name)}">${lineBadge(ln, 'xl')}<span class="nav-step-label">${esc(ln.name)}</span></div>
      <h2>Board toward ${esc(l.headsign)}</h2>
      <p class="sub">${esc(l.from.name)} → ${esc(l.to.name)}</p>
      <h4 class="eyebrow" style="margin-left:0">Live vehicles on ${esc(ln.name)}</h4><div class="ls-vehs">${vehicleRows(net, ln.id, l.from.id)}</div>
      ${first ? '' : `<p class="muted">Allow about ${fmtMin(net.settings.transfer_penalty_sec)} to board.</p>`}
      <div class="stop-row"><span>Board · ${esc(l.from.name)}</span><span>${fmtClock(t.start)}</span></div>
      <details><summary>${stops} stop${stops === 1 ? '' : 's'} on this ride</summary><ol class="stoplist" style="--c:${safeColor(ln.color)}">${l.stops.slice(1, -1).map(s => `<li>${esc(s.name)}</li>`).join('') || '<li class="muted">Non-stop</li>'}</ol></details>
      <div class="stop-row"><span>Get off · ${esc(l.to.name)}</span><span>${fmtClock(t.end)}</span></div></div>`;
  }
  const nx = r.legs[i + 1];
  nextUp = last ? `After this you'll arrive at ${esc(S.to.name)}.`
    : nx.type === 'ride' && l.type === 'ride' ? `Next: transfer at ${esc(l.to.name)} and ${esc(describe(nx))}.` : `Next: ${esc(describe(nx))}.`;

  body.innerHTML = `<div class="nav-top"><span class="nav-step-label">Step ${i + 1} of ${n}</span>
    <div class="nav-dots">${r.legs.map((_, k) => `<i class="${k <= i ? 'on' : ''}"></i>`).join('')}</div></div>${card}<p class="next-up">${nextUp}</p>`;
  foot.innerHTML = `<button class="btn-sec" id="prevBtn">${i === 0 ? 'Overview' : 'Back'}</button><button class="btn-go" id="nextBtn">${last ? 'Finish' : 'Next step'}</button>`;
  $('#prevBtn').onclick = () => { if (i === 0) setView('detail'); else { S.step = i - 1; render(); } };
  $('#nextBtn').onclick = () => { if (last) setView('done'); else { S.step = i + 1; render(); } };
  bindVehicleRows('riding');
  bindLineTaps();
  S.step = i;
}

// ── one vehicle's sheet: before GO ("preview") and while riding ("riding") ──
function contextStation() {
  const r = route();
  if (!r || !r.found) return null;
  if (S.view === 'nav') { const l = r.legs[S.step]; return l && l.type === 'ride' ? l.from.id : null; }
  const b = boardInfo(r);
  return b ? b.leg.from.id : null;
}
function openVehicle(id, mode, stationId) {
  S.vehId = id; S.vehMode = mode; S.vehStation = stationId; S.vehBack = mode === 'riding' ? 'nav' : 'detail';
  setView('vehicle');
}
function bindVehicleRows(mode) {
  body.querySelectorAll('[data-vehicle]').forEach(el => el.onclick = () => openVehicle(el.dataset.vehicle, mode, el.dataset.station ? +el.dataset.station : null));
}
function renderVehicle() {
  const r = route();
  if (!r || !r.found) return setView('options');
  const v = vehicleById(S.vehId);
  if (!v) return setView(S.vehBack || 'detail');
  const kind = lineOf(v.line_id).type === 'rail' ? 'train' : 'bus';
  body.innerHTML = vehicleSheet({ net, v, stationId: S.vehStation, mode: S.vehMode, arriveAt: timing(r).arriveAt }) +
    (S.vehMode === 'preview' ? `<p class="veh-follow">Tap <span class="go-pill">GO</span> to follow this ${kind} on your trip</p>` : '');
  if (S.vehMode === 'preview') {
    foot.innerHTML = `<button class="btn-sec" id="vBack">Back</button><button class="btn-go" id="goBtn">GO</button>`;
    $('#goBtn').onclick = () => { S.step = 0; side.dataset.state = 'peek'; setView('nav'); };
  } else {
    foot.innerHTML = `<button class="btn-sec" id="vBack">Back</button><button class="btn-go" id="vSteps">Back to steps</button>`;
    $('#vSteps').onclick = goBack;
  }
  $('#vBack').onclick = goBack;
}

// ── a line's own menu, opened from any ride in the guide ──
let lineCtl = null;
function closeLineOverlay() { const ov = $('#lineOverlay'); if (ov) ov.hidden = true; if (lineCtl) { lineCtl.destroy(); lineCtl = null; } }
function openLineOverlay(lineId, stationId = null) {
  let ov = $('#lineOverlay');
  if (!ov) {
    document.body.insertAdjacentHTML('beforeend', '<div class="overlay" id="lineOverlay" hidden><div class="dialog ls-dialog" id="lineDialog" role="dialog" aria-modal="true"></div></div>');
    ov = $('#lineOverlay');
    ov.addEventListener('click', e => { if (e.target === ov) closeLineOverlay(); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLineOverlay(); });
  }
  if (lineCtl) lineCtl.destroy();
  lineCtl = renderLineScreen($('#lineDialog'), { net, lineId, stationId, backLabel: 'Close', onBack: closeLineOverlay, onStation: () => {} });
  ov.hidden = false;
}
function bindLineTaps() {
  body.querySelectorAll('[data-line]').forEach(el => {
    const go = () => openLineOverlay(el.dataset.line, el.dataset.station ? +el.dataset.station : null);
    el.onclick = go; el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
}

// ── journey complete ──
function renderDone() {
  const r = route();
  body.innerHTML = `<div class="done">
    <div class="done-check">${ICON.check}</div>
    <h2>Journey complete</h2>
    <p class="muted">You've arrived at <strong>${esc(S.to.name)}</strong>.</p>
    <div class="done-stats"><div><b>${r ? Math.max(1, Math.round(r.totalSeconds / 60)) : '–'}</b><span>MINUTES</span></div><div><b>${r ? r.transfers : 0}</b><span>TRANSFERS</span></div><div><b>${r ? Math.round(r.walkSeconds / 60) : 0}</b><span>MIN WALKING</span></div></div>
    <div class="done-actions">
      <button class="btn btn-primary" id="newTrip">Plan another trip</button>
      <button class="btn btn-ghost" id="saveDone">Save this journey</button>
      <a class="btn btn-ghost" href="index.html">Back to the map</a>
    </div></div>`;
  foot.innerHTML = '';
  $('#newTrip').onclick = () => $('#clearBtn').click();
  $('#saveDone').onclick = saveJourney;
}

async function saveJourney() {
  if (!Auth.loggedIn) { toast('Sign in to save journeys'); $('#accountBtn').click(); return; }
  try {
    await api('/api/journeys', { method: 'POST', body: JSON.stringify({ from_station_id: S.from.id, to_station_id: S.to.id, from_name: S.from.name, to_name: S.to.name }) });
    toast('Journey saved');
  } catch (e) { toast(e.message); }
}
async function share() {
  try { if (navigator.share) await navigator.share({ title: 'City Metro trip', url: location.href }); else { await navigator.clipboard.writeText(location.href); toast('Link copied'); } } catch { /* cancelled */ }
}

// ── bottom sheet handle (mobile, detail view) ──
$('#sideHandle').onclick = () => { side.dataset.state = side.dataset.state === 'open' ? 'peek' : 'open'; setTimeout(mapSync, 60); };

// ── boot ──
(async function boot() {
  try { net = await loadNetwork(); }
  catch (e) { body.innerHTML = `<p class="hint">Couldn't load the network. ${esc(e.message)}</p>`; return; }
  view = new MapView({
    wrap: $('#planMapWrap'), canvas: $('#planCanvas'), net, insets,
    onStation: s => { if (S.view === 'search' || !S.from || !S.to) choose(S.field, s); },
    onVehicle: v => openVehicle(v.id, S.view === 'nav' ? 'riding' : 'preview', contextStation())
  });
  view.map.onResize = () => mapSync();
  $('#zoomIn').onclick = () => view.map.zoomAt(1.3);
  $('#zoomOut').onclick = () => view.map.zoomAt(1 / 1.3);
  $('#zoomFit').onclick = () => { const r = route(); r && r.found ? view.fitRoute(r) : view.fitAll(); };
  refreshTabs();

  const q = new URLSearchParams(location.search);
  S.from = net.stationsById[q.get('from')] || null; S.to = net.stationsById[q.get('to')] || null;
  if (MODES.some(m => m.id === q.get('mode'))) S.mode = q.get('mode');
  if (S.from) inputs.from.value = S.from.name; if (S.to) inputs.to.value = S.to.name;
  refreshTabs();
  view.fitAll();
  if (S.from && S.to) planTrip();
  else { S.field = S.from ? 'to' : 'from'; render(); if (innerWidth >= 900 || S.from) inputs[S.field].focus({ preventScroll: true }); }

  setInterval(async () => { /* keep live arrivals fresh while the guide is open */
    if (document.hidden || !['options', 'detail', 'vehicle', 'nav'].includes(S.view) || !S.plan) return;
    try { const { refreshVehicles } = await import('./api.js'); await refreshVehicles(net); S.t0 = Date.now(); render(); } catch { /* keep last good data */ }
  }, 15000);
})();
