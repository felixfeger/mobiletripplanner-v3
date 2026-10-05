// Live arrival estimates from vehicle positions (same model as the old site:
// a vehicle runs to the end of its line, turns around, and comes back).
// Note: the database column is named speed_kmh but the old site treated it as mph; kept.

function orderedLine(lineId, net) {
  let segs = (net.segsByLine[lineId] || []).filter(s => s.direction === 'both');
  if (!segs.length) segs = net.segsByLine[lineId] || [];
  if (!segs.length) return null;
  segs = segs.slice().sort((a, b) => a.seq_order - b.seq_order);
  const ids = [segs[0].from_station_id, ...segs.map(s => s.to_station_id)];
  return { segs, ids, first: net.stationsById[ids[0]], last: net.stationsById[ids[ids.length - 1]] };
}

function secondsAtSpeed(distPx, mph, pxPerMile) {
  if (!distPx || distPx <= 0 || !mph || mph <= 0) return 0;
  return (distPx / pxPerMile / mph) * 3600;
}

export function etaMinutes(v, targetId, net) {
  if (!v || v.next_station_id == null) return null;
  const line = orderedLine(v.line_id, net);
  if (!line) return null;
  const { segs, ids, first } = line;
  const target = ids.indexOf(targetId), next = ids.indexOf(v.next_station_id);
  if (target < 0 || next < 0) return null;

  const forward = !(v.headsign && first && v.headsign === first.name);
  let secs = v.next_x != null
    ? secondsAtSpeed(Math.hypot(v.next_x - v.x, v.next_y - v.y), v.speed_kmh, net.settings.px_per_mile) : 0;
  const hop = i => segs[i].travel_seconds;

  if (forward) {
    if (target >= next) for (let i = next; i < target; i++) secs += hop(i);
    else { for (let i = next; i < segs.length; i++) secs += hop(i); for (let i = segs.length - 1; i >= target; i--) secs += hop(i); }
  } else if (target <= next) {
    for (let i = next; i > target; i--) secs += hop(i - 1);
  } else {
    for (let i = next; i > 0; i--) secs += hop(i - 1);
    for (let i = 0; i < target; i++) secs += hop(i);
  }
  return Math.max(1, Math.round(secs / 60));
}

// Two directions per line at a station: toward the last terminal, toward the first.
export function departures(stationId, lineId, net) {
  const line = orderedLine(lineId, net);
  if (!line || !line.first || !line.last) return [];
  const mine = (net.vehicles || []).filter(v => v.line_id === lineId);
  const make = (dest, match) => ({
    headsign: dest.name, destId: dest.id,
    etas: mine.filter(match).map(v => etaMinutes(v, stationId, net)).filter(m => m != null).sort((a, b) => a - b).slice(0, 4)
  });
  const out = [make(line.last, v => !v.headsign || v.headsign === line.last.name)];
  // A station at the very end of the line has nothing heading further that way.
  if (line.first.id !== line.last.id) out.push(make(line.first, v => v.headsign === line.first.name));
  return out.filter(d => d.destId !== stationId);
}

// ── helpers added for the nearby list, station slider and planner ──────────

export function walkMinutes(distPx, net) {
  return Math.max(1, Math.round((distPx / net.settings.px_per_mile / net.settings.walk_mph) * 60));
}

// Every upcoming arrival at one station, grouped by line (in line order).
export function stationBoard(stationId, net) {
  const st = net.stationsById[stationId];
  if (!st) return [];
  const order = new Map(net.lines.map((l, i) => [l.id, i]));
  return st.lineIds.filter(id => net.linesById[id]).sort((a, b) => order.get(a) - order.get(b))
    .map(id => ({ line: net.linesById[id], dirs: departures(stationId, id, net) }))
    .filter(b => b.dirs.length);
}

// "Options near me": the nearest stations to a spot, one row per line + direction.
export function nearbyServices(pin, net, maxStations = 6) {
  const near = net.stations.map(s => ({ s, d: Math.hypot(s.x - pin.x, s.y - pin.y) }))
    .sort((a, b) => a.d - b.d).slice(0, maxStations)
    .filter((x, i) => i < 2 || walkMinutes(x.d, net) <= 20);
  const best = new Map();
  for (const { s, d } of near) {
    for (const lineId of s.lineIds) {
      const line = net.linesById[lineId];
      if (!line) continue;
      for (const dir of departures(s.id, lineId, net)) {
        const key = `${lineId}|${dir.destId}`, cur = best.get(key);
        if (!cur || d < cur.d) best.set(key, { line, station: s, d, dir, etas: dir.etas, walkMin: walkMinutes(d, net) });
      }
    }
  }
  return [...best.values()].sort((a, b) => (a.etas[0] ?? 1e9) - (b.etas[0] ?? 1e9) || a.d - b.d);
}

export function nearestStation(p, net) {
  let best = null, bd = Infinity;
  for (const s of net.stations) { const d = Math.hypot(s.x - p.x, s.y - p.y); if (d < bd) { best = s; bd = d; } }
  return best ? { station: best, dist: bd } : null;
}

// Name of the closest named street, if the spot is actually on/near one.
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

// Stations of a line in running order (used by the station slider).
export function lineStops(lineId, net) {
  const l = orderedLine(lineId, net);
  return l ? l.ids.map(id => net.stationsById[id]).filter(Boolean) : [];
}
