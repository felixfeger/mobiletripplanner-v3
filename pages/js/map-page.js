// Map page.
//  • Starts around Union Station; tap anywhere on the map to move "you are here".
//  • "Options near" lists the services around that spot. Tapping one opens the planner (planner.html?from=…).
//  • Tapping a station opens a popup with a slider: one slide per line (directions + stops).
//  • Live arrival times are hidden here (SHOW_LIVE_ON_MAP in config.js) — they appear in the trip guide.
import { api, loadNetwork, refreshVehicles } from './api.js';
import { SHOW_LIVE_ON_MAP } from './config.js';
import { mountChrome, $, esc, lineBadge, safeColor, Tabs, toast, fmtMin, fmtMiles, ICON, liveIcon } from './ui.js';
import { MapView } from './mapview.js';
import { nearbyServices, nearestStation, nearestStreet, stationBoard, lineStops, walkMinutes } from './arrivals.js';

mountChrome('map');

const app = $('#app'), side = $('#side'), body = $('#sideBody'), popup = $('#popup');
const TYPE_LABEL = { hub: 'Transit hub', station: 'Rail station', stop: 'Bus stop' };
const wide = () => matchMedia('(min-width: 900px)').matches;
$('#searchIc').innerHTML = ICON.search;

let net, view, pin, openId = null, slideTabs = null;

// ── what part of the map is actually visible (so centering "just works" with panels open) ──
function insets() {
  if (wide()) return { top: 64, right: 60, bottom: 20, left: openId != null ? 420 : 20 };
  const peek = parseInt(getComputedStyle(side).getPropertyValue('--peek')) || 300;
  const bottom = openId != null ? popup.offsetHeight : side.dataset.state === 'open' ? side.offsetHeight : peek;
  return { top: 70, right: 10, bottom: bottom + 10, left: 10 };
}
const settle = () => setTimeout(() => view && view.reframe(), 320);

// ── bottom sheet (mobile): tap or drag the handle ──
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

// ── "you are here" + nearby services ──
function setPin(p, { center = false } = {}) {
  pin = p; view.set({ pin });
  if (center) view.focusAt(p.x, p.y, Math.max(view.map.scale, 0.9));
  renderNearby();
}

let advisories = [];
function renderNearby() {
  const keep = body.scrollTop;
  let rows = nearbyServices(pin, net, 8);
  if (!SHOW_LIVE_ON_MAP) rows.sort((a, b) => a.d - b.d || a.line.id.localeCompare(b.line.id));

  const street = nearestStreet(pin, net), near = nearestStation(pin, net);
  const label = street || (near && near.station.name) || 'the network';
  const walk = near ? walkMinutes(near.dist, net) : null;

  const list = rows.map(r => {
    const l = r.line, color = safeColor(l.color, '#111827');
    const mark = l.type === 'rail' ? lineBadge(l, 'xl') : `<span class="svc-num" style="--c:${color}">${esc(l.id)}</span>`;
    const eta = SHOW_LIVE_ON_MAP && r.etas.length ? `<span class="live-eta"><b>${r.etas[0]}</b> min ${liveIcon(l.type)}</span>` : '';
    return `<button class="svc" data-station="${r.station.id}" aria-label="Plan a trip from ${esc(r.station.name)} on ${esc(l.name)}">
      <span class="svc-main">${mark}
        <span class="svc-dest">${ICON.arrow}<span>${esc(r.dir.headsign)}</span></span>
        <span class="svc-stop">${esc(r.station.name)} · ${r.walkMin} min walk</span></span>
      ${eta}<span class="svc-go">${ICON.chevron}</span></button>`;
  }).join('');

  const lines = net.lines.map(l => `<button class="line-pill${view.focusLine === l.id ? ' is-active' : ''}" data-line="${esc(l.id)}">${lineBadge(l)} ${esc(l.name)}</button>`).join('');

  body.innerHTML = `
    <button class="near-bar" id="nearBar" aria-label="Centre map on my location">
      <span class="near-ic">${ICON.locate}</span>
      <span class="near-txt"><small>Options near</small><strong>${esc(label)}</strong></span>
      ${walk != null ? `<span class="near-walk">${ICON.walk}<span>${walk} min</span></span>` : ''}
    </button>
    <p class="tip">Tap the map to move your location. Tap a service to plan a trip from that stop.</p>
    <div id="svcList">${list || '<p class="hint">No services found nearby.</p>'}</div>
    ${advisories.length ? '<h3 class="eyebrow">Service alerts</h3>' : ''}
    ${advisories.slice(0, 3).map(a => `<div class="adv ${esc(a.severity)}" role="note"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('')}
    <h3 class="eyebrow">Lines</h3><div class="line-pills">${lines}</div>`;
  body.scrollTop = keep;

  $('#nearBar').onclick = () => view.focusAt(pin.x, pin.y, Math.max(view.map.scale, 0.9));
  body.querySelectorAll('.svc').forEach(b => b.onclick = () => { location.href = `planner.html?from=${b.dataset.station}`; });
  body.querySelectorAll('.line-pill').forEach(b => b.onclick = () => {
    const same = view.focusLine === b.dataset.line;
    view.set({ focusLine: same ? null : b.dataset.line });
    same ? view.fitAll() : view.fitLine(b.dataset.line);
    renderNearby();
  });
}

// ── station popup with a slider ──
function openStation(s) {
  openId = s.id;
  history.replaceState(null, '', `?station=${s.id}`);
  view.set({ selectedId: s.id });
  popup.hidden = false;
  paintPopup(s);
  view.focusStation(s, Math.max(view.map.scale, 1.1));
  setTimeout(() => view.reframe(), 50);
}
function closeStation() {
  openId = null; popup.hidden = true; slideTabs = null;
  history.replaceState(null, '', location.pathname);
  view.set({ selectedId: null }); settle();
}

function slideHtml(b, s) {
  const color = safeColor(b.line.color, '#111827');
  const stops = lineStops(b.line.id, net);
  return `<section class="slide" data-line="${esc(b.line.id)}" style="--c:${color}" aria-label="${esc(b.line.name)}">
    <div class="slide-head">${lineBadge(b.line, 'lg')}<div><strong>${esc(b.line.name)}</strong><small>${b.line.type === 'rail' ? 'Rail' : 'Bus'}${b.line.frequency ? ' · ' + esc(b.line.frequency) : ''}</small></div></div>
    ${b.dirs.map(d => `<div class="dir"><div class="dir-name">${ICON.arrow} To ${esc(d.headsign)}</div>
      ${SHOW_LIVE_ON_MAP ? `<div class="tiles">${d.etas.length ? d.etas.map((m, i) => `<div class="tile${i ? '' : ' first'}">${i ? '' : liveIcon(b.line.type)}<b>${m}</b><span class="u">min</span></div>`).join('') : '<span class="muted">No vehicles in service</span>'}</div>` : ''}
    </div>`).join('')}
    ${stops.length ? `<h4 class="eyebrow" style="margin-left:0">Stops on this line</h4>
      <ol class="stoplist">${stops.map(x => `<li class="${x.id === s.id ? 'here' : ''}"><button data-open="${x.id}">${esc(x.name)}</button></li>`).join('')}</ol>` : ''}
  </section>`;
}

function paintPopup(s) {
  const board = stationBoard(s.id, net);
  const prevLeft = $('.slider', popup) ? $('.slider', popup).scrollLeft : 0;
  const walks = (net.walkFrom[s.id] || []).slice().sort((a, b) => a.seconds - b.seconds);

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
    <div id="chipHost"></div>
    <div class="slider" id="slider">${board.length ? board.map(b => slideHtml(b, s)).join('') : '<p class="hint">No lines serve this stop yet.</p>'}</div>
    ${walks.length ? `<h3 class="eyebrow">Walk to nearby stations</h3>${walks.map(l => {
      const o = net.stationsById[l.id]; if (!o) return '';
      return `<div class="walk-row"><button class="walk-main" data-open="${o.id}"><strong>${esc(o.name)}</strong><span class="chips">${o.lineIds.map(id => lineBadge(net.linesById[id])).join('')}</span><small>${fmtMin(l.seconds)} walk · ${fmtMiles(l.miles)}</small></button></div>`;
    }).join('')}` : ''}
    <div id="popAlerts"></div>`;

  $('#popupClose').onclick = closeStation;
  $('#imHere').onclick = () => { setPin({ x: s.x, y: s.y }); toast(`Location set to ${s.name}`); };
  popup.querySelectorAll('[data-open]').forEach(b => b.onclick = () => openStation(net.stationsById[b.dataset.open]));

  const slider = $('#slider', popup);
  if (board.length > 1) {
    slideTabs = Tabs({
      label: 'Lines at this station', variant: 'chips', active: board[0].line.id,
      items: board.map(b => ({ id: b.line.id, html: `${lineBadge(b.line)} <span>${esc(b.line.name)}</span>` })),
      onChange: id => { const i = board.findIndex(b => b.line.id === id); slider.scrollTo({ left: i * slider.clientWidth, behavior: 'smooth' }); }
    });
    $('#chipHost', popup).append(slideTabs.el);
    let t;
    slider.addEventListener('scroll', () => {
      clearTimeout(t);
      t = setTimeout(() => { const i = Math.round(slider.scrollLeft / slider.clientWidth); if (board[i]) slideTabs.select(board[i].line.id, { silent: true }); }, 60);
    });
    slider.addEventListener('keydown', e => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { const i = Math.round(slider.scrollLeft / slider.clientWidth) + (e.key === 'ArrowRight' ? 1 : -1); slider.scrollTo({ left: Math.max(0, Math.min(board.length - 1, i)) * slider.clientWidth, behavior: 'smooth' }); } });
    slider.tabIndex = 0;
  }
  slider.scrollLeft = prevLeft;

  api(`/api/advisories?station_id=${s.id}&line_id=${encodeURIComponent(s.lineIds.join(','))}`).then(list => {
    if (openId !== s.id) return;
    $('#popAlerts').innerHTML = list.length ? `<h3 class="eyebrow">Alerts</h3>` + list.map(a => `<div class="adv ${esc(a.severity)}"><strong>${esc(a.title)}</strong><p>${esc(a.body)}</p></div>`).join('') : '';
  }).catch(() => {});
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
    onStation: openStation,
    onVehicle: v => { const l = net.linesById[v.line_id]; toast(`${l ? l.name : 'Vehicle'}${v.headsign ? ' toward ' + v.headsign : ''}`); },
    onEmpty: w => { if (openId != null) closeStation(); setPin({ x: w.x, y: w.y }); }
  });
  view.map.onResize = () => view.reframe();

  $('#zoomIn').onclick = () => view.map.zoomAt(1.3);
  $('#zoomOut').onclick = () => view.map.zoomAt(1 / 1.3);
  $('#zoomFit').onclick = () => { view.set({ focusLine: null }); view.fitAll(); renderNearby(); };

  api('/api/advisories').then(a => { advisories = a; if (pin) renderNearby(); }).catch(() => {});

  // Always start around Union Station.
  const union = net.stations.find(s => /union/i.test(s.name)) || net.stations.find(s => s.type === 'hub') || net.stations[0];
  const start = union ? { x: union.x, y: union.y } : { x: (view.map.bounds.x0 + view.map.bounds.x1) / 2, y: (view.map.bounds.y0 + view.map.bounds.y1) / 2 };
  pin = start; view.set({ pin });
  renderNearby();
  view.focusAt(start.x, start.y, 0.9);

  const wanted = new URLSearchParams(location.search).get('station');
  if (wanted && net.stationsById[wanted]) openStation(net.stationsById[wanted]);

  setInterval(async () => {
    if (document.hidden) return;
    try {
      await refreshVehicles(net); view.render();
      if (SHOW_LIVE_ON_MAP) { renderNearby(); if (openId != null) paintPopup(net.stationsById[openId]); }
    } catch { /* keep last good data */ }
  }, 15000);
}
boot();
