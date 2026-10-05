// Pan / pinch / wheel-zoom canvas. One Pointer Events code path for mouse,
// touch and pen (the old engine had separate mouse and touch handlers).
export class CanvasMap {
  constructor(wrap, canvas, { onDraw, onTap, world = { w: 3000, h: 3000 }, minScale = 0.15, maxScale = 4, insets = () => ({ top: 0, right: 0, bottom: 0, left: 0 }) }) {
    Object.assign(this, { wrap, canvas, onDraw, onTap, world, minScale, maxScale, insets });
    this.ctx = canvas.getContext('2d');
    this.scale = 1; this.ox = 0; this.oy = 0; this.w = 0; this.h = 0;
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

  resize() {
    const r = this.wrap.getBoundingClientRect();
    if (!r.width || !r.height) return;
    const dpr = window.devicePixelRatio || 1;
    this.w = r.width; this.h = r.height;
    this.canvas.width = Math.round(r.width * dpr);
    this.canvas.height = Math.round(r.height * dpr);
    this.canvas.style.width = r.width + 'px';
    this.canvas.style.height = r.height + 'px';
    this.dpr = dpr;
    this.render();
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
  toScreen(x, y) { return { x: x * this.scale + this.ox, y: y * this.scale + this.oy }; }

  _clamp() {
    const m = Math.max(this.w, this.h) * 0.5;
    this.ox = Math.min(m, Math.max(this.w - this.world.w * this.scale - m, this.ox));
    this.oy = Math.min(m, Math.max(this.h - this.world.h * this.scale - m, this.oy));
  }

  zoomAt(factor, sx = this.w / 2, sy = this.h / 2) {
    const before = this.toWorld(sx, sy);
    this.scale = Math.max(this.minScale, Math.min(this.maxScale, this.scale * factor));
    this.ox = sx - before.x * this.scale;
    this.oy = sy - before.y * this.scale;
    this._clamp(); this.render();
  }

  centerOn(x, y, scale) {
    if (scale) this.scale = Math.max(this.minScale, Math.min(this.maxScale, scale));
    const i = this.insets();
    this.ox = (i.left + (this.w - i.right)) / 2 - x * this.scale;
    this.oy = (i.top + (this.h - i.bottom)) / 2 - y * this.scale;
    this._clamp(); this.render();
  }

  // Fit a set of [x, y] points inside the visible area (minus overlays).
  fit(points, { pad = 60, maxScale = 1.4, minBox = 160 } = {}) {
    if (!points.length) return this.centerOn(this.world.w / 2, this.world.h / 2, 0.5);
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const i = this.insets();
    const availW = this.w - i.left - i.right - pad * 2, availH = this.h - i.top - i.bottom - pad * 2;
    const s = Math.min(availW / Math.max(minBox, x1 - x0), availH / Math.max(minBox, y1 - y0), maxScale);
    this.centerOn((x0 + x1) / 2, (y0 + y1) / 2, Math.max(this.minScale, s));
  }

  // ── gestures ──
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
      const mid = { x: (a.x + b.x) / 2 - r.left, y: (a.y + b.y) / 2 - r.top };
      if (this._pinch) this.zoomAt(dist / this._pinch, mid.x, mid.y);
      this._pinch = dist;
      this._moved = true;
    }
  }
  _up(e) {
    const wasSingle = this.pointers.size === 1;
    this.pointers.delete(e.pointerId);
    this._pinch = null;
    if (wasSingle && !this._moved && this.onTap && performance.now() - this._start.t < 600) {
      const r = this.canvas.getBoundingClientRect();
      const sx = e.clientX - r.left, sy = e.clientY - r.top;
      this.onTap(this.toWorld(sx, sy), { sx, sy });
    }
  }
}
