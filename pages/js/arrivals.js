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
