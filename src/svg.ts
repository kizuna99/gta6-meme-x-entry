import type { Point } from './raster.ts';

export interface SvgPath {
  points: Point[][];
  fill: string;
}

export interface ParsedSvg {
  paths: SvgPath[];
  viewBox: [number, number, number, number];
}

function tokenize(d: string): string[] {
  return d.match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) ?? [];
}

function flattenQuad(p0: Point, p1: Point, p2: Point): Point[] {
  const out: Point[] = [];
  const steps = 14;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * p0[0] + 2 * mt * t * p1[0] + t * t * p2[0],
      mt * mt * p0[1] + 2 * mt * t * p1[1] + t * t * p2[1],
    ]);
  }
  return out;
}

function flattenCubic(p0: Point, p1: Point, p2: Point, p3: Point): Point[] {
  const out: Point[] = [];
  const steps = 20;
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const mt = 1 - t;
    out.push([
      mt * mt * mt * p0[0] + 3 * mt * mt * t * p1[0] + 3 * mt * t * t * p2[0] + t * t * t * p3[0],
      mt * mt * mt * p0[1] + 3 * mt * mt * t * p1[1] + 3 * mt * t * t * p2[1] + t * t * t * p3[1],
    ]);
  }
  return out;
}

export function parsePath(d: string): Point[][] {
  const tokens = tokenize(d);
  const subpaths: Point[][] = [];
  let current: Point = [0, 0];
  let start: Point = [0, 0];
  let sub: Point[] = [];
  let i = 0;
  let cmd = '';
  const num = (): number => Number(tokens[i++]);
  const isCmd = (t: string): boolean => /^[a-zA-Z]$/.test(t);
  const finish = () => {
    if (sub.length >= 3) subpaths.push(sub);
    sub = [];
  };
  while (i < tokens.length) {
    if (isCmd(tokens[i])) {
      cmd = tokens[i++];
    } else if (cmd === 'M') {
      cmd = 'L';
    } else if (cmd === 'm') {
      cmd = 'l';
    }
    if (!cmd) break;
    const rel = cmd === cmd.toLowerCase();
    const c = cmd.toUpperCase();
    if (c === 'M') {
      const x = num();
      const y = num();
      finish();
      current = rel ? [current[0] + x, current[1] + y] : [x, y];
      start = current;
      sub = [current];
    } else if (c === 'L') {
      const x = num();
      const y = num();
      current = rel ? [current[0] + x, current[1] + y] : [x, y];
      sub.push(current);
    } else if (c === 'H') {
      const x = num();
      current = [rel ? current[0] + x : x, current[1]];
      sub.push(current);
    } else if (c === 'V') {
      const y = num();
      current = [current[0], rel ? current[1] + y : y];
      sub.push(current);
    } else if (c === 'Q') {
      const x1 = num();
      const y1 = num();
      const x = num();
      const y = num();
      const p1: Point = rel ? [current[0] + x1, current[1] + y1] : [x1, y1];
      const p2: Point = rel ? [current[0] + x, current[1] + y] : [x, y];
      sub.push(...flattenQuad(current, p1, p2));
      current = p2;
    } else if (c === 'C') {
      const x1 = num();
      const y1 = num();
      const x2 = num();
      const y2 = num();
      const x = num();
      const y = num();
      const p1: Point = rel ? [current[0] + x1, current[1] + y1] : [x1, y1];
      const p2: Point = rel ? [current[0] + x2, current[1] + y2] : [x2, y2];
      const p3: Point = rel ? [current[0] + x, current[1] + y] : [x, y];
      sub.push(...flattenCubic(current, p1, p2, p3));
      current = p3;
    } else if (c === 'Z') {
      finish();
      current = start;
    } else {
      i++;
    }
  }
  finish();
  return subpaths;
}

export function parseSvg(svgText: string): ParsedSvg {
  const vbMatch = svgText.match(/viewBox\s*=\s*"([^"]+)"/);
  const viewBox = (vbMatch ? vbMatch[1].split(/[\s,]+/).map(Number) : [0, 0, 100, 100]) as [number, number, number, number];
  const paths: SvgPath[] = [];
  const re = /<path\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svgText))) {
    const attrs = m[1];
    const d = attrs.match(/\bd\s*=\s*"([^"]+)"/);
    if (!d) continue;
    const fill = attrs.match(/\bfill\s*=\s*"([^"]+)"/);
    const stroke = attrs.match(/\bstroke\s*=\s*"([^"]+)"/);
    if (!fill || fill[1] === 'none' || stroke) continue;
    paths.push({ points: parsePath(d[1]), fill: fill[1] });
  }
  return { paths, viewBox };
}

export function transformSvg(svg: ParsedSvg, height: number, centerX: number, topY: number): { paths: SvgPath[]; width: number; height: number } {
  const [vx, vy, vw, vh] = svg.viewBox;
  const scale = height / vh;
  const width = vw * scale;
  const ox = centerX - width / 2 - vx * scale;
  const oy = topY - vy * scale;
  const paths = svg.paths.map((p) => ({
    fill: p.fill,
    points: p.points.map((sub) => sub.map(([x, y]) => [ox + x * scale, oy + y * scale] as Point)),
  }));
  return { paths, width, height };
}
