import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from './png.ts';
import type { RgbaImage } from './png.ts';
import {
  Canvas,
  applyVignette,
  blurMask,
  dilateMask,
  fillMaskPolygons,
  mix,
  rgba,
  starPoints,
} from './raster.ts';
import type { Color, Mask, Point } from './raster.ts';
import { TrueTypeFont } from './font.ts';
import type { TextMask } from './font.ts';
import { parseSvg, transformSvg } from './svg.ts';
import type { SvgPath } from './svg.ts';

const W = 2048;
const H = 2048;
const S = 2;
const CW = W * S;
const CH = H * S;

interface TextOptions {
  size: number;
  tracking?: number;
  color: Color | ((x: number, y: number) => Color);
  outline?: { width: number; color: Color };
  glow?: { radius: number; color: Color; alpha: number };
  shadow?: { dx: number; dy: number; color: Color; alpha: number };
}

function drawText(c: Canvas, font: TrueTypeFont, text: string, x: number, baselineY: number, opts: TextOptions): TextMask {
  const mask = font.render(text, opts.size * S, opts.tracking ?? 0);
  const dx = x * S - mask.width / 2;
  const dy = baselineY * S - mask.baseline;
  if (opts.shadow) {
    c.blitMask(mask, dx + opts.shadow.dx * S, dy + opts.shadow.dy * S, opts.shadow.color, opts.shadow.alpha);
  }
  if (opts.glow) {
    const glow = blurMask(mask, opts.glow.radius * S, 3);
    c.blitMask(glow, dx, dy, opts.glow.color, opts.glow.alpha);
  }
  if (opts.outline) {
    const dilated = dilateMask(mask, opts.outline.width * S, 28);
    const outline: Mask = { width: mask.width, height: mask.height, data: new Uint8Array(mask.data.length) };
    for (let i = 0; i < outline.data.length; i++) {
      const v = dilated.data[i] - mask.data[i];
      outline.data[i] = v > 0 ? v : 0;
    }
    c.blitMask(outline, dx, dy, opts.outline.color, 1);
  }
  if (typeof opts.color === 'function') c.blitMaskGradient(mask, dx, dy, opts.color, 1);
  else c.blitMask(mask, dx, dy, opts.color, 1);
  return mask;
}

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function drawBackground(c: Canvas): void {
  const stops: Array<[number, Color]> = [
    [0.0, rgba('#07030F')],
    [0.22, rgba('#16052A')],
    [0.38, rgba('#3B094F')],
    [0.5, rgba('#8C126A')],
    [0.56, rgba('#C41C83')],
    [0.6, rgba('#FF7A3D')],
    [0.63, rgba('#C33A6B')],
    [0.72, rgba('#5A0D52')],
    [0.86, rgba('#230628')],
    [1.0, rgba('#0D0315')],
  ];
  const data = c.data;
  for (let y = 0; y < CH; y++) {
    const t = y / (CH - 1);
    let k = 0;
    while (k < stops.length - 2 && t > stops[k + 1][0]) k++;
    const a = stops[k];
    const b = stops[k + 1];
    const f = Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0])));
    const col = mix(a[1], b[1], f);
    const base = y * CW * 4;
    for (let x = 0; x < CW; x++) {
      const i = base + x * 4;
      data[i] = col[0];
      data[i + 1] = col[1];
      data[i + 2] = col[2];
      data[i + 3] = 255;
    }
  }

  const rand = lcg(0x6d616b65);
  for (let i = 0; i < 110; i++) {
    const x = rand() * W;
    const y = rand() * H * 0.42;
    const r = 0.8 + rand() * 2.4;
    const col = rand() > 0.72 ? rgba('#FF88C4', 0.35 + rand() * 0.5) : rgba('#FFFFFF', 0.25 + rand() * 0.55);
    c.fillCircle(x * S, y * S, r * S, col);
  }

  const horizon = 0.6 * H;
  c.fillRect(0, (horizon - 2) * S, W * S, 4 * S, rgba('#FFD36E', 0.28));
  c.fillRect(0, (horizon - 1) * S, W * S, 2 * S, rgba('#FFF3C4', 0.42));

  const waveRand = lcg(0x77617665);
  for (let i = 0; i < 64; i++) {
    const y = horizon + 18 + waveRand() * (H * 0.34);
    const x = waveRand() * W * 0.7;
    const len = 40 + waveRand() * 360;
    const col = waveRand() > 0.5 ? rgba('#FFB07A', 0.05 + waveRand() * 0.11) : rgba('#FF6AA8', 0.04 + waveRand() * 0.1);
    c.fillRect(x * S, y * S, len * S, (1 + waveRand() * 3) * S, col);
  }
}

function drawSun(c: Canvas): void {
  const cx = W * 0.5 * S;
  const cy = H * 0.555 * S;
  const r = H * 0.275 * S;
  c.radialGlow(cx, cy, r * 1.5, rgba('#FF7A3D', 0.5), 0.6);
  c.radialGlow(cx, cy, r * 1.12, rgba('#FFD36E', 0.5), 0.45);
  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(CW, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(CH, Math.ceil(cy + r));
  const center = rgba('#FFE8A3');
  const edge = rgba('#FF4F8B');
  for (let y = y0; y < y1; y++) {
    const dy = y + 0.5 - cy;
    for (let x = x0; x < x1; x++) {
      const dx = x + 0.5 - cx;
      const d = Math.sqrt(dx * dx + dy * dy) / r;
      if (d >= 1) continue;
      let a = 1 - (d - 0.9) / 0.1;
      if (a > 1) a = 1;
      if (a <= 0) continue;
      if (y > cy) {
        const band = Math.floor((y - cy) / (15 * S)) % 2;
        if (band === 0) a *= 0.52;
      }
      const col = mix(center, edge, Math.pow(d, 0.7));
      c.blend(x, y, col[0], col[1], col[2], a * 0.96);
    }
  }
}

function drawBuilding(c: Canvas, x: number, baseY: number, w: number, h: number, color: Color, lit: Color): void {
  const bx = x * S;
  const by = baseY * S;
  const bw = w * S;
  const bh = h * S;
  c.fillRect(bx, by - bh, bw, bh, color);
  c.fillRect(bx + bw * 0.18, by - bh - 18 * S, bw * 0.64, 18 * S, color);
  c.fillRect(bx + bw * 0.34, by - bh - 34 * S, bw * 0.32, 16 * S, color);
  c.strokePolyline(
    [
      [bx + bw * 0.5, by - bh - 34 * S],
      [bx + bw * 0.5, by - bh - 72 * S],
    ],
    2.2 * S,
    color,
  );
  const cols = Math.max(2, Math.floor(w / 18));
  const rows = Math.max(2, Math.floor(h / 24));
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      if ((row * 7 + col * 11 + Math.floor(x) * 3) % 5 > 1) continue;
      const wx = bx + (col + 0.28) * (bw / cols);
      const wy = by - bh + (row + 0.28) * (bh / rows);
      c.fillRect(wx, wy, Math.max(2, (bw / cols) * 0.28), Math.max(2, (bh / rows) * 0.34), lit);
    }
  }
  c.strokePolyline(
    [
      [bx + bw - 1.5 * S, by - bh + 6 * S],
      [bx + bw - 1.5 * S, by - 6 * S],
    ],
    1.6 * S,
    rgba('#FF4FA3', 0.45),
  );
}

function drawSkyline(c: Canvas): void {
  const horizon = 0.6 * H;
  const dark = rgba('#190A2C', 0.97);
  const lit = rgba('#FFD36E', 0.5);
  const litPink = rgba('#FF88C4', 0.48);
  const left: Array<[number, number, number]> = [
    [-24, 120, 190],
    [78, 86, 255],
    [160, 110, 170],
    [258, 70, 300],
    [326, 100, 220],
    [414, 78, 160],
  ];
  const right: Array<[number, number, number]> = [
    [1548, 92, 175],
    [1636, 74, 245],
    [1708, 112, 190],
    [1810, 86, 300],
    [1890, 104, 225],
    [1982, 90, 170],
  ];
  const center: Array<[number, number, number]> = [
    [590, 70, 92],
    [680, 92, 130],
    [790, 64, 84],
    [1180, 76, 100],
    [1268, 90, 140],
    [1370, 68, 96],
  ];
  for (const [x, w, h] of left) drawBuilding(c, x, horizon + 10, w, h, dark, lit);
  for (const [x, w, h] of right) drawBuilding(c, x, horizon + 10, w, h, dark, litPink);
  for (const [x, w, h] of center) drawBuilding(c, x, horizon + 6, w, h, rgba('#160826', 0.9), rgba('#FF88C4', 0.35));
}

function drawPalm(c: Canvas, x: number, baseY: number, height: number, lean: number, color: Color): void {
  const bx = x * S;
  const by = baseY * S;
  const h = height * S;
  const lx = lean * S;
  const left: Point[] = [];
  const right: Point[] = [];
  for (let i = 0; i <= 28; i++) {
    const t = i / 28;
    const px = bx + lx * t * t + Math.sin(t * Math.PI) * 8 * S;
    const py = by - h * t;
    const w = (20 - 14 * t) * S;
    left.push([px - w, py]);
    right.push([px + w, py]);
  }
  c.fillPolygon([...left, ...right.reverse()], color);
  c.strokePolyline(right, 1.5 * S, rgba('#C41C83', 0.14));
  const tx = bx + lx;
  const ty = by - h;
  c.fillCircle(tx, ty, 13 * S, color);
  c.fillCircle(tx - 17 * S, ty + 7 * S, 9 * S, color);
  c.fillCircle(tx + 18 * S, ty + 8 * S, 9 * S, color);
  c.fillCircle(tx + 1 * S, ty + 18 * S, 8 * S, color);

  const drawFrond = (a: number, scale: number, widthScale: number, vein: boolean) => {
    const len = h * (0.44 + 0.07 * Math.abs(Math.sin(a * 1.7))) * scale;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const tip: Point = [tx + dx * len, ty + dy * len * 0.55 + len * 0.29];
    const ctrl: Point = [tx + dx * len * 0.48, ty + dy * len * 0.48 - len * 0.14];
    const center: Point[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const mt = 1 - t;
      center.push([mt * mt * tx + 2 * mt * t * ctrl[0] + t * t * tip[0], mt * mt * ty + 2 * mt * t * ctrl[1] + t * t * tip[1]]);
    }
    const leaf: Point[] = [];
    for (let i = 0; i <= 18; i++) {
      const t = i / 18;
      const p = center[i];
      const q = center[Math.min(18, i + 1)];
      const r = center[Math.max(0, i - 1)];
      const vx = q[0] - r[0];
      const vy = q[1] - r[1];
      const vl = Math.hypot(vx, vy) || 1;
      const w = (17 * (1 - t) + 1.1) * S * widthScale;
      leaf.push([p[0] - (vy / vl) * w, p[1] + (vx / vl) * w]);
    }
    for (let i = 18; i >= 0; i--) {
      const t = i / 18;
      const p = center[i];
      const q = center[Math.min(18, i + 1)];
      const r = center[Math.max(0, i - 1)];
      const vx = q[0] - r[0];
      const vy = q[1] - r[1];
      const vl = Math.hypot(vx, vy) || 1;
      const w = (17 * (1 - t) + 1.1) * S * widthScale;
      leaf.push([p[0] + (vy / vl) * w, p[1] - (vx / vl) * w]);
    }
    c.fillPolygon(leaf, color);
    if (vein) c.strokePolyline(center, 1.3 * S, rgba('#FF4FA3', 0.12));
  };

  const angles = [-2.95, -2.5, -2.05, -1.58, -1.1, -0.63, -0.17, 0.3, 0.77, 1.24];
  for (const a of angles) drawFrond(a, 0.8, 0.72, false);
  for (const a of angles) drawFrond(a + 0.08, 1, 1, true);
  drawFrond(-Math.PI / 2, 0.72, 0.9, true);
  drawFrond(-Math.PI / 2 - 0.22, 0.62, 0.8, false);
  drawFrond(-Math.PI / 2 + 0.22, 0.62, 0.8, false);
}

function drawScene(c: Canvas): void {
  drawSun(c);
  drawSkyline(c);
  drawPalm(c, 180, 0.64 * H, 780, -82, rgba('#0D0518', 0.98));
  drawPalm(c, 1868, 0.64 * H, 830, 88, rgba('#0D0518', 0.98));
  drawPalm(c, 390, 0.615 * H, 440, -34, rgba('#1A0A2E', 0.62));
  drawPalm(c, 1670, 0.615 * H, 475, 38, rgba('#1A0A2E', 0.62));
}

function drawBadge(c: Canvas, font: TrueTypeFont): void {
  const text = 'GTA VI  •  LAUNCH WEEK';
  const x = W / 2 - 380;
  const y = 92;
  const w = 760;
  const h = 104;
  c.fillRoundedRect((x + 0) * S, (y + 10) * S, w * S, h * S, 52 * S, rgba('#000000', 0.35));
  c.fillRoundedRect(x * S, y * S, w * S, h * S, 52 * S, rgba('#191419', 0.66));
  c.strokePolyline(
    [
      [x + 52, y],
      [x + w - 52, y],
      [x + w, y + 52],
      [x + w - 52, y + h],
      [x + 52, y + h],
      [x, y + 52],
      [x + 52, y],
    ].map(([px, py]) => [px * S, py * S] as Point),
    3.4 * S,
    rgba('#FF4FA3', 0.9),
  );
  const size = Math.min(46, font.fitSize(text, 650, 0.055));
  const m = font.measure(text, size, 0.055);
  drawText(c, font, text, W / 2, y + h / 2 + m.capHeight / 2, {
    size,
    tracking: 0.055,
    color: rgba('#FFFFFF'),
    shadow: { dx: 0, dy: 2, color: rgba('#000000', 0.5), alpha: 0.5 },
  });
  c.fillCircle(112 * S, 144 * S, 9 * S, rgba('#FF4FA3', 0.95));
  c.fillCircle(1936 * S, 144 * S, 9 * S, rgba('#FFD36E', 0.95));
}

function drawHeadlines(c: Canvas, font: TrueTypeFont): void {
  const line1 = 'GTA VI: 13 YEARS TO LOAD.';
  const line2 = 'AI AGENT: 13 MINUTES TO GET PAID.';
  const size1 = Math.min(205, font.fitSize(line1, 1840, 0.005));
  const size2 = Math.min(195, font.fitSize(line2, 1840, 0.005));
  drawText(c, font, line1, W / 2, 378, {
    size: size1,
    tracking: 0.005,
    color: (x, y) => mix(rgba('#FFFFFF'), rgba('#FFE9F6'), Math.max(0, Math.min(1, (y - 210 * S) / (190 * S)))),
    outline: { width: 9, color: rgba('#191419', 0.95) },
    glow: { radius: 27, color: rgba('#FF4FA3', 0.55), alpha: 0.3 },
  });
  drawText(c, font, line2, W / 2, 590, {
    size: size2,
    tracking: 0.005,
    color: (x, y) => {
      const t = Math.max(0, Math.min(1, (y - (590 - size2 * 0.78) * S) / (size2 * 0.9 * S)));
      return mix(rgba('#FFF6C7'), rgba('#FFB000'), t);
    },
    outline: { width: 9, color: rgba('#191419', 0.95) },
    glow: { radius: 29, color: rgba('#FF8A3D', 0.6), alpha: 0.32 },
  });
}

function drawGhostGlow(c: Canvas): void {
  const cx = W * 0.5 * S;
  const cy = 1040 * S;
  c.radialGlow(cx, cy, 650 * S, rgba('#C41C83', 0.55), 0.28);
  c.radialGlow(cx, cy, 470 * S, rgba('#FF4FA3', 0.55), 0.3);
  c.fillEllipse(cx, 1408 * S, 360 * S, 42 * S, rgba('#000000', 0.22));
  c.fillEllipse(cx, 1408 * S, 240 * S, 26 * S, rgba('#000000', 0.28));
  c.fillEllipse(cx, 1409 * S, 322 * S, 30 * S, rgba('#FF4FA3', 0.16));
  c.fillEllipse(cx, 1418 * S, 448 * S, 17 * S, rgba('#FF88C4', 0.1));
  for (let i = 0; i < 6; i++) {
    const w = (330 - i * 42) * S;
    c.fillRect(cx - w / 2, (1414 + i * 7) * S, w, 2 * S, rgba('#FFD36E', 0.09));
  }
}

function drawSparkle(c: Canvas, x: number, y: number, size: number, color: Color): void {
  const s = size * S;
  const px = x * S;
  const py = y * S;
  c.radialGlow(px, py, s * 2.4, rgba('#FF4FA3', 0.5), 0.22);
  c.fillPolygon(
    [
      [px, py - s],
      [px + s * 0.17, py - s * 0.17],
      [px + s, py],
      [px + s * 0.17, py + s * 0.17],
      [px, py + s],
      [px - s * 0.17, py + s * 0.17],
      [px - s, py],
      [px - s * 0.17, py - s * 0.17],
    ],
    color,
  );
}

function drawSparkles(c: Canvas): void {
  drawSparkle(c, 662, 768, 20, rgba('#FFFFFF', 0.95));
  drawSparkle(c, 1388, 744, 16, rgba('#FFE9F6', 0.95));
  drawSparkle(c, 1372, 1250, 23, rgba('#FFFFFF', 0.9));
  drawSparkle(c, 682, 1268, 13, rgba('#FF88C4', 0.9));
}

function drawRibbon(c: Canvas, font: TrueTypeFont): void {
  const pts: Point[] = [
    [196, 1462],
    [1852, 1462],
    [1902, 1516],
    [1852, 1570],
    [196, 1570],
    [146, 1516],
  ].map(([x, y]) => [x * S, y * S] as Point);
  c.fillPolygon(pts.map(([x, y]) => [x, y + 10 * S] as Point), rgba('#000000', 0.38));
  c.strokePolyline([...pts, pts[0]], 11 * S, rgba('#191419', 0.98));
  c.fillPolygon(pts, rgba('#FFC94A'));
  c.strokePolyline(
    [
      [206 * S, 1470 * S],
      [1842 * S, 1470 * S],
    ],
    4 * S,
    rgba('#FFF3C4', 0.85),
  );
  c.strokePolyline(
    [
      [206 * S, 1562 * S],
      [1842 * S, 1562 * S],
    ],
    5 * S,
    rgba('#B86A00', 0.8),
  );
  c.fillPolygon(starPoints(420 * S, 1516 * S, 30 * S, 13 * S), rgba('#191419', 0.9));
  c.fillPolygon(starPoints(1628 * S, 1516 * S, 30 * S, 13 * S), rgba('#191419', 0.9));
  const text = 'MISSION PASSED';
  const size = Math.min(112, font.fitSize(text, 1150, 0.02));
  const m = font.measure(text, size, 0.02);
  drawText(c, font, text, W / 2, 1516 + m.capHeight / 2, {
    size,
    tracking: 0.02,
    color: rgba('#191419'),
    shadow: { dx: 0, dy: 3, color: rgba('#FFF3C4', 0.55), alpha: 0.55 },
  });
}

function drawWordmark(c: Canvas, svgText: string): void {
  const svg = parseSvg(svgText);
  const wm = transformSvg(svg, 166 * S, W * 0.5 * S, 1734 * S);
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const path of wm.paths) {
    for (const sub of path.points) {
      for (const [x, y] of sub) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  const pad = 54 * S;
  const maskW = Math.ceil(maxX - minX) + pad * 2;
  const maskH = Math.ceil(maxY - minY) + pad * 2;
  const mask: Mask = { width: maskW, height: maskH, data: new Uint8Array(maskW * maskH) };
  const shifted: Point[][] = [];
  for (const path of wm.paths) {
    for (const sub of path.points) {
      shifted.push(sub.map(([x, y]) => [x - minX + pad, y - minY + pad] as Point));
    }
  }
  fillMaskPolygons(shifted, mask);
  c.blitMask(mask, minX - pad, minY - pad + 7 * S, rgba('#000000', 0.45), 0.55);
  const glow = blurMask(mask, 26 * S, 3);
  c.blitMask(glow, minX - pad, minY - pad, rgba('#C41C83', 0.9), 0.5);
  c.blitMask(mask, minX - pad, minY - pad, rgba('#FF4FA3', 0.75), 0.22);
  for (const path of wm.paths) {
    const fill = path.fill.toLowerCase() === '#c41c83' ? rgba('#C41C83') : rgba('#FFFFFF');
    c.fillPath(path.points, fill);
  }
}

function drawFooter(c: Canvas, font: TrueTypeFont, svgText: string): void {
  const tagline = 'REAL MONEY FOR HUMANS + AI AGENTS';
  const size = Math.min(64, font.fitSize(tagline, 1460, 0.015));
  drawText(c, font, tagline, W / 2, 1698, {
    size,
    tracking: 0.015,
    color: rgba('#FFFFFF'),
    outline: { width: 5, color: rgba('#191419', 0.95) },
    glow: { radius: 14, color: rgba('#FF4FA3', 0.55), alpha: 0.22 },
  });
  drawWordmark(c, svgText);
}

function drawFinalMark(final: Canvas, mark: RgbaImage): void {
  const size = 760;
  const x = W / 2 - size / 2;
  const y = 640;
  final.blitImage(mark, x, y, size, size, 1);
}

export function generateMeme(assetsDir: string): Buffer {
  const mark = decodePng(readFileSync(join(assetsDir, 'mark-1024.png')));
  const font = new TrueTypeFont(readFileSync(join(assetsDir, 'Anton-Regular.ttf')));
  const svgText = readFileSync(join(assetsDir, 'wordmark-on-dark.svg'), 'utf8');
  const c = new Canvas(CW, CH);
  drawBackground(c);
  drawScene(c);
  drawBadge(c, font);
  drawHeadlines(c, font);
  drawGhostGlow(c);
  drawSparkles(c);
  drawRibbon(c, font);
  drawFooter(c, font, svgText);
  const small = c.downsample(S);
  applyVignette(small, 0.36);
  const final = new Canvas(W, H);
  final.data.set(small.data);
  drawFinalMark(final, mark);
  return encodePng(final);
}
