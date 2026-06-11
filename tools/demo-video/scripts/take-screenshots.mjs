/**
 * Take screenshots of every Cadence tool for use in the demo video.
 *
 * Expects the app running at CADENCE_URL (default http://localhost:8765).
 * Auth: CADENCE_USER / CADENCE_PASS env vars (or falls back to defaults).
 *
 * Output: screenshots/<scene>.png at 1280×720
 *
 * Usage:
 *   node scripts/take-screenshots.mjs
 *   CADENCE_URL=http://localhost:8765 CADENCE_USER=filip CADENCE_PASS=... node scripts/take-screenshots.mjs
 */

import { chromium } from 'playwright';
import { mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(SCRIPT_DIR, '..', 'screenshots');

const BASE_URL = process.env.CADENCE_URL ?? 'http://localhost:8765';
const USER     = process.env.CADENCE_USER ?? 'filip';
const PASS     = process.env.CADENCE_PASS ?? 'cadence-test';

const WIDTH  = 1280;
const HEIGHT = 720;

/** Scenes to screenshot: [filename, hash-route, wait-selector-or-null] */
const SCENES = [
  ['02-overview',      '/',              '.grid'],           // homepage tool cards
  ['04-ask',           '/ask',           '[data-ask],.ask-container,main'],
  ['05-flow-metrics',  '/flow-metrics',  'table,canvas,[class*="flow"],.kpi'],
  ['06-hygiene',       '/hygiene',       'table,[class*="hygiene"],[class*="rule"],.kpi'],
  ['07-release-notes', '/release-notes', '[class*="version"],[class*="release"],table,main'],
  ['08-planner',       '/planner',       '[class*="planner"],[class*="timeline"],[class*="gantt"],main'],
  ['sprint-summary',   '/sprint-summary','table,main'],
  ['prompt-builder',   '/prompt-builder','main'],
  ['sync',             '/sync',          'main'],
];

async function waitForServer(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 401) return;
    } catch { /* not ready */ }
    await new Promise(r => setTimeout(r, 1000));
  }
  throw new Error(`Server not ready: ${url}`);
}

async function login(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });

  // Check if login page rendered (auth required)
  const loginBtn = page.locator('button:has-text("Sign in")');
  if (!(await loginBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;

  console.log('  🔑 Logging in...');
  await page.fill('input[placeholder="Username"]', USER);
  await page.fill('input[placeholder="Password"]', PASS);
  await loginBtn.click();
  await page.waitForURL(/./, { timeout: 8000 });
  await page.waitForTimeout(1500);
  console.log('  ✅ Logged in');
}

async function screenshotScene(page, [name, route, selector]) {
  const url = `${BASE_URL}/#${route}`;
  console.log(`  📸 ${name} — ${url}`);

  await page.goto(url, { waitUntil: 'domcontentloaded' });

  // Try a few selector candidates to wait for meaningful content
  if (selector) {
    const candidates = selector.split(',').map(s => s.trim());
    for (const sel of candidates) {
      try {
        await page.waitForSelector(sel, { timeout: 5000, state: 'visible' });
        break;
      } catch { /* try next */ }
    }
  }

  // Extra settle time for charts and async data
  await page.waitForTimeout(2000);

  const outPath = join(OUT_DIR, `${name}.png`);
  await page.screenshot({ path: outPath, fullPage: false });
  console.log(`     → ${outPath}`);
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  console.log(`Connecting to ${BASE_URL}...`);
  await waitForServer(`${BASE_URL}/api/auth`);
  console.log('✅ App is up\n');

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
  });
  const page = await context.newPage();

  try {
    await login(page);

    console.log('Taking screenshots...');
    for (const scene of SCENES) {
      await screenshotScene(page, scene);
    }

    console.log(`\n✅ ${SCENES.length} screenshots saved to screenshots/`);
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Screenshot failed:', err.message);
  process.exit(1);
});
