/**
 * Record all browser-based scenes for the Cadence demo video using Playwright.
 *
 * Expects the app running at CADENCE_URL (default http://localhost:8765).
 * Each scene is recorded as a separate video clip.
 *
 * Output: clips/<scene>.mp4 at 1280×720
 *
 * Usage:
 *   node scripts/record-browser.mjs [scene-name]
 *   # Without argument: records all scenes
 *   # With argument: records just that scene (e.g. "04-ask")
 *
 * Scene durations are read from audio/ directory when available, otherwise
 * SCENE_DURATIONS fallback values are used.
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, renameSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIPS_DIR  = join(SCRIPT_DIR, '..', 'clips');
const AUDIO_DIR  = join(SCRIPT_DIR, '..', 'audio');

const BASE_URL = process.env.CADENCE_URL ?? 'http://localhost:8765';
const USER     = process.env.CADENCE_USER ?? 'filip';
const PASS     = process.env.CADENCE_PASS ?? 'cadence-test';

const WIDTH  = 1280;
const HEIGHT = 720;

/** Fallback durations (seconds) when audio hasn't been generated yet. */
const SCENE_DURATIONS = {
  '02-overview':      10,
  '03-sync':          14,
  '04-ask':           22,
  '05-flow-metrics':  18,
  '06-hygiene':       14,
  '07-release-notes': 12,
  '08-planner':       13,
};

function getAudioDuration(sceneKey) {
  const mp3 = join(AUDIO_DIR, `${sceneKey}.mp3`);
  if (!existsSync(mp3)) return SCENE_DURATIONS[sceneKey] ?? 15;
  try {
    const out = execSync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp3}"`,
      { stdio: ['pipe', 'pipe', 'pipe'] }
    ).toString().trim();
    return parseFloat(out);
  } catch {
    return SCENE_DURATIONS[sceneKey] ?? 15;
  }
}

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
  const loginBtn = page.locator('button:has-text("Sign in")');
  if (!(await loginBtn.isVisible({ timeout: 3000 }).catch(() => false))) return;

  console.log('  🔑 Logging in...');
  await page.fill('input[placeholder="Username"]', USER);
  await page.fill('input[placeholder="Password"]', PASS);
  await loginBtn.click();
  await page.waitForTimeout(2000);
  console.log('  ✅ Logged in');
}

async function convertWebmToMp4(webmPath, mp4Path) {
  execSync(
    `ffmpeg -y -i "${webmPath}" -c:v libx264 -preset fast -crf 20 -c:a aac "${mp4Path}"`,
    { stdio: 'pipe' }
  );
  unlinkSync(webmPath);
}

function latestWebm(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.webm'));
  if (files.length === 0) return null;
  return join(dir, files.sort().pop());
}

// ─── Scene definitions ─────────────────────────────────────────────────────

async function scene03Sync(page, duration) {
  console.log(`  🎬 03-sync (${duration}s)`);
  await page.goto(`${BASE_URL}/#/sync`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('main', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Scroll down to show sync history / logs
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    window.scrollTo({ top: 300, behavior: 'smooth' });
    await delay(2000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(Math.max(0, (duration - 5) * 1000));
}

async function scene02Overview(page, duration) {
  console.log(`  🎬 02-overview (${duration}s)`);
  await page.goto(`${BASE_URL}/#/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('.grid, [class*="grid"]', { timeout: 5000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Gently scroll down to show all tool cards, then scroll back
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    window.scrollTo({ top: 300, behavior: 'smooth' });
    await delay(1500);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(Math.max(0, (duration - 4) * 1000));
}

async function scene04Ask(page, duration) {
  console.log(`  🎬 04-ask (${duration}s)`);
  await page.goto(`${BASE_URL}/#/ask`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('textarea, input[type="text"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(1500);
  // Type a question
  const input = page.locator('textarea, input[type="text"]').first();
  await input.fill('How many stories did we complete last sprint?');
  await page.waitForTimeout(1000);
  await input.press('Enter');
  // Wait for streaming response to start
  await page.waitForTimeout(Math.max(0, (duration - 6) * 1000));
}

async function scene05FlowMetrics(page, duration) {
  console.log(`  🎬 05-flow-metrics (${duration}s)`);
  await page.goto(`${BASE_URL}/#/flow-metrics`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table, canvas, [class*="kpi"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Scroll to show charts and aging table
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    window.scrollTo({ top: 400, behavior: 'smooth' });
    await delay(2000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(Math.max(0, (duration - 6) * 1000));
}

async function scene06Hygiene(page, duration) {
  console.log(`  🎬 06-hygiene (${duration}s)`);
  await page.goto(`${BASE_URL}/#/hygiene`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('table, [class*="rule"], [class*="kpi"]', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2000);
  // Scroll through violations
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    window.scrollTo({ top: 300, behavior: 'smooth' });
    await delay(2000);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await page.waitForTimeout(Math.max(0, (duration - 5) * 1000));
}

async function scene07ReleaseNotes(page, duration) {
  console.log(`  🎬 07-release-notes (${duration}s)`);
  await page.goto(`${BASE_URL}/#/release-notes`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[class*="version"], table, main', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Click first version in the sidebar if visible
  const firstVersion = page.locator('[class*="sidebar"] li, [class*="version-item"]').first();
  if (await firstVersion.isVisible({ timeout: 2000 }).catch(() => false)) {
    await firstVersion.click();
    await page.waitForTimeout(1500);
  }
  await page.waitForTimeout(Math.max(0, (duration - 5) * 1000));
}

async function scene08Planner(page, duration) {
  console.log(`  🎬 08-planner (${duration}s)`);
  await page.goto(`${BASE_URL}/#/planner`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('[class*="planner"], [class*="timeline"], [class*="gantt"], main', { timeout: 8000 }).catch(() => {});
  await page.waitForTimeout(2500);
  // Scroll horizontally in the timeline if needed
  await page.evaluate(async () => {
    const delay = ms => new Promise(r => setTimeout(r, ms));
    const timeline = document.querySelector('[class*="timeline"], [class*="gantt"], [class*="planner-chart"]');
    if (timeline) {
      timeline.scrollLeft = 200;
      await delay(1500);
      timeline.scrollLeft = 0;
    }
  });
  await page.waitForTimeout(Math.max(0, (duration - 5) * 1000));
}

// ─── Recorder ──────────────────────────────────────────────────────────────

const SCENE_FNS = {
  '02-overview':      scene02Overview,
  '03-sync':          scene03Sync,
  '04-ask':           scene04Ask,
  '05-flow-metrics':  scene05FlowMetrics,
  '06-hygiene':       scene06Hygiene,
  '07-release-notes': scene07ReleaseNotes,
  '08-planner':       scene08Planner,
};

async function recordScene(browser, sceneKey, sceneFn) {
  const duration = getAudioDuration(sceneKey);
  const context = await browser.newContext({
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: {
      dir: CLIPS_DIR,
      size: { width: WIDTH, height: HEIGHT },
    },
  });
  const page = await context.newPage();
  await login(page);
  await sceneFn(page, duration);
  await context.close();

  // Rename the webm to known name, then convert
  const webm = latestWebm(CLIPS_DIR);
  if (!webm) throw new Error(`No .webm found in ${CLIPS_DIR} after recording ${sceneKey}`);
  const mp4 = join(CLIPS_DIR, `${sceneKey}.mp4`);
  const tmpWebm = join(CLIPS_DIR, `${sceneKey}.webm`);
  renameSync(webm, tmpWebm);
  console.log(`     Converting to mp4...`);
  convertWebmToMp4(tmpWebm, mp4);
  console.log(`  ✅ Saved: ${mp4}`);
}

async function main() {
  mkdirSync(CLIPS_DIR, { recursive: true });

  const targetScene = process.argv[2] ?? null;

  console.log(`Connecting to ${BASE_URL}...`);
  await waitForServer(`${BASE_URL}/api/auth`);
  console.log('✅ App is up\n');

  const scenesToRun = targetScene
    ? [[targetScene, SCENE_FNS[targetScene]]]
    : Object.entries(SCENE_FNS);

  const browser = await chromium.launch({ headless: true });

  try {
    for (const [key, fn] of scenesToRun) {
      if (!fn) {
        console.warn(`⚠️  Unknown scene: ${key}`);
        continue;
      }
      await recordScene(browser, key, fn);
    }
    console.log('\n✅ All browser scenes recorded.');
  } finally {
    await browser.close();
  }
}

main().catch(err => {
  console.error('Browser recording failed:', err.message);
  process.exit(1);
});
