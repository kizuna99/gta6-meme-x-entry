import { fillMaskPolygons } from './raster.ts';
import type { Mask, Point } from './raster.ts';

interface GlyphPoint {
  x: number;
  y: number;
  on: boolean;
}

interface Glyph {
  advance: number;
  contours: GlyphPoint[][] | null;
  xMin: number;
  yMin: number;
  xMax: number;
  yMax: number;
}

export interface TextMask extends Mask {
  baseline: number;
  pad: number;
}

export interface TextMetrics {
  width: number;
  height: number;
  advance: number;
  capHeight: number;
}

interface Table {
  offset: number;
  length: number;
}

function mid(a: GlyphPoint, b: GlyphPoint): GlyphPoint {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, on: true };
}

function flattenQuad(p0: GlyphPoint, p1: GlyphPoint, p2: GlyphPoint, out: Point[]): void {
  const dist = Math.hypot(p2.x - p0.x, p2.y - p0.y);
  const steps = Math.max(6, Math.min(24, Math.ceil(dist / 24)));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([mt * mt * p0.x + 2 * mt * t * p1.x + t * t * p2.x, mt * mt * p0.y + 2 * mt * t * p1.y + t * t * p2.y]);
  }
}

function flattenContour(points: GlyphPoint[]): Point[] {
  if (points.length === 0) return [];
  const expanded: GlyphPoint[] = [];
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const next = points[(i + 1) % points.length];
    expanded.push(p);
    if (!p.on && !next.on) expanded.push(mid(p, next));
  }
  let startIdx = expanded.findIndex((p) => p.on);
  if (startIdx < 0) {
    expanded.push(mid(expanded[expanded.length - 1], expanded[0]));
    startIdx = expanded.length - 1;
  }
  const out: Point[] = [[expanded[startIdx].x, expanded[startIdx].y]];
  let i = 1;
  while (i <= expanded.length) {
    const p = expanded[(startIdx + i) % expanded.length];
    if (p.on) {
      out.push([p.x, p.y]);
      i++;
    } else {
      const next = expanded[(startIdx + i + 1) % expanded.length];
      flattenQuad(expanded[(startIdx + i - 1) % expanded.length], p, next, out);
      i += 2;
    }
  }
  return out;
}

export class TrueTypeFont {
  private buf: Buffer;
  private tables: Map<string, Table>;
  private unitsPerEm: number;
  private indexToLocFormat: number;
  private numGlyphs: number;
  private numberOfHMetrics: number;
  private locaOff: number;
  private glyfOff: number;
  private hmtxOff: number;
  private cmapOff: number;
  private cmapFormat: number;
  private cmapSubOff: number;
  private glyphCache: Map<number, Glyph>;

  constructor(buf: Buffer) {
    this.buf = buf;
    this.tables = new Map();
    const numTables = buf.readUInt16BE(4);
    for (let i = 0; i < numTables; i++) {
      const p = 12 + i * 16;
      const tag = buf.toString('ascii', p, p + 4);
      this.tables.set(tag, { offset: buf.readUInt32BE(p + 8), length: buf.readUInt32BE(p + 12) });
    }
    const head = this.table('head');
    this.unitsPerEm = buf.readUInt16BE(head.offset + 18);
    this.indexToLocFormat = buf.readInt16BE(head.offset + 50);
    const maxp = this.table('maxp');
    this.numGlyphs = buf.readUInt16BE(maxp.offset + 4);
    const hhea = this.table('hhea');
    this.numberOfHMetrics = buf.readUInt16BE(hhea.offset + 34);
    this.locaOff = this.table('loca').offset;
    this.glyfOff = this.table('glyf').offset;
    this.hmtxOff = this.table('hmtx').offset;
    const cmap = this.table('cmap');
    const n = buf.readUInt16BE(cmap.offset + 2);
    this.cmapOff = cmap.offset;
    this.cmapFormat = 0;
    this.cmapSubOff = 0;
    let best = -1;
    for (let i = 0; i < n; i++) {
      const rec = cmap.offset + 4 + i * 8;
      const platform = buf.readUInt16BE(rec);
      const encoding = buf.readUInt16BE(rec + 2);
      const sub = cmap.offset + buf.readUInt32BE(rec + 4);
      const fmt = buf.readUInt16BE(sub);
      const score = (fmt === 12 ? 100 : fmt === 4 ? 50 : 0) + (platform === 3 ? 10 : 0) + (encoding === 10 ? 5 : 0);
      if (score > best) {
        best = score;
        this.cmapFormat = fmt;
        this.cmapSubOff = sub;
      }
    }
    if (this.cmapFormat !== 4 && this.cmapFormat !== 12) throw new Error('unsupported cmap format');
    this.glyphCache = new Map();
  }

  private table(tag: string): Table {
    const t = this.tables.get(tag);
    if (!t) throw new Error(`font table ${tag} is missing`);
    return t;
  }

  private glyphOffset(gid: number): number {
    if (this.indexToLocFormat === 0) {
      return this.buf.readUInt16BE(this.locaOff + gid * 2) * 2;
    }
    return this.buf.readUInt32BE(this.locaOff + gid * 4);
  }

  glyphIndex(cp: number): number {
    const b = this.buf;
    const sub = this.cmapSubOff;
    if (this.cmapFormat === 12) {
      const n = b.readUInt32BE(sub + 12);
      let lo = 0;
      let hi = n - 1;
      while (lo <= hi) {
        const m = (lo + hi) >> 1;
        const p = sub + 16 + m * 12;
        const start = b.readUInt32BE(p);
        const end = b.readUInt32BE(p + 4);
        if (cp < start) hi = m - 1;
        else if (cp > end) lo = m + 1;
        else return b.readUInt32BE(p + 8) + (cp - start);
      }
      return 0;
    }
    const segCount = b.readUInt16BE(sub + 6) / 2;
    const endOff = sub + 14;
    const startOff = endOff + segCount * 2 + 2;
    const deltaOff = startOff + segCount * 2;
    const rangeOff = deltaOff + segCount * 2;
    for (let i = 0; i < segCount; i++) {
      const end = b.readUInt16BE(endOff + i * 2);
      const start = b.readUInt16BE(startOff + i * 2);
      if (cp < start || cp > end) continue;
      const delta = b.readInt16BE(deltaOff + i * 2);
      const ro = b.readUInt16BE(rangeOff + i * 2);
      if (ro === 0) return (cp + delta) & 0xffff;
      const idx = rangeOff + i * 2 + ro + (cp - start) * 2;
      const g = b.readUInt16BE(idx);
      return g === 0 ? 0 : (g + delta) & 0xffff;
    }
    return 0;
  }

  private advance(gid: number): number {
    if (gid < this.numberOfHMetrics) return this.buf.readUInt16BE(this.hmtxOff + gid * 4);
    return this.buf.readUInt16BE(this.hmtxOff + (this.numberOfHMetrics - 1) * 4);
  }

  private parseGlyph(gid: number, depth = 0): Glyph {
    const cached = this.glyphCache.get(gid);
    if (cached) return cached;
    const b = this.buf;
    const off = this.glyfOff + this.glyphOffset(gid);
    const next = this.glyfOff + this.glyphOffset(gid + 1);
    const glyph: Glyph = { advance: this.advance(gid), contours: null, xMin: 0, yMin: 0, xMax: 0, yMax: 0 };
    if (off >= next || gid >= this.numGlyphs) {
      this.glyphCache.set(gid, glyph);
      return glyph;
    }
    const numberOfContours = b.readInt16BE(off);
    glyph.xMin = b.readInt16BE(off + 2);
    glyph.yMin = b.readInt16BE(off + 4);
    glyph.xMax = b.readInt16BE(off + 6);
    glyph.yMax = b.readInt16BE(off + 8);
    if (numberOfContours >= 0) {
      const endPts: number[] = [];
      for (let i = 0; i < numberOfContours; i++) endPts.push(b.readUInt16BE(off + 10 + i * 2));
      const numPoints = numberOfContours === 0 ? 0 : endPts[endPts.length - 1] + 1;
      let p = off + 10 + numberOfContours * 2;
      const instrLen = b.readUInt16BE(p);
      p += 2 + instrLen;
      const flags: number[] = [];
      while (flags.length < numPoints) {
        const f = b[p++];
        flags.push(f);
        if (f & 8) {
          let rep = b[p++];
          while (rep-- > 0) flags.push(f);
        }
      }
      const xs: number[] = [];
      let x = 0;
      for (let i = 0; i < numPoints; i++) {
        const f = flags[i];
        if (f & 2) {
          const dx = b[p++];
          x += f & 16 ? dx : -dx;
        } else if (!(f & 16)) {
          x += b.readInt16BE(p);
          p += 2;
        }
        xs.push(x);
      }
      const ys: number[] = [];
      let y = 0;
      for (let i = 0; i < numPoints; i++) {
        const f = flags[i];
        if (f & 4) {
          const dy = b[p++];
          y += f & 32 ? dy : -dy;
        } else if (!(f & 32)) {
          y += b.readInt16BE(p);
          p += 2;
        }
        ys.push(y);
      }
      const pts: GlyphPoint[] = [];
      for (let i = 0; i < numPoints; i++) pts.push({ x: xs[i], y: ys[i], on: (flags[i] & 1) !== 0 });
      const contours: GlyphPoint[][] = [];
      let start = 0;
      for (const end of endPts) {
        contours.push(pts.slice(start, end + 1));
        start = end + 1;
      }
      glyph.contours = contours;
    } else if (depth < 4) {
      let p = off + 10;
      const contours: GlyphPoint[][] = [];
      let more = true;
      while (more) {
        const flags = b.readUInt16BE(p);
        const compGid = b.readUInt16BE(p + 2);
        p += 4;
        let arg1: number;
        let arg2: number;
        if (flags & 1) {
          arg1 = b.readInt16BE(p);
          arg2 = b.readInt16BE(p + 2);
          p += 4;
        } else {
          arg1 = b.readInt8(p);
          arg2 = b.readInt8(p + 1);
          p += 2;
        }
        let a = 1;
        let bb = 0;
        let c = 0;
        let d = 1;
        if (flags & 8) {
          a = d = b.readInt16BE(p) / 16384;
          p += 2;
        } else if (flags & 64) {
          a = b.readInt16BE(p) / 16384;
          d = b.readInt16BE(p + 2) / 16384;
          p += 4;
        } else if (flags & 128) {
          a = b.readInt16BE(p) / 16384;
          bb = b.readInt16BE(p + 2) / 16384;
          c = b.readInt16BE(p + 4) / 16384;
          d = b.readInt16BE(p + 6) / 16384;
          p += 8;
        }
        const dx = flags & 2 ? arg1 : 0;
        const dy = flags & 2 ? arg2 : 0;
        const sub = this.parseGlyph(compGid, depth + 1);
        if (sub.contours) {
          for (const contour of sub.contours) {
            contours.push(
              contour.map((pt) => ({
                x: a * pt.x + c * pt.y + dx,
                y: bb * pt.x + d * pt.y + dy,
                on: pt.on,
              })),
            );
          }
        }
        more = (flags & 32) !== 0;
      }
      glyph.contours = contours;
    }
    this.glyphCache.set(gid, glyph);
    return glyph;
  }

  measure(text: string, size: number, tracking = 0): TextMetrics {
    const scale = size / this.unitsPerEm;
    const track = tracking * this.unitsPerEm;
    let pen = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    let capHeight = 0;
    for (const ch of text) {
      const gid = this.glyphIndex(ch.codePointAt(0) ?? 0);
      const g = this.parseGlyph(gid);
      if (g.contours && g.contours.length > 0) {
        minX = Math.min(minX, pen + g.xMin);
        maxX = Math.max(maxX, pen + g.xMax);
        minY = Math.min(minY, g.yMin);
        maxY = Math.max(maxY, g.yMax);
      }
      pen += g.advance + track;
    }
    const hGid = this.glyphIndex(72);
    const h = this.parseGlyph(hGid);
    if (h.contours) capHeight = h.yMax * scale;
    if (!Number.isFinite(minX)) return { width: 0, height: 0, advance: pen * scale, capHeight };
    return { width: (maxX - minX) * scale, height: (maxY - minY) * scale, advance: pen * scale, capHeight };
  }

  fitSize(text: string, maxWidth: number, tracking = 0): number {
    const m = this.measure(text, 1000, tracking);
    if (m.width <= 0) return 1000;
    return (maxWidth / m.width) * 1000;
  }

  render(text: string, size: number, tracking = 0, padExtra = 0): TextMask {
    const scale = size / this.unitsPerEm;
    const track = tracking * this.unitsPerEm;
    let pen = 0;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    const placed: Array<{ glyph: Glyph; pen: number }> = [];
    for (const ch of text) {
      const gid = this.glyphIndex(ch.codePointAt(0) ?? 0);
      const g = this.parseGlyph(gid);
      placed.push({ glyph: g, pen });
      if (g.contours && g.contours.length > 0) {
        minX = Math.min(minX, pen + g.xMin);
        maxX = Math.max(maxX, pen + g.xMax);
        minY = Math.min(minY, g.yMin);
        maxY = Math.max(maxY, g.yMax);
      }
      pen += g.advance + track;
    }
    const pad = Math.ceil(size * 0.45 + padExtra);
    if (!Number.isFinite(minX)) {
      return { width: 1, height: 1, data: new Uint8Array(1), baseline: pad, pad };
    }
    const width = Math.ceil((maxX - minX) * scale) + pad * 2;
    const height = Math.ceil((maxY - minY) * scale) + pad * 2;
    const data = new Uint8Array(width * height);
    const mask: Mask = { width, height, data };
    for (const item of placed) {
      const g = item.glyph;
      if (!g.contours || g.contours.length === 0) continue;
      const polys: Point[][] = [];
      for (const contour of g.contours) {
        const flat = flattenContour(contour);
        if (flat.length < 3) continue;
        polys.push(
          flat.map(([x, y]) => [
            pad + (item.pen + x - minX) * scale,
            pad + (maxY - y) * scale,
          ]),
        );
      }
      fillMaskPolygons(polys, mask);
    }
    return { width, height, data, baseline: pad + maxY * scale, pad };
  }
}
