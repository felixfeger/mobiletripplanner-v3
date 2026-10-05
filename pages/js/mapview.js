// Draws the network (streets, lines, walking links, stations, vehicles) and an
// optional highlighted route. Used by the map page and the trip planner.
import { CanvasMap } from './canvas.js';
import { safeColor } from './ui.js';

const STATION_R = { hub: 9, station: 7, stop: 4.5 };

export class MapView {
  constructor({ wrap, canvas, net, onStation, onVehicle, onEmpty, insets }) {
    this.net = net;
    this.route = null;       // a route object from /api/plan
    this.pin = null;         // {x, y}
    this.selectedId = null;
    this.focusLine = null;
    this.onStation = onStation; this.onVehicle = onVehicle; this.onEmpty = onEmpty;
    this.map = new CanvasMap(wrap, canvas, {
      insets,
      onDraw: (ctx, m) => this.draw(ctx, m),
      onTap: (w, s) => this.tap(w, s)
    });
  }

  set(state) { Object.assign(this, state); this.map.render(); }
  render() { this.map.render(); }

  fitAll() { this.map.fit(this.net.stations.map(s => [s.x, s.y]), { maxScale: 1 }); }
  fitLine(lineId) {
    const pts = (this.net.segsByLine[lineId] || []).flatMap(s => s.pts);
    this.map.fit(pts, { maxScale: 1.2 });
  }
  fitRoute(route) {
    const pts = route.legs.flatMap(l => l.points);
    this.map.fit(pts, { maxScale: 1.6, pad: 50 });
  }
  focusStation(s, scale = 1.3) { this.selectedId = s.id; this.map.centerOn(s.x, s.y, scale); }

  // ── hit testing (in screen pixels, so taps feel the same at every zoom) ──
  tap(world, screen) {
    const { map, net } = this;
    const near = (x, y, px) => Math.hypot((x - world.x) * map.scale, (y - world.y) * map.scale) <= px;

    for (const v of net.vehicles || []) if (near(v.x, v.y, 18)) return this.onVehicle && this.onVehicle(v);
    let best = null, bestD = Infinity;
    for (const s of net.stations) {
      const d = Math.hypot((s.x - world.x) * map.scale, (s.y - world.y) * map.scale);
      if (d < bestD) { best = s; bestD = d; }
    }
    if (best && bestD <= 22) return this.onStation && this.onStation(best);
    this.onEmpty && this.onEmpty(world, screen);
  }

  // ── drawing ──
  draw(ctx, m) {
    const { net, route, focusLine } = this;
    const k = 1 / m.scale;                         // 1 screen px in world units
    const grow = Math.min(2.2, Math.max(0.85, Math.pow(k, 0.5)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    // streets
    ctx.strokeStyle = '#D5D9E0';
    for (const st of net.streets) {
      if (st.pts.length < 2) continue;
      ctx.lineWidth = st.width || 6; ctx.strokeStyle = safeColor(st.color, '#D5D9E0');
      path(ctx, st.pts); ctx.stroke();
    }

    // walking links: faint dashes (brighter when zoomed in)
    if (m.scale > 0.55) {
      ctx.setLineDash([4 * k, 4 * k]);
      ctx.lineWidth = 2 * k; ctx.strokeStyle = route ? 'rgba(75,85,99,.25)' : 'rgba(75,85,99,.55)';
      for (const w of net.walk_links) {
        const a = net.stationsById[w.a], b = net.stationsById[w.b];
        if (!a || !b) continue;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      }
      ctx.setLineDash([]);
    }

    // lines
    const dim = route ? 0.18 : 1;
    for (const seg of net.segments) {
      const line = net.linesById[seg.line_id];
      if (!line || seg.pts.length < 2) continue;
      ctx.globalAlpha = focusLine && focusLine !== line.id ? 0.15 : dim;
      ctx.strokeStyle = safeColor(line.color, '#2563EB');
      ctx.lineWidth = (line.type === 'rail' ? 5 : 3.5) * Math.max(1, grow * 0.9);
      path(ctx, seg.pts); ctx.stroke();
    }
    ctx.globalAlpha = 1;

    if (route) this.drawRoute(ctx, k, grow);

    // stations
    const showAll = m.scale > 0.9;
    const onRoute = route ? stationIdsOnRoute(route) : null;
    for (const s of net.stations) {
      const emphasize = !onRoute || onRoute.has(s.id);
      if (!showAll && s.type === 'stop' && !emphasize) continue;
      const r = (STATION_R[s.type] || 5) * grow;
      ctx.globalAlpha = emphasize ? 1 : 0.35;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = (s.type === 'stop' ? 2 : 3) * k * 1.2; ctx.strokeStyle = '#111827'; ctx.stroke();
      if (s.id === this.selectedId) {
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 5 * k, 0, Math.PI * 2);
        ctx.lineWidth = 3 * k; ctx.strokeStyle = '#1D4ED8'; ctx.stroke();
      }
      const labelled = s.id === this.selectedId || (onRoute && onRoute.has(s.id) && m.scale > 0.35)
        || (!route && (s.type !== 'stop' ? m.scale > 0.45 : m.scale > 1.3));
      if (labelled) label(ctx, s.name, s.x + r + 4 * k, s.y, k, s.type !== 'stop');
    }
    ctx.globalAlpha = 1;

    // vehicles
    if (!route) {
      for (const v of net.vehicles || []) {
        const line = net.linesById[v.line_id];
        if (focusLine && focusLine !== v.line_id) continue;
        const r = 8.5 * grow;
        ctx.beginPath(); ctx.arc(v.x, v.y, r, 0, Math.PI * 2);
        ctx.fillStyle = safeColor(v.color || (line && line.color)); ctx.fill();
        ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.fillStyle = safeColor(v.text_color || (line && line.text_color), '#fff');
        ctx.font = `800 ${10 * grow}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillText(String((line && line.id) || v.line_id).slice(0, 3), v.x, v.y + 0.5 * k);
      }
    }

    if (this.pin) {
      ctx.beginPath(); ctx.arc(this.pin.x, this.pin.y, 14 * k, 0, Math.PI * 2); ctx.fillStyle = 'rgba(29,78,216,.18)'; ctx.fill();
      ctx.beginPath(); ctx.arc(this.pin.x, this.pin.y, 6 * k, 0, Math.PI * 2); ctx.fillStyle = '#1D4ED8'; ctx.fill();
      ctx.lineWidth = 2.5 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }

  drawRoute(ctx, k, grow) {
    const { net, route } = this;
    for (const leg of route.legs) {
      if (leg.points.length < 2) continue;
      // white casing so the route pops off the map
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 11 * k * Math.max(1, grow); path(ctx, leg.points); ctx.stroke();

      if (leg.type === 'walk') {
        ctx.setLineDash([2 * k, 7 * k]);
        ctx.strokeStyle = '#111827'; ctx.lineWidth = 5 * k * Math.max(1, grow);
      } else {
        ctx.strokeStyle = safeColor((net.linesById[leg.line_id] || {}).color, '#2563EB');
        ctx.lineWidth = 7 * Math.max(1, grow * 0.9);
      }
      path(ctx, leg.points); ctx.stroke();
      ctx.setLineDash([]);
    }
    // start / end markers
    const first = route.legs[0].from, last = route.legs[route.legs.length - 1].to;
    for (const [st, color] of [[first, '#059669'], [last, '#DC2626']]) {
      ctx.beginPath(); ctx.arc(st.x, st.y, 11 * grow, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
      label(ctx, st.name, st.x + 15 * grow, st.y, k, true);
    }
  }
}

function path(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
}

function stationIdsOnRoute(route) {
  const ids = new Set();
  for (const leg of route.legs) {
    if (leg.type === 'ride') leg.stops.forEach(s => ids.add(s.id));
    else { ids.add(leg.from.id); ids.add(leg.to.id); }
  }
  return ids;
}

function label(ctx, text, x, y, k, bold) {
  ctx.font = `${bold ? 700 : 600} ${12 * Math.max(0.8, Math.min(k, 1.6))}px system-ui, sans-serif`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4 * k; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#111827'; ctx.fillText(text, x, y);
}
