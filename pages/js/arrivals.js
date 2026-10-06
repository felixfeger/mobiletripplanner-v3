// Live arrival maths. A vehicle runs to the end of its line, turns around and comes back.
// Directions: "outbound" = toward the last station of the line as drawn, "inbound" = toward the first.
// (The database column speed_kmh is treated as mph, as the old site did.)

function orderedLine(lineId, net) {
  let segs = (net.segsByLine[lineId] || []).filter(s => s.direction === 'both');
  if (!segs.length) segs = net.segsByLine[lineId] || [];
  if (!segs.length) return null;
  segs = segs.slice().sort((a, b) => a.seq_order - b.seq_order);
  const ids = [segs[0].from_station_id, ...segs.map(s => s.to_station_id)];
  return { segs, ids, first: net.stationsById[ids[0]], last: net.stationsById[ids[ids.length - 1]] };
}

const secondsAtSpeed = (distPx, mph, pxPerMile) =>
  !distPx || distPx <= 0 || !mph || mph <= 0 ? 0 : (distPx / pxPerMile / mph) * 3600;

export const dirKeyOf = (v, line) => (v.headsign && line.first && v.headsign === line.first.name ? 'inbound' : 'outbound');

// How far (seconds + stops) is vehicle v from a station on its line?
function track(v, targetId, net) {
  if (!v || v.next_station_id == null) return null;
  const line = orderedLine(v.line_id, net);
  if (!line) return null;
  const { segs, ids } = line;
  const t = ids.indexOf(targetId), n = ids.indexOf(v.next_station_id);
  if (t < 0 || n < 0) return null;
  const L = ids.length - 1, hop = i => segs[i].travel_seconds;
  let secs = v.next_x != null ? secondsAtSpeed(Math.hypot(v.next_x - v.x, v.next_y - v.y), v.speed_kmh, net.settings.px_per_mile) : 0;
  let stops;
  if (dirKeyOf(v, line) === 'outbound') {
    if (t >= n) { for (let i = n; i < t; i++) secs += hop(i); stops = t - n + 1; }
    else { for (let i = n; i < segs.length; i++) secs += hop(i); for (let i = segs.length - 1; i >= t; i--) secs += hop(i); stops = (L - n + 1) + (L - t); }
  } else if (t <= n) { for (let i = n; i > t; i--) secs += hop(i - 1); stops = n - t + 1; }
  else { for (let i = n; i > 0; i--) secs += hop(i - 1); for (let i = 0; i < t; i++) secs += hop(i); stops = n + 1 + t; }
  return { secs, stops, minutes: Math.max(1, Math.round(secs / 60)) };
}

export function etaMinutes(v, targetId, net) { const r = track(v, targetId, net); return r ? r.minutes : null; }
export function trackVehicle(v, targetId, net) { return track(v, targetId, net); }
export function vehicleAgeSec(v) {
  if (!v || !v.last_updated) return null;
  const ms = Date.parse(String(v.last_updated).replace(' ', 'T') + 'Z');
  return Number.isFinite(ms) ? Math.max(0, Math.round((Date.now() - ms) / 1000)) : null;
}

// Vehicles heading to a station in one direction, soonest first.
export function vehiclesTo(stationId, lineId, dirKey, net) {
  const line = orderedLine(lineId, net);
  if (!line) return [];
  return (net.vehicles || []).filter(v => v.line_id === lineId && dirKeyOf(v, line) === dirKey)
    .map(v => ({ v, ...track(v, stationId, net) })).filter(x => x.secs != null && x.minutes != null)
    .sort((a, b) => a.secs - b.secs);
}

// Two directions per line at a station (the one that would "arrive" at the terminus is dropped).
export function departures(stationId, lineId, net) {
  const line = orderedLine(lineId, net);
  if (!line || !line.first || !line.last) return [];
  const make = (key, dest) => {
    const list = vehiclesTo(stationId, lineId, key, net);
    return { key, headsign: dest.name, destId: dest.id, vehicles: list, etas: list.map(x => x.minutes).slice(0, 4) };
  };
  const out = [make('outbound', line.last)];
  if (line.first.id !== line.last.id) out.push(make('inbound', line.first));
  return out.filter(d => d.destId !== stationId);
}

export function dirKeyFor(lineId, headsign, net) {
  const l = orderedLine(lineId, net);
  return l && l.first && headsign === l.first.name && l.first.id !== l.last.id ? 'inbound' : 'outbound';
}
export function terminals(lineId, net) { const l = orderedLine(lineId, net); return l ? { first: l.first, last: l.last } : { first: null, last: null }; }

// What the vehicle sheet needs: the soonest vehicle that will reach `leg.from`.
export function trackedVehicle(leg, net) {
  const key = dirKeyFor(leg.line_id, leg.headsign, net);
  const best = vehiclesTo(leg.from.id, leg.line_id, key, net)[0];
  if (!best) return null;
  const next = net.stationsById[best.v.next_station_id];
  const atStop = best.v.next_x != null && Math.hypot(best.v.next_x - best.v.x, best.v.next_y - best.v.y) <= 6;
  let age = null;
  if (best.v.last_updated) { const ms = Date.parse(String(best.v.last_updated).replace(' ', 'T') + 'Z'); if (Number.isFinite(ms)) age = Math.max(0, Math.round((Date.now() - ms) / 1000)); }
  return { v: best.v, minutes: best.minutes, stops: best.stops, nextName: (next && next.name) || best.v.next_station_name || '', atStop, ageSec: age };
}

// ── nearby / station helpers ──
// Services further than this from the pinned spot are not "nearby" and are not listed.
export const MAX_WALK_MIN = 20;
export function walkMinutes(distPx, net) {
  return Math.max(1, Math.round((distPx / net.settings.px_per_mile / net.settings.walk_mph) * 60));
}

export function stationBoard(stationId, net) {
  const st = net.stationsById[stationId];
  if (!st) return [];
  const order = new Map(net.lines.map((l, i) => [l.id, i]));
  return st.lineIds.filter(id => net.linesById[id]).sort((a, b) => order.get(a) - order.get(b))
    .map(id => ({ line: net.linesById[id], dirs: departures(stationId, id, net) }))
    .filter(b => b.dirs.length);
}

// "Options near me": nearest stations, one row per line + direction.
export function nearbyServices(pin, net, maxStations = 6) {
  const near = net.stations.map(s => ({ s, d: Math.hypot(s.x - pin.x, s.y - pin.y) }))
    .sort((a, b) => a.d - b.d).slice(0, maxStations)
    .filter(x => walkMinutes(x.d, net) <= MAX_WALK_MIN);
  const best = new Map();
  for (const { s, d } of near) {
    for (const lineId of s.lineIds) {
      const line = net.linesById[lineId];
      if (!line) continue;
      for (const dir of departures(s.id, lineId, net)) {
        const key = `${lineId}|${dir.key}`, cur = best.get(key);
        if (!cur || d < cur.d) best.set(key, { line, station: s, d, dir, etas: dir.etas, walkMin: walkMinutes(d, net) });
      }
    }
  }
  return [...best.values()].sort((a, b) => a.d - b.d || (a.etas[0] ?? 1e9) - (b.etas[0] ?? 1e9));
}

export function nearestStation(p, net) {
  let best = null, bd = Infinity;
  for (const s of net.stations) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { best = s; bd = d; } }
  return best ? { station: best, dist: bd } : null;
}

export function nearestStreet(p, net, maxPx = 45) {
  let name = null, bd = Infinity;
  for (const st of net.streets) {
    if (!st.name || st.pts.length < 2) continue;
    for (let i = 1; i < st.pts.length; i++) {
      const [ax, ay] = st.pts[i - 1], [bx, by] = st.pts[i];
      const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy || 1;
      const t = Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / len2));
      const d = Math.hypot(p.x - (ax + t * dx), p.y - (ay + t * dy));
      if (d < bd) { bd = d; name = st.name; }
    }
  }
  return bd <= maxPx ? name : null;
}

// Stations of a line in running order.
export function lineStops(lineId, net) {
  const l = orderedLine(lineId, net);
  return l ? l.ids.map(id => net.stationsById[id]).filter(Boolean) : [];
}
