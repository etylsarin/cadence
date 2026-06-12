# Cadence — pitch deck (Slidev)

A visual sales pitch for Cadence, built with [Slidev](https://sli.dev). The deck is
screenshot-driven: real captures of the running app, not diagrams.

## View / present

```bash
npm install
npm run dev        # opens http://localhost:3030 (presenter mode at /presenter)
```

Arrow keys / space to navigate · `o` overview · `f` fullscreen. Speaker notes
live in `<!-- -->` blocks per slide and show in presenter mode.

## Export

```bash
npm run build      # static SPA -> dist/
npm run export     # cadence.pdf (one page per slide)
```

## Files

- `slides.md` — the deck (one `---` separated slide each)
- `style.css` — global overrides: white background, hidden nav page-number, `.shot`/`.kicker`/`.is-pitch` pitch helpers
- `public/logo.png` — Quantum Burrito logo · `public/cadence.svg` — Cadence mark
- `public/screenshots/` — product screenshots used on the tool slides
- `capture.mjs` — Playwright script that logs into the local app and re-captures every screenshot

## Refreshing the screenshots

Screenshots are captured from the **running app**. Start Cadence locally first
(serves the SPA + API on :8765), then run the capture script:

```bash
# from the repo root, with synced data present:
.venv/bin/python -m uvicorn server:app --app-dir backend --port 8765

# then, from slides/:
node capture.mjs
```

`capture.mjs` logs in (creds read from the app's auth env vars — defaults `team`/`cadence`),
navigates each tool client-side, drives the interactions needed to populate data
(selects a sprint, asks a question, ticks epics, generates release notes), and writes
PNGs to `public/screenshots/`. Ask and Release Notes call the configured AI provider.
