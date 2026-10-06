// Map page.
//  • Starts around Union Station; tap the map to move "you are here".
//  • "Options near": one row per line, with the NEXT vehicle (minutes + live icon).
//    Outbound / Inbound = tabs on desktop, swipeable on mobile.
//  • Tap a row (or a vehicle on the map) -> that line's own menu (linescreen.js).
//  • Tap a station -> popup with next arrivals per direction, sorted by line, plus the lines' stop lists.
//  • Advisories, walking connections and the full live board live on the line screen / route guide, not here.
import { loadNetwork, refreshVehicles } from './api.js';
import { SHOW_LIVE_ON_MAP } from './config.js';
import { mountChrome, $, esc, lineBadge, safeColor, Tabs, Pager, toast, ICON, liveIcon } from './ui.js';
import { MapView } from './mapview.js';
import { renderLineScreen } from './linescreen.js';
import { nearbyServices, nearestStation, nearestStreet, stationBoard, lineStops, walkMinutes } from './arrivals.js';

mountChrome('map');

const side = $('#side'), body = $('#sideBody'), popup = $('#popup');
const TYPE_LABEL = { hub: 'Transit hub', station: 'Rail station', stop: 'Bus stop' };
const DIRS = [['outbound', 'Outbound'], ['inbound', 'Inbound']];
const wide = () => matchMedia('(min-width: 900px)').matches;
$('#searchIc').innerHTML = ICON.search;

let net, view, pin, openId = null, nearPager = null, popPager = null, lineCtl = null;
let mode = 'nearby', nearDir = 'outbound', popDir = 'outbound';

// ── visible part of the map, so centring works with panels open ──
function insets() {
  if (wide()) return { top: 64, right: 60, bottom: 20, left: openId != null ? 420 : 20 };
  const peek = parseInt(getComputedStyle(side).getPropertyValue('--peek')) || 300;
  const bottom = openId != null ? popup.offsetHeight : side.dataset.state === 'open' ? side.offsetHeight : peek;
  return { top: 70, right: 10, bottom: bottom + 10, left: 10 };
}
const settle = () => setTimeout(() => view && view.reframe(), 320);
function setSide(state) { side.dataset.state = state; settle(); }
(() => {
  const h = $('#sideHandle'); let y0 = null;
  h.addEventListener('pointerdown', e => { y0 = e.clientY; h.setPointerCapture(e.pointerId); });
  h.addEventListener('pointerup', e => {
    if (y0 == null) return;
    const dy = e.clientY - y0; y0 = null;
    if (dy < -30) setSide('open'); else if (dy > 30) setSide('peek'); else setSide(side.dataset.state === 'open' ? 'peek' : 'open');
  });
})();

// ── "you are here" + nearby ──
function setPin(p) { pin = p; view.set({ pin }); if (mode === 'nearby') renderNearby(true); }

// The mark in front of a row: the line's own image as-is, else a rail badge, else the bus number.
function lineMark(l) {
  if (l.image_url || l.type === 'rail') return lineBadge(l, 'xl');
  return `<span class="svc-num" style="--c:${safeColor(l.color, '#111827')}">${esc(l.id)}</span>`;
}
function nextEta(etas, type) {
  return SHOW_LIVE_ON_MAP && etas.length
    ? `<span class="svc-eta">${liveIcon(type)}<b>${etas[0]}</b><small>minutes</small></span>`
    : `<span class="svc-eta none"><small>No live<br>vehicle</small></span>`;
}
function rowsHtml(rows, label) {
  if (!rows.length) return `<p class="hint">No ${label} services nearby.</p>`;
  return rows.map(r => `<button class="svc" data-line="${esc(r.line.id)}" data-station="${r.station.id}" aria-label="${esc(r.line.name)} toward ${esc(r.dir.headsign)}">
    <span class="svc-main">${lineMark(r.line)}
      <span class="svc-dest">${ICON.arrow}<span>${esc(r.dir.headsign)}</span></span>
      <span class="svc-stop">${esc(r.station.name)} · ${r.walkMin} min walk</span></span>
    ${nextEta(r.etas, r.line.type)}</button>`).join('');
}
const nearItems = () => {
  const rows = nearbyServices(pin, net, 10);
  return DIRS.map(([id, label]) => ({ id, label, html: rowsHtml(rows.filter(r => r.dir.key === id), label.toLowerCase()) }));
};
function bindRows() { body.querySelectorAll('.svc').forEach(b => b.onclick = () => openLine(b.dataset.line, +b.dataset.station)); }

function renderNearby(keepPager = false) {
  mode = 'nearby';
  const keep = body.scrollTop;
  if (keepPager && nearPager && body.contains(nearPager.el)) {
    nearPager.update(nearItems());
    updateBar();
    bindRows();
    return;
  }
  body.innerHTML = `<button class="near-bar" id="nearBar" aria-label="Centre map on my location"></button>
    <p class="tip">Tap the map to move your location. Tap a service to open that line.</p><div id="pagerHost"></div>`;
  updateBar();
  nearPager = Pager({ items: nearItems(), active: nearDir, label: 'Direction', onChange: id => { nearDir = id; } });
  $('#pagerHost').append(nearPager.el);
  bindRows();
  body.scrollTop = keep;
}
function updateBar() {
  const street = nearestStreet(pin, net), near = nearestStation(pin, net);
  const walk = near ? walkMinutes(near.dist, net) : null;
  const bar = $('#nearBar');
  bar.innerHTML = `<span class="near-ic">${ICON.locate}</span>
    <span class="near-txt"><small>Options near</small><strong>${esc(street || (near && near.station.name) || 'the network')}</strong></span>
    ${walk != null ? `<span class="near-walk">${ICON.walk}<span>${walk} min</span></span>` : ''}`;
  bar.onclick = () => view.focusAt(pin.x, pin.y, Math.max(view.map.scale, 0.9));
}

// ── a line's own menu ──
function openLine(lineId, stationId = null) {
  if (!net.linesById[lineId]) return;
  if (openId != null) closeStation(true);
  mode = 'line'; nearPager = null;
  if (lineCtl) lineCtl.destroy();
  view.set({ focusLine: lineId }); view.fitLine(lineId);
  lineCtl = renderLineScreen(body, {
    net, lineId, stationId, backLabel: 'Nearby',
    onBack: backToNearby, onStation: openStation, onShowMap: () => view.fitLine(lineId)
  });
  body.scrollTop = 0;
  setSide('open');
  history.replaceState(null, '', `?line=${encodeURIComponent(lineId)}`);
}
function backToNearby() {
  if (lineCtl) { lineCtl.destroy(); lineCtl = null; }
  view.set({ focusLine: null });
  history.replaceState(null, '', location.pathname);
  renderNearby();
  view.focusAt(pin.x, pin.y, 0.9);
  setSide('peek');
}

// ── station popup ──
function openStation(s) {
  openId = s.id;
  history.replaceState(null, '', `?station=${s.id}`);
  view.set({ selectedId: s.id });
  popup.hidden = false;
  paintPopup(s);
  view.focusStation(s, Math.max(view.map.scale, 1.1));
  setTimeout(() => view.reframe(), 50);
}
function closeStation(quiet = false) {
  openId = null; popup.hidden = true; popPager = null;
  view.set({ selectedId: null });
  if (!quiet) { history.replaceState(null, '', mode === 'line' && lineCtl ? location.search : location.pathname); settle(); }
}

function popItems(s) {
  const board = stationBoard(s.id, net);
  return DIRS.map(([key, label]) => {
    const cards = board.map(b => {
      const d = b.dirs.find(x => x.key === key);
      if (!d) return '';
      const tiles = SHOW_LIVE_ON_MAP
        ? (d.etas.length ? d.etas.map((m, i) => `<div class="tile${i ? '' : ' first'}">${i ? '' : liveIcon(b.line.type)}<b>${m}</b><span class="u">min</span></div>`).join('') : '<span class="muted">No vehicles in service</span>')
        : '';
      return `<div class="pcard"><button class="pcard-head" data-line="${esc(b.line.id)}">${lineBadge(b.line, 'lg')}
        <span><strong>${esc(b.line.name)}</strong><small>${ICON.arrow} ${esc(d.headsign)}</small></span><span class="svc-go">${ICON.chevron}</span></button>
        <div class="tiles">${tiles}</div></div>`;
    }).join('');
    // On mobile the tab switcher is hidden (you swipe), so each pane says which direction it is.
    const other = key === 'outbound' ? 'Inbound' : 'Outbound', arrow = key === 'outbound' ? 'Swipe for ' + other + ' ›' : '‹ Swipe for ' + other;
    const tag = `<div class="pane-label"><strong>${label}</strong><span>${arrow}</span></div>`;
    return { id: key, label, html: tag + (cards || `<p class="hint">No ${label.toLowerCase()} service at this stop.</p>`) };
  });
}

function slideHtml(b, s) {
  const stops = lineStops(b.line.id, net);
  return `<section class="slide" data-line="${esc(b.line.id)}" style="--c:${safeColor(b.line.color, '#111827')}" aria-label="${esc(b.line.name)}">
    <button class="slide-head" data-line="${esc(b.line.id)}">${lineBadge(b.line, 'lg')}<span><strong>${esc(b.line.name)}</strong><small>${b.line.type === 'rail' ? 'Rail' : 'Bus'}${b.line.frequency ? ' · ' + esc(b.line.frequency) : ''}</small></span><span class="svc-go">${ICON.chevron}</span></button>
    ${stops.length ? `<ol class="stoplist">${stops.map(x => `<li class="${x.id === s.id ? 'here' : ''}"><button data-open="${x.id}">${esc(x.name)}</button></li>`).join('')}</ol>` : ''}</section>`;
}

function paintPopup(s) {
  const board = stationBoard(s.id, net), keepTop = popup.scrollTop;
  popup.innerHTML = `
    <div class="popup-head">
      <button class="popup-close" id="popupClose" aria-label="Close station">${ICON.close}</button>
      <div class="eyebrow">${TYPE_LABEL[s.type] || 'Stop'}</div>
      <h2>${esc(s.name)}</h2>${s.street ? `<p>${esc(s.street)}</p>` : ''}
      <div class="head-actions">
        <a href="planner.html?from=${s.id}">Directions from here</a>
        <a href="planner.html?to=${s.id}">Directions to here</a>
        <button id="imHere">I'm here</button>
      </div>
    </div>
    <h3 class="eyebrow pop-h">Next arrivals</h3><div id="popPager"></div>
    ${board.length ? `<h3 class="eyebrow pop-h">Lines at this station</h3><div id="chipHost"></div><div class="slider" id="slider">${board.map(b => slideHtml(b, s)).join('')}</div>` : ''}`;

  popPager = Pager({ items: popItems(s), active: popDir, label: 'Direction', onChange: id => { popDir = id; } });
  $('#popPager').append(popPager.el);

  $('#popupClose').onclick = () => closeStation();
  $('#imHere').onclick = () => { setPin({ x: s.x, y: s.y }); toast(`Location set to ${s.name}`); };
  popup.querySelectorAll('[data-line]').forEach(b => b.onclick = () => openLine(b.dataset.line, s.id));
  popup.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openStation(net.stationsById[b.dataset.open]));

  const slider = $('#slider', popup);
  if (slider && board.length > 1) {
    const tabs = Tabs({
      label: 'Lines at this station', variant: 'chips', active: board[0].line.id,
      items: board.map(b => ({ id: b.line.id, html: `${lineBadge(b.line)} <span>${esc(b.line.name)}</span>` })),
      onChange: id => { slider.scrollTo({ left: board.findIndex(b => b.line.id === id) * slider.clientWidth, behavior: 'smooth' }); }
    });
    $('#chipHost', popup).append(tabs.el);
    let t;
    slider.addEventListener('scroll', () => { clearTimeout(t); t = setTimeout(() => { const i = Math.round(slider.scrollLeft / slider.clientWidth); if (board[i]) tabs.select(board[i].line.id, { silent: true }); }, 60); });
  }
  popup.scrollTop = keepTop;
}

// ── boot ──
async function boot() {
  try { net = await loadNetwork(); }
  catch (e) {
    body.innerHTML = `<div class="empty">Couldn't load the network.<br><small>${esc(e.message)}</small><button class="btn btn-primary" id="retry">Try again</button></div>`;
    $('#retry').onclick = boot; return;
  }
  view = new MapView({
    wrap: $('#mapWrap'), canvas: $('#mapCanvas'), net, insets,
    showVehicles: false, showWalkLinks: false,   // index.html: no individual vehicles or walking routes on the map
    onStation: openStation,
    onEmpty: w => { if (openId != null) closeStation(); if (mode === 'line') backToNearby(); setPin({ x: w.x, y: w.y }); }
  });
  view.map.onResize = () => view.reframe();

  $('#zoomIn').onclick = () => view.map.zoomAt(1.3);
  $('#zoomOut').onclick = () => view.map.zoomAt(1 / 1.3);
  $('#zoomFit').onclick = () => { view.set({ focusLine: null }); view.fitAll(); };

  // Always start around Union Station.
  const union = net.stations.find(s => /union/i.test(s.name)) || net.stations.find(s => s.type === 'hub') || net.stations[0];
  pin = union ? { x: union.x, y: union.y } : { x: (view.map.bounds.x0 + view.map.bounds.x1) / 2, y: (view.map.bounds.y0 + view.map.bounds.y1) / 2 };
  view.set({ pin });
  renderNearby();
  view.focusAt(pin.x, pin.y, 0.9);

  const q = new URLSearchParams(location.search);
  if (q.get('line') && net.linesById[q.get('line')]) openLine(q.get('line'));
  else if (q.get('station') && net.stationsById[q.get('station')]) openStation(net.stationsById[q.get('station')]);

  setInterval(async () => {
    if (document.hidden) return;
    try {
      await refreshVehicles(net); view.render();
      if (mode === 'nearby') renderNearby(true); else if (lineCtl) lineCtl.refresh();
      if (openId != null) paintPopup(net.stationsById[openId]);
    } catch { /* keep last good data */ }
  }, 15000);
}
boot();
