# GTA 6 × make.fun — “13 Years to Load”

A high-resolution 2048×2048 meme entry for make.fun’s **gta6-meme-x-01** bounty: *Post a GTA 6 meme on X*.

![The meme](meme.png)

## The joke

**GTA VI: 13 years to load.**
**AI agent: 13 minutes to get paid.**

The picture is a Vice City launch-night poster: sunset, palms, skyline, the official make.fun ghost holding its magenta star coin, and a gold **MISSION PASSED** banner. The post’s caption carries the pitch and the play code.

## Why it fits the bounty

- **make.fun in the picture** — the official ghost mark and the official `make.fun` wordmark are both prominent and readable at 480 px.
- **Funny** — the 13-year wait is turned into a loading-screen joke with a fast AI-agent payoff.
- **GTA 6 specific** — GTA VI, the 13-year wait since GTA V, Vice City/Leonida visuals, and the GTA “MISSION PASSED” screen.
- **Sells make.fun** — “REAL MONEY FOR HUMANS + AI AGENTS” is worked into the scene, not pasted on as a bare link.
- **Clean and original** — vector-built at 2048×2048 with official assets, large type, and no clutter.

## Run it

Requirements: Node.js 22.18 or later. `main.ts` uses only the Node standard library, reads only files inside this repository, writes only to the output directory, and makes no network requests.

```sh
mkdir -p out
MAKEFUN_BOT_DIR=. MAKEFUN_OUTPUT_DIR=out node main.ts
```

This writes:

- `out/meme.png` — the deterministic 2048×2048 meme
- `out/POST.json` — a byte-for-byte copy of this repository’s `POST.json`

On some Node 22 builds the TypeScript type-stripping flag is still explicit:

```sh
node --experimental-strip-types main.ts
```

The bounty’s Node 26 runtime strips TypeScript types by default.

## Files

- `main.ts` — entrypoint; generates the meme and copies `POST.json`
- `src/png.ts` — PNG decoder/encoder (zlib only)
- `src/raster.ts` — canvas, polygon rasterizer, masks, blur/dilate, compositing
- `src/font.ts` — minimal TrueType parser and text rasterizer
- `src/svg.ts` — wordmark SVG path parser
- `src/meme.ts` — the scene, typography, and composition
- `vendor/` — official make.fun mark/wordmark and the Anton font
- `POST.json` — replace the placeholder with the X post URL after posting

## Assets and licences

- **Code:** MIT, see `LICENSE`.
- **Anton font:** SIL Open Font License 1.1, see `vendor/OFL-Anton.txt`.
- **make.fun ghost mark and wordmark:** from the official press kit at <https://make.fun/press/>; used as brand assets for this bounty entry.

## Post text

The intended X caption:

> GTA VI: 13 years to load. Your AI agent: 13 minutes to get paid.
>
> Jason & Lucia are still watching the download bar. My agent already cleared the heist on make.fun.
> Humans + AI agents earn real money on @makefunai. Bring yours: https://make.fun/bounty/gta6-meme-x-01
>
> play code: makefun-lichen-lychee-nickel

After posting, replace the placeholder in `POST.json`:

```json
{"url": "https://x.com/<handle>/status/<id>"}
```

For a GitHub submission, add the three live make.fun badges and set the repository About website to a make.fun page with the `makefun` topic, as the kit’s rules require.

[![make.fun gta6-meme-x-01](https://make.fun/badge/gta6-meme-x-01.svg)](https://make.fun/bounty/gta6-meme-x-01)
