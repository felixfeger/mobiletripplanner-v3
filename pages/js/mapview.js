// Draws the network on a light map: streets, lines, walking links, stations, vehicles,
// the "you are here" pin, and a highlighted route (optionally with one active leg).
import { CanvasMap } from './canvas.js';
import { safeColor } from './ui.js';
import { VEHICLE_ICONS } from './config.js';

const FONT = '"Helvetica Neue", Helvetica, Arial, sans-serif';
const STATION_R = { hub: 9, station: 7, stop: 4.5 };

export class MapView {
  constructor({ wrap, canvas, net, onStation, onVehicle, onEmpty, insets, showVehicles = true, showWalkLinks = true }) {
    this.net = net;
    this.showVehicles = showVehicles;      // individual live vehicles on the map (off on index.html)
    this.showWalkLinks = showWalkLinks;    // dashed walking links between nearby stations (off on index.html)
    this.route = null; this.activeLeg = null; this.pin = null;
    this.selectedId = null; this.focusLine = null; this._focus = null; this.tracked = null; this._icons = {};
    this.vehicleLines = null;               // null = every vehicle · Set of line ids = only those lines (used with an active route / line menu)
    this.onStation = onStation; this.onVehicle = onVehicle; this.onEmpty = onEmpty;
    this.map = new CanvasMap(wrap, canvas, { insets, onDraw: (c, m) => this.draw(c, m), onTap: (w, s) => this.tap(w, s) });
    this.map.setBounds(this.bounds());
  }

  bounds() {
    const xs = [], ys = [];
    const add = (x, y) => { if (Number.isFinite(x) && Number.isFinite(y)) { xs.push(x); ys.push(y); } };
    this.net.stations.forEach(s => add(s.x, s.y));
    this.net.segments.forEach(s => s.pts.forEach(p => add(p[0], p[1])));
    this.net.streets.forEach(s => s.pts.forEach(p => add(p[0], p[1])));
    if (!xs.length) return { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    return { x0: Math.min(...xs), y0: Math.min(...ys), x1: Math.max(...xs), y1: Math.max(...ys) };
  }

  set(state) { Object.assign(this, state); this.map.render(); }
  render() { this.map.render(); }
  // Re-centre on the last focus after the visible area changed (sheet opened, popup shown…).
  reframe() { if (this._focus) this.map.centerOn(this._focus.x, this._focus.y); else this.map.render(); }

  fitAll() { this._focus = null; this.map.fit(this.net.stations.map(s => [s.x, s.y]), { maxScale: 1, pad: 40 }); }
  fitLine(id) { this._focus = null; this.map.fit((this.net.segsByLine[id] || []).flatMap(s => s.pts), { maxScale: 1.2 }); }
  fitRoute(r) { this._focus = null; this.map.fit(r.legs.flatMap(l => l.points), { maxScale: 1.6 }); }
  fitLeg(l) { this._focus = null; this.map.fit(l.points, { maxScale: 1.8, pad: 70 }); }
  focusAt(x, y, scale = 1.1) { this._focus = { x, y }; this.map.centerOn(x, y, scale); }
  focusStation(s, scale = 1.3) { this.selectedId = s.id; this.focusAt(s.x, s.y, scale); }

  // Vehicles currently drawn (and tappable). With a route active only the chosen lines' vehicles show.
  visibleVehicles() {
    if (!this.showVehicles) return [];
    if (this.route && !this.vehicleLines) return [];
    return (this.net.vehicles || []).filter(v => (!this.vehicleLines || this.vehicleLines.has(v.line_id)) && (!this.focusLine || this.focusLine === v.line_id));
  }

  tap(world, screen) {
    const { map, net } = this;
    const near = (x, y, px) => Math.hypot((x - world.x) * map.scale, (y - world.y) * map.scale) <= px;
    for (const v of this.visibleVehicles()) if (near(v.x, v.y, 18)) return this.onVehicle && this.onVehicle(v);
    let best = null, bd = Infinity;
    for (const s of net.stations) {
      const d = Math.hypot((s.x - world.x) * map.scale, (s.y - world.y) * map.scale);
      if (d < bd) { best = s; bd = d; }
    }
    if (best && bd <= 22) return this.onStation && this.onStation(best);
    this.onEmpty && this.onEmpty(world, screen);
  }

  draw(ctx, m) {
    const { net, route, focusLine } = this;
    const k = 1 / m.scale, grow = Math.min(2.2, Math.max(0.85, Math.sqrt(k)));
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';

    for (const st of net.streets) {
      if (st.pts.length < 2) continue;
      ctx.strokeStyle = safeColor(st.color, '#D5D9E0'); ctx.lineWidth = Math.max(5, st.width || 6);
      path(ctx, st.pts); ctx.stroke();
    }
    if (m.scale > 0.5 && this.showWalkLinks) {
      ctx.setLineDash([4 * k, 5 * k]); ctx.lineWidth = 2 * k;
      ctx.strokeStyle = route ? 'rgba(75,85,99,.2)' : 'rgba(75,85,99,.55)';
      for (const w of net.walk_links) {
        const a = net.stationsById[w.a], b = net.stationsById[w.b];
        if (a && b) { ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke(); }
      }
      ctx.setLineDash([]);
    }
    for (const seg of net.segments) {
      const line = net.linesById[seg.line_id];
      if (!line || seg.pts.length < 2) continue;
      ctx.globalAlpha = focusLine && focusLine !== line.id ? 0.15 : route ? 0.22 : 1;
      ctx.strokeStyle = safeColor(line.color, '#2563EB');
      ctx.lineWidth = (line.type === 'rail' ? 5.5 : 4) * Math.max(1, grow * 0.9);
      path(ctx, seg.pts); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (route) this.drawRoute(ctx, k, grow);
    if (this.tracked) this.drawTracked(ctx, k);

    const onRoute = route ? idsOnRoute(route) : null;
    for (const s of net.stations) {
      const emph = !onRoute || onRoute.has(s.id);
      if (m.scale <= 0.9 && s.type === 'stop' && !emph) continue;
      const r = (STATION_R[s.type] || 5) * grow;
      ctx.globalAlpha = emph ? 1 : 0.35;
      ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
      ctx.fillStyle = '#fff'; ctx.fill();
      ctx.lineWidth = (s.type === 'stop' ? 2 : 3) * k * 1.2; ctx.strokeStyle = '#111827'; ctx.stroke();
      if (s.id === this.selectedId) {
        ctx.beginPath(); ctx.arc(s.x, s.y, r + 6 * k, 0, Math.PI * 2);
        ctx.lineWidth = 3 * k; ctx.strokeStyle = '#1d4ed8'; ctx.stroke();
      }
      const show = s.id === this.selectedId || (onRoute && onRoute.has(s.id) && m.scale > 0.35) ||
        (!route && (s.type !== 'stop' ? m.scale > 0.4 : m.scale > 1.3));
      if (show) label(ctx, s.name, s.x + r + 5 * k, s.y, k, s.type !== 'stop');
    }
    ctx.globalAlpha = 1;

    for (const v of this.visibleVehicles()) this.drawVehicle(ctx, v, k);
    if (this.pin) {
      ctx.beginPath(); ctx.arc(this.pin.x, this.pin.y, 17 * k, 0, Math.PI * 2); ctx.fillStyle = 'rgba(29,78,216,.2)'; ctx.fill();
      ctx.beginPath(); ctx.arc(this.pin.x, this.pin.y, 8 * k, 0, Math.PI * 2); ctx.fillStyle = '#1d4ed8'; ctx.fill();
      ctx.lineWidth = 3 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
    }
  }

  icon(type) {
    if (!this._icons[type]) {
      const srcs = VEHICLE_ICONS[type === 'rail' ? 'rail' : 'bus'], img = new Image();
      let i = 0;
      img.onload = () => this.map.render();
      img.onerror = () => { if (++i < srcs.length) img.src = srcs[i]; else { img._bad = true; this.map.render(); } };   // next file name, else text fallback
      img.src = srcs[0];
      this._icons[type] = img;
    }
    return this._icons[type];
  }

  // One live vehicle: your white bus / train icon on a black chip, ringed in the line colour.
  drawVehicle(ctx, v, k) {
    const line = this.net.linesById[v.line_id];
    const color = safeColor(v.color || (line && line.color), '#111827');
    const type = (line && line.type) || v.line_type || 'bus';
    ctx.beginPath(); ctx.arc(v.x, v.y, 14 * k, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 3.5 * k; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath(); ctx.arc(v.x, v.y, 10.5 * k, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
    const img = this.icon(type), w = 14 * k;
    if (img.complete && img.naturalWidth && !img._bad) ctx.drawImage(img, v.x - w / 2, v.y - w / 2, w, w);
    else {
      ctx.fillStyle = '#fff'; ctx.font = `700 ${8 * k}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String((line && line.id) || v.line_id).slice(0, 3), v.x, v.y + 0.5 * k);
    }
  }

  // The vehicle the guide is following: black chip with your white bus/train icon, ringed in the line colour.
  drawTracked(ctx, k) {
    const t = this.tracked, color = safeColor(t.color, '#111827');
    ctx.beginPath(); ctx.arc(t.x, t.y, 22 * k, 0, Math.PI * 2); ctx.fillStyle = '#fff'; ctx.fill();
    ctx.lineWidth = 5 * k; ctx.strokeStyle = color; ctx.stroke();
    ctx.beginPath(); ctx.arc(t.x, t.y, 16 * k, 0, Math.PI * 2); ctx.fillStyle = '#000'; ctx.fill();
    const img = this.icon(t.type), w = 22 * k;
    if (img.complete && img.naturalWidth && !img._bad) ctx.drawImage(img, t.x - w / 2, t.y - w / 2, w, w);
    else { ctx.fillStyle = '#fff'; ctx.fillRect(t.x - 6 * k, t.y - 7 * k, 12 * k, 12 * k); }
    if (t.minutes != null) {
      const txt = `${t.minutes}m`;
      ctx.font = `700 ${12 * k}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const w2 = ctx.measureText(txt).width + 12 * k, px = t.x + 22 * k, py = t.y - 24 * k;
      ctx.fillStyle = color; ctx.beginPath(); ctx.roundRect ? ctx.roundRect(px - w2 / 2, py - 10 * k, w2, 20 * k, 10 * k) : ctx.rect(px - w2 / 2, py - 10 * k, w2, 20 * k); ctx.fill();
      ctx.lineWidth = 2 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
      ctx.fillStyle = '#fff'; ctx.fillText(txt, px, py + k);
    }
  }

  drawRoute(ctx, k, grow) {
    const { net, route, activeLeg } = this;
    route.legs.forEach((leg, i) => {
      if (leg.points.length < 2) return;
      ctx.globalAlpha = activeLeg == null || activeLeg === i ? 1 : 0.3;
      ctx.setLineDash([]);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 12 * k * Math.max(1, grow); path(ctx, leg.points); ctx.stroke();
      if (leg.type === 'walk') { ctx.setLineDash([1 * k, 8 * k]); ctx.strokeStyle = '#111827'; ctx.lineWidth = 5 * k * Math.max(1, grow); }
      else { ctx.strokeStyle = safeColor((net.linesById[leg.line_id] || {}).color, '#2563EB'); ctx.lineWidth = 7.5 * Math.max(1, grow * 0.9); }
      path(ctx, leg.points); ctx.stroke(); ctx.setLineDash([]);
    });
    ctx.globalAlpha = 1;
    const first = route.legs[0].from, last = route.legs[route.legs.length - 1].to;
    for (const [st, color] of [[first, '#22c55e'], [last, '#ef4444']]) {
      ctx.beginPath(); ctx.arc(st.x, st.y, 11 * grow, 0, Math.PI * 2);
      ctx.fillStyle = color; ctx.fill(); ctx.lineWidth = 3 * k; ctx.strokeStyle = '#fff'; ctx.stroke();
      label(ctx, st.name, st.x + 15 * grow, st.y, k, true);
    }
  }
}

function path(ctx, pts) { ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]); for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]); }

function idsOnRoute(route) {
  const ids = new Set();
  for (const l of route.legs) { if (l.type === 'ride') l.stops.forEach(s => ids.add(s.id)); else { ids.add(l.from.id); ids.add(l.to.id); } }
  return ids;
}

function label(ctx, text, x, y, k, bold) {
  ctx.font = `${bold ? 700 : 500} ${12 * Math.max(0.8, Math.min(k, 1.6))}px ${FONT}`;
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  ctx.lineWidth = 4 * k; ctx.strokeStyle = 'rgba(255,255,255,.92)'; ctx.strokeText(text, x, y);
  ctx.fillStyle = '#111827'; ctx.fillText(text, x, y);
}
