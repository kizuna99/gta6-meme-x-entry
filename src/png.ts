import { deflateSync, inflateSync } from 'node:zlib';

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readU32(buf: Buffer, off: number): number {
  return ((buf[off] << 24) | (buf[off + 1] << 16) | (buf[off + 2] << 8) | buf[off + 3]) >>> 0;
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

export function decodePng(buf: Buffer): RgbaImage {
  if (buf.length < 8 || !buf.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('not a PNG file');
  }
  let pos = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 8;
  let colorType = 6;
  let interlace = 0;
  const idat: Buffer[] = [];
  while (pos + 12 <= buf.length) {
    const len = readU32(buf, pos);
    const type = buf.toString('ascii', pos + 4, pos + 8);
    const data = buf.subarray(pos + 8, pos + 8 + len);
    pos += 12 + len;
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8];
      colorType = data[9];
      interlace = data[12];
    } else if (type === 'IDAT') {
      idat.push(data);
    } else if (type === 'IEND') {
      break;
    }
  }
  if (width <= 0 || height <= 0) throw new Error('PNG has no IHDR');
  if (bitDepth !== 8) throw new Error(`unsupported PNG bit depth ${bitDepth}`);
  if (interlace !== 0) throw new Error('interlaced PNG is not supported');
  const channels = colorType === 6 ? 4 : colorType === 2 ? 3 : colorType === 4 ? 2 : colorType === 0 ? 1 : 0;
  if (channels === 0) throw new Error(`unsupported PNG color type ${colorType}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = new Uint8ClampedArray(width * height * 4);
  let prev = new Uint8Array(stride);
  let row = new Uint8Array(stride);
  let off = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[off++];
    const line = raw.subarray(off, off + stride);
    off += stride;
    for (let i = 0; i < stride; i++) {
      const a = i >= channels ? row[i - channels] : 0;
      const b = prev[i];
      const c = i >= channels ? prev[i - channels] : 0;
      let v = line[i];
      if (filter === 1) v = (v + a) & 255;
      else if (filter === 2) v = (v + b) & 255;
      else if (filter === 3) v = (v + ((a + b) >> 1)) & 255;
      else if (filter === 4) v = (v + paeth(a, b, c)) & 255;
      else if (filter !== 0) throw new Error(`bad PNG filter ${filter}`);
      row[i] = v;
    }
    const base = y * width * 4;
    if (colorType === 6) {
      out.set(row, base);
    } else if (colorType === 2) {
      for (let x = 0; x < width; x++) {
        out[base + x * 4] = row[x * 3];
        out[base + x * 4 + 1] = row[x * 3 + 1];
        out[base + x * 4 + 2] = row[x * 3 + 2];
        out[base + x * 4 + 3] = 255;
      }
    } else if (colorType === 0) {
      for (let x = 0; x < width; x++) {
        const g = row[x];
        out[base + x * 4] = g;
        out[base + x * 4 + 1] = g;
        out[base + x * 4 + 2] = g;
        out[base + x * 4 + 3] = 255;
      }
    } else if (colorType === 4) {
      for (let x = 0; x < width; x++) {
        const g = row[x * 2];
        out[base + x * 4] = g;
        out[base + x * 4 + 1] = g;
        out[base + x * 4 + 2] = g;
        out[base + x * 4 + 3] = row[x * 2 + 1];
      }
    }
    const tmp = prev;
    prev = row;
    row = tmp;
  }
  return { width, height, data: out };
}

let crcTable: Uint32Array | null = null;

function crc32(buf: Buffer): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const name = Buffer.from(type, 'ascii');
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  name.copy(out, 4);
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([name, data])), 8 + data.length);
  return out;
}

function filterRow(row: Uint8Array | Uint8ClampedArray, prev: Uint8Array | Uint8ClampedArray, bpp: number, filter: number, out: Uint8Array): number {
  let sum = 0;
  for (let i = 0; i < row.length; i++) {
    const a = i >= bpp ? row[i - bpp] : 0;
    const b = prev[i];
    const c = i >= bpp ? prev[i - bpp] : 0;
    let v = row[i];
    if (filter === 1) v = (v - a) & 255;
    else if (filter === 2) v = (v - b) & 255;
    else if (filter === 3) v = (v - ((a + b) >> 1)) & 255;
    else if (filter === 4) v = (v - paeth(a, b, c)) & 255;
    out[i] = v;
    sum += v < 128 ? v : 256 - v;
  }
  return sum;
}

export function encodePng(img: RgbaImage): Buffer {
  const { width, height, data } = img;
  const bpp = 4;
  const stride = width * bpp;
  const raw = Buffer.alloc((stride + 1) * height);
  let prev: Uint8Array | Uint8ClampedArray = new Uint8Array(stride);
  const trial = new Uint8Array(stride);
  const best = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const row = data.subarray(y * stride, (y + 1) * stride);
    let bestFilter = 0;
    let bestScore = Infinity;
    for (let f = 0; f < 5; f++) {
      const score = filterRow(row, prev, bpp, f, trial);
      if (score < bestScore) {
        bestScore = score;
        bestFilter = f;
        best.set(trial);
      }
    }
    const base = y * (stride + 1);
    raw[base] = bestFilter;
    raw.set(best, base + 1);
    prev = row;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    PNG_SIGNATURE,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
