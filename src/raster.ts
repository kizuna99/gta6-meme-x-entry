import type { RgbaImage } from './png.ts';

export type Color = readonly [number, number, number, number];
export type Point = readonly [number, number];
export interface Mask {
  width: number;
  height: number;
  data: Uint8Array;
}

export function rgba(hex: string, alpha = 1): Color {
  const h = hex.replace('#', '');
  const n = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return [
    parseInt(n.slice(0, 2), 16),
    parseInt(n.slice(2, 4), 16),
    parseInt(n.slice(4, 6), 16),
    alpha,
  ];
}

export function mix(a: Color, b: Color, t: number): Color {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
    a[3] + (b[3] - a[3]) * t,
  ];
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}

export class Canvas {
  width: number;
  height: number;
  data: Uint8ClampedArray;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.data = new Uint8ClampedArray(width * height * 4);
  }

  blend(x: number, y: number, r: number, g: number, b: number, a: number): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height || a <= 0) return;
    const i = (y * this.width + x) * 4;
    const d = this.data;
    const da = d[i + 3] / 255;
    if (da >= 0.999) {
      d[i] = d[i] + (r - d[i]) * a;
      d[i + 1] = d[i + 1] + (g - d[i + 1]) * a;
      d[i + 2] = d[i + 2] + (b - d[i + 2]) * a;
      return;
    }
    const oa = a + da * (1 - a);
    if (oa <= 0) return;
    d[i] = (r * a + d[i] * da * (1 - a)) / oa;
    d[i + 1] = (g * a + d[i + 1] * da * (1 - a)) / oa;
    d[i + 2] = (b * a + d[i + 2] * da * (1 - a)) / oa;
    d[i + 3] = oa * 255;
  }

  fillRect(x: number, y: number, w: number, h: number, color: Color): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + w));
    const y1 = Math.min(this.height, Math.ceil(y + h));
    for (let yy = y0; yy < y1; yy++) {
      for (let xx = x0; xx < x1; xx++) this.blend(xx, yy, color[0], color[1], color[2], color[3]);
    }
  }

  fillPolygon(points: Point[], color: Color, evenOdd = false): void {
    this.fillPath([points], color, evenOdd);
  }

  fillPath(subpaths: Point[][], color: Color, evenOdd = false): void {
    const edges: Array<[number, number, number, number, number]> = [];
    let minY = Infinity;
    let maxY = -Infinity;
    for (const points of subpaths) {
      if (points.length < 3) continue;
      for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        edges.push([a[0], a[1], b[0], b[1], b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0]);
        if (a[1] < minY) minY = a[1];
        if (a[1] > maxY) maxY = a[1];
      }
    }
    if (!Number.isFinite(minY)) return;
    const yStart = Math.max(0, Math.floor(minY));
    const yEnd = Math.min(this.height, Math.ceil(maxY));
    const xs: Array<[number, number]> = [];
    for (let y = yStart; y < yEnd; y++) {
      const sy = y + 0.5;
      xs.length = 0;
      for (const e of edges) {
        const [x1, y1, x2, y2, dir] = e;
        if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) {
          xs.push([x1 + ((sy - y1) * (x2 - x1)) / (y2 - y1), dir]);
        }
      }
      if (xs.length < 2) continue;
      xs.sort((a, b) => a[0] - b[0]);
      if (evenOdd) {
        let inside = false;
        let start = 0;
        for (const [x] of xs) {
          if (!inside) {
            start = x;
            inside = true;
          } else {
            inside = false;
            const xa = Math.max(0, Math.ceil(start - 0.5));
            const xb = Math.min(this.width - 1, Math.floor(x - 0.5));
            for (let xx = xa; xx <= xb; xx++) this.blend(xx, y, color[0], color[1], color[2], color[3]);
          }
        }
      } else {
        let winding = 0;
        let start = 0;
        for (const [x, dir] of xs) {
          const prev = winding;
          winding += dir;
          if (prev === 0 && winding !== 0) start = x;
          else if (prev !== 0 && winding === 0) {
            const xa = Math.max(0, Math.ceil(start - 0.5));
            const xb = Math.min(this.width - 1, Math.floor(x - 0.5));
            for (let xx = xa; xx <= xb; xx++) this.blend(xx, y, color[0], color[1], color[2], color[3]);
          }
        }
      }
    }
  }

  fillPolygons(polys: Point[][], color: Color, evenOdd = false): void {
    this.fillPath(polys, color, evenOdd);
  }

  fillCircle(cx: number, cy: number, r: number, color: Color): void {
    this.fillPolygon(circlePoints(cx, cy, r, Math.max(24, Math.min(256, Math.ceil(r * 0.9)))), color);
  }

  fillEllipse(cx: number, cy: number, rx: number, ry: number, color: Color): void {
    this.fillPolygon(ellipsePoints(cx, cy, rx, ry, Math.max(24, Math.min(256, Math.ceil(Math.max(rx, ry) * 0.9)))), color);
  }

  fillRoundedRect(x: number, y: number, w: number, h: number, r: number, color: Color): void {
    this.fillPolygon(roundedRectPoints(x, y, w, h, r), color);
  }

  strokePolyline(points: Point[], width: number, color: Color): void {
    const r = width / 2;
    for (let i = 0; i < points.length - 1; i++) {
      const a = points[i];
      const b = points[i + 1];
      const dx = b[0] - a[0];
      const dy = b[1] - a[1];
      const len = Math.hypot(dx, dy);
      if (len < 1e-6) continue;
      const nx = (-dy / len) * r;
      const ny = (dx / len) * r;
      this.fillPolygon(
        [
          [a[0] + nx, a[1] + ny],
          [b[0] + nx, b[1] + ny],
          [b[0] - nx, b[1] - ny],
          [a[0] - nx, a[1] - ny],
        ],
        color,
      );
      this.fillCircle(a[0], a[1], r, color);
      this.fillCircle(b[0], b[1], r, color);
    }
  }

  radialGlow(cx: number, cy: number, radius: number, color: Color, strength = 1): void {
    const x0 = Math.max(0, Math.floor(cx - radius));
    const y0 = Math.max(0, Math.floor(cy - radius));
    const x1 = Math.min(this.width, Math.ceil(cx + radius));
    const y1 = Math.min(this.height, Math.ceil(cy + radius));
    const inv = 1 / radius;
    for (let y = y0; y < y1; y++) {
      const dy = y + 0.5 - cy;
      for (let x = x0; x < x1; x++) {
        const dx = x + 0.5 - cx;
        const d = Math.sqrt(dx * dx + dy * dy) * inv;
        if (d >= 1) continue;
        const t = 1 - d;
        const a = t * t * strength * color[3];
        this.blend(x, y, color[0], color[1], color[2], a);
      }
    }
  }

  blitMask(mask: Mask, x: number, y: number, color: Color, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + mask.width));
    const y1 = Math.min(this.height, Math.ceil(y + mask.height));
    const offX = Math.round(x);
    const offY = Math.round(y);
    for (let yy = y0; yy < y1; yy++) {
      const my = yy - offY;
      if (my < 0 || my >= mask.height) continue;
      for (let xx = x0; xx < x1; xx++) {
        const mx = xx - offX;
        if (mx < 0 || mx >= mask.width) continue;
        const a = (mask.data[my * mask.width + mx] / 255) * alpha * color[3];
        if (a > 0) this.blend(xx, yy, color[0], color[1], color[2], a);
      }
    }
  }

  blitMaskGradient(mask: Mask, x: number, y: number, colorAt: (x: number, y: number) => Color, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(x));
    const y0 = Math.max(0, Math.floor(y));
    const x1 = Math.min(this.width, Math.ceil(x + mask.width));
    const y1 = Math.min(this.height, Math.ceil(y + mask.height));
    const offX = Math.round(x);
    const offY = Math.round(y);
    for (let yy = y0; yy < y1; yy++) {
      const my = yy - offY;
      if (my < 0 || my >= mask.height) continue;
      for (let xx = x0; xx < x1; xx++) {
        const mx = xx - offX;
        if (mx < 0 || mx >= mask.width) continue;
        const av = (mask.data[my * mask.width + mx] / 255) * alpha;
        if (av <= 0) continue;
        const c = colorAt(xx, yy);
        this.blend(xx, yy, c[0], c[1], c[2], av * c[3]);
      }
    }
  }

  blitImage(img: RgbaImage, dx: number, dy: number, dw: number, dh: number, alpha = 1): void {
    const x0 = Math.max(0, Math.floor(dx));
    const y0 = Math.max(0, Math.floor(dy));
    const x1 = Math.min(this.width, Math.ceil(dx + dw));
    const y1 = Math.min(this.height, Math.ceil(dy + dh));
    const sx = img.width / dw;
    const sy = img.height / dh;
    for (let y = y0; y < y1; y++) {
      const fy = Math.min(img.height - 1, Math.max(0, (y + 0.5 - dy) * sy - 0.5));
      const y0i = Math.floor(fy);
      const y1i = Math.min(img.height - 1, y0i + 1);
      const wy = fy - y0i;
      for (let x = x0; x < x1; x++) {
        const fx = Math.min(img.width - 1, Math.max(0, (x + 0.5 - dx) * sx - 0.5));
        const x0i = Math.floor(fx);
        const x1i = Math.min(img.width - 1, x0i + 1);
        const wx = fx - x0i;
        const i00 = (y0i * img.width + x0i) * 4;
        const i10 = (y0i * img.width + x1i) * 4;
        const i01 = (y1i * img.width + x0i) * 4;
        const i11 = (y1i * img.width + x1i) * 4;
        const a00 = img.data[i00 + 3] / 255;
        const a10 = img.data[i10 + 3] / 255;
        const a01 = img.data[i01 + 3] / 255;
        const a11 = img.data[i11 + 3] / 255;
        const w00 = (1 - wx) * (1 - wy);
        const w10 = wx * (1 - wy);
        const w01 = (1 - wx) * wy;
        const w11 = wx * wy;
        const a = a00 * w00 + a10 * w10 + a01 * w01 + a11 * w11;
        if (a <= 0.001) continue;
        const r = (img.data[i00] * a00 * w00 + img.data[i10] * a10 * w10 + img.data[i01] * a01 * w01 + img.data[i11] * a11 * w11) / a;
        const g = (img.data[i00 + 1] * a00 * w00 + img.data[i10 + 1] * a10 * w10 + img.data[i01 + 1] * a01 * w01 + img.data[i11 + 1] * a11 * w11) / a;
        const b = (img.data[i00 + 2] * a00 * w00 + img.data[i10 + 2] * a10 * w10 + img.data[i01 + 2] * a01 * w01 + img.data[i11 + 2] * a11 * w11) / a;
        this.blend(x, y, r, g, b, a * alpha);
      }
    }
  }

  downsample(factor: number): RgbaImage {
    const w = Math.floor(this.width / factor);
    const h = Math.floor(this.height / factor);
    const out = new Uint8ClampedArray(w * h * 4);
    const inv = 1 / (factor * factor);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0;
        let g = 0;
        let b = 0;
        let a = 0;
        for (let yy = 0; yy < factor; yy++) {
          for (let xx = 0; xx < factor; xx++) {
            const i = ((y * factor + yy) * this.width + (x * factor + xx)) * 4;
            const av = this.data[i + 3] / 255;
            r += this.data[i] * av;
            g += this.data[i + 1] * av;
            b += this.data[i + 2] * av;
            a += av;
          }
        }
        const o = (y * w + x) * 4;
        if (a > 0) {
          out[o] = r / a;
          out[o + 1] = g / a;
          out[o + 2] = b / a;
          out[o + 3] = a * inv * 255;
        }
      }
    }
    return { width: w, height: h, data: out };
  }
}

export function circlePoints(cx: number, cy: number, r: number, segments = 128): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export function ellipsePoints(cx: number, cy: number, rx: number, ry: number, segments = 128): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pts.push([cx + Math.cos(a) * rx, cy + Math.sin(a) * ry]);
  }
  return pts;
}

export function roundedRectPoints(x: number, y: number, w: number, h: number, r: number): Point[] {
  const rr = Math.min(r, w / 2, h / 2);
  const pts: Point[] = [];
  const addArc = (cx: number, cy: number, a0: number, a1: number) => {
    const steps = 12;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + ((a1 - a0) * i) / steps;
      pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  };
  addArc(x + w - rr, y + rr, -Math.PI / 2, 0);
  addArc(x + w - rr, y + h - rr, 0, Math.PI / 2);
  addArc(x + rr, y + h - rr, Math.PI / 2, Math.PI);
  addArc(x + rr, y + rr, Math.PI, (Math.PI * 3) / 2);
  return pts;
}

export function starPoints(cx: number, cy: number, outer: number, inner: number, points = 5): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outer : inner;
    const a = -Math.PI / 2 + (i * Math.PI) / points;
    pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r]);
  }
  return pts;
}

export function fillMaskPolygons(polys: Point[][], mask: Mask, evenOdd = false): void {
  const edges: Array<[number, number, number, number, number]> = [];
  let minY = Infinity;
  let maxY = -Infinity;
  for (const points of polys) {
    if (points.length < 3) continue;
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      edges.push([a[0], a[1], b[0], b[1], b[1] > a[1] ? 1 : b[1] < a[1] ? -1 : 0]);
      if (a[1] < minY) minY = a[1];
      if (a[1] > maxY) maxY = a[1];
    }
  }
  if (!Number.isFinite(minY)) return;
  const yStart = Math.max(0, Math.floor(minY));
  const yEnd = Math.min(mask.height, Math.ceil(maxY));
  const xs: Array<[number, number]> = [];
  for (let y = yStart; y < yEnd; y++) {
    const sy = y + 0.5;
    xs.length = 0;
    for (const e of edges) {
      const [x1, y1, x2, y2, dir] = e;
      if ((y1 <= sy && y2 > sy) || (y2 <= sy && y1 > sy)) {
        xs.push([x1 + ((sy - y1) * (x2 - x1)) / (y2 - y1), dir]);
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a[0] - b[0]);
    if (evenOdd) {
      let inside = false;
      let start = 0;
      for (const [x] of xs) {
        if (!inside) {
          start = x;
          inside = true;
        } else {
          inside = false;
          const xa = Math.max(0, Math.ceil(start - 0.5));
          const xb = Math.min(mask.width - 1, Math.floor(x - 0.5));
          for (let xx = xa; xx <= xb; xx++) mask.data[y * mask.width + xx] = 255;
        }
      }
    } else {
      let winding = 0;
      let start = 0;
      for (const [x, dir] of xs) {
        const prev = winding;
        winding += dir;
        if (prev === 0 && winding !== 0) start = x;
        else if (prev !== 0 && winding === 0) {
          const xa = Math.max(0, Math.ceil(start - 0.5));
          const xb = Math.min(mask.width - 1, Math.floor(x - 0.5));
          for (let xx = xa; xx <= xb; xx++) mask.data[y * mask.width + xx] = 255;
        }
      }
    }
  }
}

export function blurMask(mask: Mask, radius: number, passes = 3): Mask {
  if (radius <= 0) return mask;
  const w = mask.width;
  const h = mask.height;
  let src = new Float32Array(mask.data);
  let tmp = new Float32Array(src.length);
  const r = Math.max(1, Math.round(radius));
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < h; y++) {
      const base = y * w;
      let sum = 0;
      for (let x = -r; x <= r; x++) sum += src[base + Math.min(w - 1, Math.max(0, x))];
      const denom = r * 2 + 1;
      for (let x = 0; x < w; x++) {
        tmp[base + x] = sum / denom;
        const add = src[base + Math.min(w - 1, x + r + 1)];
        const sub = src[base + Math.max(0, x - r)];
        sum += add - sub;
      }
    }
    for (let x = 0; x < w; x++) {
      let sum = 0;
      for (let y = -r; y <= r; y++) sum += tmp[Math.min(h - 1, Math.max(0, y)) * w + x];
      const denom = r * 2 + 1;
      for (let y = 0; y < h; y++) {
        src[y * w + x] = sum / denom;
        const add = tmp[Math.min(h - 1, y + r + 1) * w + x];
        const sub = tmp[Math.max(0, y - r) * w + x];
        sum += add - sub;
      }
    }
  }
  const out = new Uint8Array(src.length);
  for (let i = 0; i < src.length; i++) out[i] = Math.max(0, Math.min(255, src[i]));
  return { width: w, height: h, data: out };
}

export function dilateMask(mask: Mask, radius: number, directions = 32): Mask {
  if (radius <= 0) return { width: mask.width, height: mask.height, data: new Uint8Array(mask.data) };
  const out = new Uint8Array(mask.data.length);
  const w = mask.width;
  const h = mask.height;
  for (let i = 0; i < directions; i++) {
    const a = (i / directions) * Math.PI * 2;
    const dx = Math.round(Math.cos(a) * radius);
    const dy = Math.round(Math.sin(a) * radius);
    for (let y = 0; y < h; y++) {
      const ty = y + dy;
      if (ty < 0 || ty >= h) continue;
      for (let x = 0; x < w; x++) {
        const v = mask.data[y * w + x];
        if (v === 0) continue;
        const tx = x + dx;
        if (tx < 0 || tx >= w) continue;
        const o = ty * w + tx;
        if (v > out[o]) out[o] = v;
      }
    }
  }
  for (let i = 0; i < out.length; i++) if (mask.data[i] > out[i]) out[i] = mask.data[i];
  return { width: w, height: h, data: out };
}

export function applyVignette(img: RgbaImage, strength = 0.38): void {
  const { width, height, data } = img;
  const cx = width / 2;
  const cy = height / 2;
  const maxD = Math.hypot(cx, cy);
  for (let y = 0; y < height; y++) {
    const dy = y + 0.5 - cy;
    for (let x = 0; x < width; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.hypot(dx, dy) / maxD;
      const f = 1 - strength * smoothstep(0.45, 1.0, d);
      const i = (y * width + x) * 4;
      data[i] *= f;
      data[i + 1] *= f;
      data[i + 2] *= f;
    }
  }
}
