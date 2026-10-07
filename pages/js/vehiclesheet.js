// Live vehicles: the list of every vehicle on a line, and the sheet for ONE vehicle.
// The sheet (arrive-at, "N stops away", next stop…) only appears after you tap an individual vehicle —
// from the list, from the map, or from the trip guide.
import { esc, lineBadge, safeColor, ICON, liveIcon, fmtClock } from './ui.js';
import { trackVehicle, etaMinutes, dirKeyOf, terminals } from './arrivals.js';

export const headsignOf = (v, first, last) =>
  v.headsign || (dirKeyOf(v, { first }) === 'inbound' ? first && first.name : last && last.name) || '';

// "Updated N seconds ago" is cosmetic: a random 30–90 s, re-rolled every ~15 s per vehicle (not the real timestamp).
const ages = new Map();
export function updatedSecondsAgo(id, now = Date.now()) {
  const e = ages.get(id);
  if (!e || now - e.at > 15000) ages.set(id, { at: now, s: 30 + Math.floor(Math.random() * 61) });
  return ages.get(id).s;
}

// ALL live vehicles on a line, one tappable row each. `stationId` = the stop the minutes are measured to.
export function vehicleRows(net, lineId, stationId = null) {
  const line = net.linesById[lineId];
  const vs = (net.vehicles || []).filter(v => v.line_id === lineId);
  if (!line || !vs.length) return '<p class="muted pad">No vehicles in service right now.</p>';
  const { first, last } = terminals(lineId, net);
  return vs.map(v => {
    const tr = stationId != null ? trackVehicle(v, stationId, net) : null;
    const m = tr ? tr.minutes : (v.next_station_id != null ? etaMinutes(v, v.next_station_id, net) : null);
    return `<button class="ls-veh" data-vehicle="${v.id}" ${stationId != null ? `data-station="${stationId}"` : ''}>${liveIcon(line.type)}
      <span class="ls-veh-main"><strong>${esc(v.vehicle_label || 'Vehicle ' + v.id)}</strong><small>→ ${esc(headsignOf(v, first, last))}${v.next_station_name ? ' · next stop ' + esc(v.next_station_name) : ''}</small></span>
      ${m != null ? `<span class="ls-eta"><b>${m}</b> min</span>` : ''}<span class="svc-go">${ICON.chevron}</span></button>`;
  }).join('');
}

// mode: 'browse' (map page / line menu) · 'preview' (trip guide, before GO) · 'riding' (after GO, adds ARRIVE AT)
export function vehicleSheet({ net, v, stationId = null, mode = 'browse', arriveAt = null }) {
  const line = net.linesById[v.line_id] || { id: v.line_id, name: v.line_id, type: 'bus', color: '#111827' };
  const color = safeColor(line.color, '#111827'), kind = line.type === 'rail' ? 'train' : 'bus';
  const { first, last } = terminals(v.line_id, net);
  const toward = headsignOf(v, first, last);
  const station = stationId != null ? net.stationsById[stationId] : null;
  const tr = station ? trackVehicle(v, station.id, net) : null;
  const next = net.stationsById[v.next_station_id];
  const nextName = (next && next.name) || v.next_station_name || '';
  const toNext = v.next_station_id != null ? etaMinutes(v, v.next_station_id, net) : null;
  const atStop = v.next_x != null && Math.hypot(v.next_x - v.x, v.next_y - v.y) <= 6;
  const big = line.image_url || line.type === 'rail' ? lineBadge(line, 'xxl') : `<span class="veh-num">${esc(line.id)}</span>`;
  const status = String(v.status || 'in_service').replace(/_/g, ' ');
  const name = v.vehicle_label ? `${kind === 'bus' ? 'Bus' : 'Train'} ${v.vehicle_label}` : `Vehicle ${v.id}`;

  const main = tr
    ? `<strong>${tr.stops} stop${tr.stops === 1 ? '' : 's'} away</strong><span class="veh-min">${liveIcon(line.type)}<b>${tr.minutes}</b><small>min</small></span>`
    : toNext != null ? `<strong>Next stop</strong><span class="veh-min">${liveIcon(line.type)}<b>${toNext}</b><small>min</small></span>` : '';

  return `<div class="veh" style="--c:${color}">
    ${mode === 'riding' && arriveAt ? `<div class="veh-arrive"><small>ARRIVE AT</small><b>${fmtClock(arriveAt)}${liveIcon(line.type)}</b></div>` : ''}
    <div class="veh-top">${big}<span class="veh-op"><img src="img/logo.png" alt="">City Metro</span></div>
    <p class="veh-dir">${ICON.arrow}<span>${esc(toward)}</span></p>
    ${main ? `<div class="veh-main">${main}</div>` : ''}
    <p class="veh-at">${atStop ? 'At stop' : 'Next stop'}: ${esc(nextName)}</p>
    ${station ? `<p class="veh-sub">Counting toward ${esc(station.name)}</p>` : ''}
    <div class="veh-chips">
      <div class="vchip"><span class="dots"><i></i><i></i><i></i><i></i><i></i><i></i></span><span>Crowding unknown</span></div>
      <div class="vchip"><span class="ok">${ICON.check}</span><span>${esc(status.charAt(0).toUpperCase() + status.slice(1))}</span></div></div>
    <p class="veh-upd">${esc(name)}. Updated ${updatedSecondsAgo(v.id)} seconds ago by City Metro.</p></div>`;
}

// What the map highlights for the selected vehicle.
export function trackedMark(net, v, stationId = null) {
  const line = net.linesById[v.line_id] || {};
  const tr = stationId != null ? trackVehicle(v, stationId, net) : null;
  const m = tr ? tr.minutes : (v.next_station_id != null ? etaMinutes(v, v.next_station_id, net) : null);
  return { x: v.x, y: v.y, type: line.type || 'bus', color: line.color, minutes: m };
}
