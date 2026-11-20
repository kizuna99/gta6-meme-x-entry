import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateMeme } from './src/meme.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));
const BOT_DIR = resolve(process.env.MAKEFUN_BOT_DIR ?? ROOT);
const OUTPUT_DIR = resolve(process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

function main(): void {
  mkdirSync(OUTPUT_DIR, { recursive: true });
  const png = generateMeme(join(BOT_DIR, 'vendor'));
  writeFileSync(join(OUTPUT_DIR, 'meme.png'), png);
  copyFileSync(join(BOT_DIR, 'POST.json'), join(OUTPUT_DIR, 'POST.json'));
}

try {
  main();
} catch (err) {
  console.error(`entry failed: ${(err as Error).message}`);
  process.exit(1);
}
