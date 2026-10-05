// Map page: network overview + station card.
//
// Tabs (replaces the old swipe pages):
//   station card:  Departures | Walk | Alerts
//   departures:    one chip per line  ->  one segmented toggle per direction
// Everything is tap / keyboard driven. To bring swiping back, pass
// `swipePanel` to Tabs() in showDepartures() — nothing else changes.
import { api, loadNetwork, refreshVehicles } from './api.js';
import { mountChrome, $, esc, lineBadge, safeColor, Tabs, toast, fmtMin, fmtMiles } from './ui.js';
import { MapView } from './mapview.js';
import { departures } from './arrivals.js';

mountChrome('map');

const sheet = $('#sheet');
const body = $('#sheetBody');
const TYPE_LABEL = { hub: 'Transit hub', station: 'Rail station', stop: 'Bus stop' };
const wide = () => window.matchMedia('(min-width: 900px)').matches;

let net, view, openStationId = null;

// ── sheet ────────────────────────────────────────────────────
function setSheet(state) {
  sheet.dataset.state = state;
  view && view.render();
}
$('#sheetHandle').onclick = () => setSheet(sheet.dataset.state === 'open' ? 'peek' : 'open');

const insets = () => wide()
  ? { top: 70, right: 20, bottom: 20, left: 420 }
  : { top: 130, right: 10, bottom: sheet.dataset.state === 'open' ? innerHeight * 0.58 : 250, left: 10 };

// ── overview (nothing selected) ──────────────────────────────
async function showOverview() {
  openStationId = null;
  view.set({ selectedId: null });
  history.replaceState(null, '', location.pathname);

  const rows = net.lines.map(l => {
    const n = (net.vehicles || []).filter(v => v.line_id === l.id).length;
    const active = view.focusLine === l.id;
    return `<button class="line-row${active ? ' is-active' : ''}" data-line="${esc(l.id)}">
      ${lineBadge(l, 'lg')}
      <span class="line-row-main"><strong>${esc(l.name)}</strong>
        <small>${l.type === 'rail' ? 'Rail' : 'Bus'}${l.frequency ? ' · ' + esc(l.frequency) : ''}${l.description ? ' · ' + esc(l.description) : ''}</small></span>
      <span class="line-row-count">${n ? `${n} running` : 'idle'}</span>
    </button>`;
  }).join('');

  body.innerHTML = `
    <h2 class="sheet-title">City Metro network</h2>
    <div id="advisories"></div>
    <div class="line-list">${rows || '<p class="muted">No lines yet.</p>'}</div>
    ${view.focusLine ? '<button class="btn btn-ghost btn-block" id="clearFocus">Show all lines</button>' : ''}`;

  body.querySelectorAll('.line-row').forEach(b => b.onclick = () => {
    const same = view.focusLine === b.dataset.line;
    view.set({ focusLine: same ? null : b.dataset.line });
    same ? view.fitAll() : view.fitLine(b.dataset.line);
    showOverview();
  });
  const clear = $('#clearFocus');
  if (clear) clear.onclick = () => { view.set({ focusLine: null }); view.fitAll(); showOverview(); };
  loadAdvisories($('#advisories'), '');
}

async function loadAdvisories(el, query) {
  try {
    const list = await api('/api/advisories' + query);
    el.innerHTML = list.slice(0, 4).map(a => `
      <div class="advisory ${esc(a.severity)}" role="note">
        <strong>${a.line_id ? lineBadge({ id: a.line_id, color: a.color, text_color: a.text_color }) + ' ' : ''}${esc(a.title)}</strong>
        <p>${esc(a.body)}</p>
      </div>`).join('') || (query ? '<p class="muted pad">No active alerts.</p>' : '');
  } catch { el.innerHTML = query ? '<p class="muted pad">Alerts unavailable right now.</p>' : ''; }
}

// ── station card ─────────────────────────────────────────────
function showStation(s) {
  openStationId = s.id;
  view.focusStation(s);
  history.replaceState(null, '', `?station=${s.id}`);

  const lines = s.lineIds.map(id => net.linesById[id]).filter(Boolean);
  const primary = lines[0];
  const walkCount = (net.walkFrom[s.id] || []).length;

  body.innerHTML = `
    <div class="station-head" style="background:${safeColor(primary && primary.color, '#111827')};color:${safeColor(primary && primary.text_color, '#fff')}">
      <button class="head-close" id="stationClose" aria-label="Close station">✕</button>
      <div class="eyebrow">${TYPE_LABEL[s.type] || 'Stop'}</div>
      <h2>${esc(s.name)}</h2>
      ${s.street ? `<p>${esc(s.street)}</p>` : ''}
      <div class="head-actions">
        <a href="planner.html?from=${s.id}">Directions from here</a>
        <a href="planner.html?to=${s.id}">Directions to here</a>
      </div>
    </div>
    <div class="station-tabs" id="stationTabs"></div>
    <div class="station-panel" id="stationPanel" aria-live="polite"></div>`;
  $('#stationClose').onclick = () => { setSheet('peek'); showOverview(); };

  const panel = $('#stationPanel');
  const tabs = Tabs({
    label: 'Station information', variant: 'underline', active: 'departures',
    items: [
      { id: 'departures', label: 'Departures' },
      { id: 'walk', label: 'Walk', sub: walkCount ? String(walkCount) : '' },
      { id: 'alerts', label: 'Alerts' }
    ],
    onChange: id => ({ departures: showDepartures, walk: showWalk, alerts: showAlerts })[id](s, panel)
  });
  $('#stationTabs').append(tabs.el);
  showDepartures(s, panel);
  setSheet('open');
}

// Departures: line chips  ->  direction toggle  ->  arrival times
function showDepartures(s, panel, keep = {}) {
  const lines = s.lineIds.map(id => net.linesById[id]).filter(Boolean);
  if (!lines.length) { panel.innerHTML = '<p class="muted pad">No lines serve this stop yet.</p>'; return; }

  let lineId = keep.lineId && lines.some(l => l.id === keep.lineId) ? keep.lineId : lines[0].id;
  let dirId = keep.dirId ?? 0;

  panel.innerHTML = `<div id="lineTabs"></div><div id="dirTabs"></div><div id="etaList" class="eta-list"></div>`;
  const etaEl = $('#etaList', panel);

  const paintEtas = () => {
    const dirs = departures(s.id, lineId, net);
    const dir = dirs[Math.min(dirId, dirs.length - 1)];
    if (!dir) { etaEl.innerHTML = `<p class="muted pad">${dirs.length ? 'This is the last stop on the line.' : 'No departure data for this line yet.'}</p>`; return; }
    etaEl.innerHTML = dir.etas.length
      ? dir.etas.map((m, i) => `<div class="eta-row${i === 0 ? ' next' : ''}"><span>${i === 0 ? 'Next' : 'Then'}</span><strong>${m} min</strong></div>`).join('')
      : '<p class="muted pad">No vehicles in service toward this stop right now.</p>';
  };
  const paintDirs = () => {
    const dirs = departures(s.id, lineId, net);
    const host = $('#dirTabs', panel);
    host.innerHTML = '';
    if (dirs.length > 1) {
      const t = Tabs({
        label: 'Direction', active: String(Math.min(dirId, dirs.length - 1)),
        items: dirs.map((d, i) => ({ id: String(i), label: `To ${d.headsign}` })),
        onChange: id => { dirId = +id; paintEtas(); }
      });
      host.append(t.el);
    } else if (dirs.length === 1) host.innerHTML = `<p class="dir-single">To <strong>${esc(dirs[0].headsign)}</strong></p>`;
  };

  if (lines.length > 1) {
    $('#lineTabs', panel).append(Tabs({
      label: 'Lines at this station', variant: 'chips', active: lineId,
      items: lines.map(l => ({ id: l.id, html: `${lineBadge(l)} <span>${esc(l.name)}</span>`, color: l.color, text: l.text_color })),
      onChange: id => { lineId = id; dirId = 0; paintDirs(); paintEtas(); }
    }).el);
  } else {
    $('#lineTabs', panel).innerHTML = `<div class="single-line">${lineBadge(lines[0], 'lg')}<strong>${esc(lines[0].name)}</strong></div>`;
  }
  paintDirs(); paintEtas();
  panel.dataset.line = lineId;
}

// Walk: other stations you can walk to from here (NEW)
function showWalk(s, panel) {
  const links = (net.walkFrom[s.id] || []).slice().sort((a, b) => a.seconds - b.seconds);
  if (!links.length) {
    panel.innerHTML = '<p class="muted pad">No other stations within walking distance.</p>';
    return;
  }
  panel.innerHTML = `<p class="muted pad">Stations you can walk to from here. Trip plans use these as transfers.</p>` + links.map(l => {
    const o = net.stationsById[l.id];
    if (!o) return '';
    const chips = o.lineIds.map(id => lineBadge(net.linesById[id])).join('');
    return `<div class="walk-row">
      <button class="walk-main" data-open="${o.id}"><strong>${esc(o.name)}</strong><span class="chips">${chips}</span>
        <small>${fmtMin(l.seconds)} walk · ${fmtMiles(l.miles)}</small></button>
      <a class="btn btn-small" href="planner.html?from=${s.id}&to=${o.id}">Go</a>
    </div>`;
  }).join('');
  panel.querySelectorAll('[data-open]').forEach(b => b.onclick = () => showStation(net.stationsById[b.dataset.open]));
}

function showAlerts(s, panel) {
  panel.innerHTML = '<div id="alertList"></div>';
  loadAdvisories($('#alertList', panel), `?station_id=${s.id}&line_id=${encodeURIComponent(s.lineIds.join(','))}`);
}

// ── boot ─────────────────────────────────────────────────────
async function boot() {
  try { net = await loadNetwork(); }
  catch (e) {
    body.innerHTML = `<div class="empty">Couldn't load the network.<br><small>${esc(e.message)}</small>
      <button class="btn btn-primary" id="retry">Try again</button></div>`;
    $('#retry').onclick = boot;
    return;
  }

  view = new MapView({
    wrap: $('#mapWrap'), canvas: $('#mapCanvas'), net, insets,
    onStation: showStation,
    onVehicle: v => {
      const l = net.linesById[v.line_id];
      toast(`${l ? l.name : 'Vehicle'}${v.headsign ? ' toward ' + v.headsign : ''}${v.next_station_name ? ' · next stop ' + v.next_station_name : ''}`);
    },
    onEmpty: () => { if (openStationId != null) { setSheet('peek'); showOverview(); } }
  });

  $('#zoomIn').onclick = () => view.map.zoomAt(1.3);
  $('#zoomOut').onclick = () => view.map.zoomAt(1 / 1.3);
  $('#zoomFit').onclick = () => { view.set({ focusLine: null }); view.fitAll(); if (openStationId == null) showOverview(); };

  const wanted = new URLSearchParams(location.search).get('station');
  const linked = wanted && net.stationsById[wanted];
  if (linked) showStation(linked);
  else { view.fitAll(); showOverview(); if (wanted) toast("Couldn't find that station"); }

  // Keep vehicles and departures fresh (paused while the tab is hidden).
  setInterval(async () => {
    if (document.hidden) return;
    try {
      await refreshVehicles(net);
      view.render();
      if (openStationId != null && $('#stationTabs .is-active')?.dataset.id === 'departures') {
        const panel = $('#stationPanel');
        const dirTab = $('#dirTabs .is-active');
        showDepartures(net.stationsById[openStationId], panel, { lineId: panel.dataset.line, dirId: dirTab ? +dirTab.dataset.id : 0 });
      }
    } catch { /* keep showing the last good data */ }
  }, 15000);
}

boot();
