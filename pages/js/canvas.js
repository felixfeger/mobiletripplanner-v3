// Pan / pinch / wheel-zoom canvas (Pointer Events for mouse, touch and pen).
// World limits come from the real network bounds, so the map never "stops" short on the right/bottom,
// and it re-centres itself whenever its container is resized (desktop panels, mobile sheets).
export class CanvasMap {
  constructor(wrap, canvas, { onDraw, onTap, insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }) {
    Object.assign(this, { wrap, canvas, onDraw, onTap, insets });
    this.ctx = canvas.getContext('2d');
    this.bounds = { x0: 0, y0: 0, x1: 1000, y1: 1000 };
    this.margin = 160;
    this.scale = 1; this.ox = 0; this.oy = 0; this.w = 0; this.h = 0;
    this.minScale = 0.1; this.maxScale = 4;
    this.pointers = new Map();
    this._frame = 0;
    canvas.style.touchAction = 'none';

    canvas.addEventListener('pointerdown', e => this._down(e));
    canvas.addEventListener('pointermove', e => this._move(e));
    canvas.addEventListener('pointerup', e => this._up(e));
    canvas.addEventListener('pointercancel', e => this.pointers.delete(e.pointerId));
    canvas.addEventListener('wheel', e => {
      e.preventDefault();
      const r = canvas.getBoundingClientRect();
      this.zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX - r.left, e.clientY - r.top);
    }, { passive: false });
    new ResizeObserver(() => this.resize()).observe(wrap);
    this.resize();
  }

  setBounds(b) { this.bounds = b; this._limits(); this._clamp(); this.render(); }

  _limits() {
    if (!this.w) return;
    const m = this.margin, b = this.bounds;
    const bw = b.x1 - b.x0 + 2 * m, bh = b.y1 - b.y0 + 2 * m;
    this.minScale = Math.max(0.04, Math.min(this.w / bw, this.h / bh) * 0.85);
  }

  _visible() {
    const i = this.insets();
    return { cx: (i.left + (this.w - i.right)) / 2, cy: (i.top + (this.h - i.bottom)) / 2, i };
  }

  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const had = this.w > 0;
    let wx, wy;
    if (had) { wx = (this.w / 2 - this.ox) / this.scale; wy = (this.h / 2 - this.oy) / this.scale; }
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height; this.dpr = dpr;
    this.canvas.width = Math.round(r.width * dpr); this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px'; this.canvas.style.height = r.height + 'px';
    this._limits();
    if (had) { this.scale = Math.max(this.scale, this.minScale); this.ox = this.w / 2 - wx * this.scale; this.oy = this.h / 2 - wy * this.scale; }
    this._clamp(); this.render();
    this.onResize && this.onResize();
  }

  render() {
    if (this._frame) return;
    this._frame = requestAnimationFrame(() => {
      this._frame = 0;
      const { ctx, dpr = 1 } = this;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.setTransform(dpr * this.scale, 0, 0, dpr * this.scale, dpr * this.ox, dpr * this.oy);
      this.onDraw && this.onDraw(ctx, this);
    });
  }

  toWorld(sx, sy) { return { x: (sx - this.ox) / this.scale, y: (sy - this.oy) / this.scale }; }

  // Keep the middle of the visible area inside the network (plus a margin).
  _clamp() {
    if (!this.w) return;
    const { cx, cy } = this._visible(), b = this.bounds, m = this.margin;
    const wx = (cx - this.ox) / this.scale, wy = (cy - this.oy) / this.scale;
    const nx = Math.min(b.x1 + m, Math.max(b.x0 - m, wx)), ny = Math.min(b.y1 + m, Math.max(b.y0 - m, wy));
    this.ox = cx - nx * this.scale; this.oy = cy - ny * this.scale;
  }

  zoomAt(factor, sx = this.w / 2, sy = this.h / 2) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    this.ox = sx - before.x * this.scale; this.oy = sy - before.y * this.scale;
    this._clamp(); this.render();
  }

  centerOn(x, y, scale) {
    if (scale) this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    const { cx, cy } = this._visible();
    this.ox = cx - x * this.scale; this.oy = cy - y * this.scale;
    this._clamp(); this.render();
  }

  fit(points, { pad = 50, maxScale = 1.4, minBox = 160 } = {}) {
    if (!points.length) return this.centerOn((this.bounds.x0 + this.bounds.x1) / 2, (this.bounds.y0 + this.bounds.y1) / 2, this.minScale);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const i = this.insets();
    const aw = Math.max(80, this.w - i.left - i.right - pad * 2), ah = Math.max(80, this.h - i.top - i.bottom - pad * 2);
    const s = Math.min(aw / Math.max(minBox, x1 - x0), ah / Math.max(minBox, y1 - y0), maxScale);
    this.centerOn((x0 + x1) / 2, (y0 + y1) / 2, Math.max(this.minScale, s));
  }

  _down(e) {
    this.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    this._moved = this.pointers.size > 1;
    this._start = { x: e.clientX, y: e.clientY, t: performance.now() };
    this._pinch = null;
  }
  _move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const prev = { ...p };
    p.x = e.clientX; p.y = e.clientY;
    if (this.pointers.size === 1) {
      if (!this._moved && Math.hypot(e.clientX - this._start.x, e.clientY - this._start.y) < 6) return;
      this._moved = true;
      this.ox += p.x - prev.x; this.oy += p.y - prev.y;
      this._clamp(); this.render();
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const r = this.canvas.getBoundingClientRect();
      if (this._pinch) this.zoomAt(dist / this._pinch, (a.x + b.x) / 2 - r.left, (a.y + b.y) / 2 - r.top);
      this._pinch = dist; this._moved = true;
    }
  }
  _up(e) {
    const single = this.pointers.size === 1;
    this.pointers.delete(e.pointerId); this._pinch = null;
    if (single && !this._moved && this.onTap && performance.now() - this._start.t < 600) {
      const r = this.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      this.onTap(this.toWorld(sx, sy), { sx, sy });
    }
  }
}
