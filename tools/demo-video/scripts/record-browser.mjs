/**
 * Record Cadence demo scenes as individual clips.
 *
 * Each scene is recorded in its own Playwright context so every clip
 * starts cold, avoids cross-scene state, and can be trimmed to exactly
 * its narration duration during compose.
 *
 * Output: clips/{key}.mp4  for each scene
 *
 * Usage:
 *   node scripts/record-browser.mjs           # all scenes
 *   node scripts/record-browser.mjs 04-ask    # single scene
 */

import { chromium } from 'playwright';
import { mkdirSync, existsSync, readdirSync, unlinkSync } from 'fs';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const CLIPS_DIR  = join(SCRIPT_DIR, '..', 'clips');
const AUDIO_DIR  = join(SCRIPT_DIR, '..', 'audio');

const BASE_URL = process.env.CADENCE_URL  ?? 'http://localhost:8765';
const USER     = process.env.CADENCE_USER ?? 'filip';
const PASS     = process.env.CADENCE_PASS ?? 'cadence-test';

const WIDTH  = 1280;
const HEIGHT = 720;

// Fallback durations (seconds) when TTS audio hasn't been generated yet.
const SCENE_DURATIONS = {
  '01-intro':          5,
  '02-overview':       8,
  '03-sync':           9,
  '04-ask':           18,
  '05-flow-metrics':  11,
  '06-hygiene':        9,
  '07-release-notes':  9,
  '08-sprint-summary': 8,
  '09-planner':        8,
  '10-prompt-builder': 7,
  '11-wrapup':         4,
};

const TRANSITION_S   = 0.8;
const RECORD_BUFFER  = 2.0; // extra time beyond audio + transition; 1s consumed by start trim

const delay = ms => new Promise(r => setTimeout(r, ms));

function audioDuration(sceneKey) {
  const mp3 = join(AUDIO_DIR, `${sceneKey}.mp3`);
  if (!existsSync(mp3)) return SCENE_DURATIONS[sceneKey] ?? 10;
  try {
    return parseFloat(
      execSync(
        `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${mp3}"`,
        { stdio: ['pipe', 'pipe', 'pipe'] }
      ).toString().trim()
    );
  } catch {
    return SCENE_DURATIONS[sceneKey] ?? 10;
  }
}

function remaining(t0, durationS) {
  return Math.max(0, durationS * 1000 - (Date.now() - t0));
}

// ─── Auth ─────────────────────────────────────────────────────────────────

async function waitForServer(url, retries = 30) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(url);
      if (r.ok || r.status === 401) return;
    } catch { /* not ready */ }
    await delay(1000);
  }
  throw new Error(`Server not ready: ${url}`);
}

async function getStorageState(browser) {
  const ctx  = await browser.newContext({ viewport: { width: WIDTH, height: HEIGHT } });
  const page = await ctx.newPage();
  await page.goto(`${BASE_URL}/`, { waitUntil: 'domcontentloaded' });
  const loginBtn = page.locator('button:has-text("Sign in")');
  if (await loginBtn.isVisible({ timeout: 3000 }).catch(() => false)) {
    await page.fill('input[placeholder="Username"]', USER);
    await page.fill('input[placeholder="Password"]', PASS);
    await loginBtn.click();
    await delay(1500);
  }
  const state = await ctx.storageState();
  await ctx.close();
  return state;
}

// ─── Helpers ──────────────────────────────────────────────────────────────

async function goto(page, hash) {
  await page.goto(`${BASE_URL}/#${hash}`, { waitUntil: 'domcontentloaded' });
  await delay(700);
}

async function clickFirstSidebarItem(page, timeoutMs = 2000) {
  const btn = page.locator('button.w-full.text-left').first();
  if (await btn.isVisible({ timeout: timeoutMs }).catch(() => false)) {
    await btn.click({ timeout: 2000 });
    return true;
  }
  return false;
}

// ─── Scenes ───────────────────────────────────────────────────────────────

async function scene01Intro(page, dur) {
  const t0 = Date.now();
  await goto(page, '/');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(remaining(t0, dur));
}

async function scene02Overview(page, dur) {
  const t0 = Date.now();
  await goto(page, '/');
  await page.waitForSelector('.grid a, [class*="card"]', { timeout: 5000 }).catch(() => {});
  await delay(1500);
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: 'smooth' }));
  await delay(1800);
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await delay(remaining(t0, dur));
}

async function scene03Sync(page, dur) {
  const t0 = Date.now();
  await goto(page, '/sync');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(2000);
  const logsTab = page.locator('button:has-text("Sync Logs"), button:has-text("Logs")').first();
  if (await logsTab.isVisible({ timeout: 1500 }).catch(() => false)) {
    await logsTab.click();
    await delay(1500);
  }
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await delay(remaining(t0, dur));
}

async function scene04Ask(page, dur) {
  const t0 = Date.now();
  await goto(page, '/ask');
  await page.waitForSelector('textarea', { timeout: 10000 }).catch(() => {});
  await delay(500);
  const textarea = page.locator('textarea').first();
  if (await textarea.isVisible({ timeout: 2000 }).catch(() => false)) {
    await textarea.click({ timeout: 3000 });
    await textarea.pressSequentially('What are our top delivery blockers this sprint?', { delay: 45 });
    await delay(500);
    await textarea.press('Enter');
    await page.waitForSelector('[class*="message"], [class*="response"], [class*="stream"]', {
      timeout: 8000,
    }).catch(() => {});
  }
  await delay(remaining(t0, dur));
}

async function scene05FlowMetrics(page, dur) {
  const t0 = Date.now();
  await goto(page, '/flow-metrics');
  await page.waitForSelector('table', { timeout: 8000 }).catch(() => {});
  await delay(1800);
  await page.evaluate(() => window.scrollTo({ top: 220, behavior: 'smooth' }));
  await delay(1200);
  const stageRow = page.locator('tbody tr.cursor-pointer').first();
  if (await stageRow.isVisible({ timeout: 1500 }).catch(() => false)) {
    await stageRow.click();
    await delay(1800);
  }
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'smooth' }));
  await delay(remaining(t0, dur));
}

async function scene06Hygiene(page, dur) {
  const t0 = Date.now();

  // Mock the AI suggest endpoint so no real API key is needed for the demo.
  await page.route('**/hygiene/api/suggest', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({
      suggestions: [
        '**1. Story points** — 23 tickets are missing estimates. Run a 15-min pointing session with the team; use the bulk-edit view to update all at once.',
        '**2. Empty epics** — 4 epics have no child tickets. Either archive them or create placeholder stories to track intent.',
        '**3. Stale in-progress** — 7 tickets have been In Progress for >14 days. Review in the next standup and either close, split, or reassign.',
        '**Working agreement** — Add a Definition of Ready that requires story points and an epic link before a ticket enters the sprint.',
      ].join('\n\n'),
    }),
  }));

  await goto(page, '/hygiene');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(1500);
  await page.evaluate(() => window.scrollTo({ top: 260, behavior: 'smooth' }));
  await delay(1800);
  const draftBtn = page.locator('button:has-text("Draft with AI")').first();
  if (await draftBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await draftBtn.click();
    await page.waitForSelector('[class*="plan"], [class*="suggest"], [class*="prose"], .whitespace-pre', {
      timeout: 4000,
    }).catch(() => {});
    await delay(1000);
  }
  await delay(remaining(t0, dur));
}

async function scene07ReleaseNotes(page, dur) {
  const t0 = Date.now();
  await goto(page, '/release-notes');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(1200);
  const clicked = await clickFirstSidebarItem(page, 4000);
  if (clicked) await delay(1500);
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await delay(1000);
  const generateBtn = page.locator('button:has-text("Generate")').first();
  if (await generateBtn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await generateBtn.click();
    await delay(800);
  }
  await delay(remaining(t0, dur));
}

async function scene08SprintSummary(page, dur) {
  const t0 = Date.now();
  await goto(page, '/sprint-summary');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(1200);
  const clicked = await clickFirstSidebarItem(page, 4000);
  if (clicked) await delay(1500);
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await delay(remaining(t0, dur));
}

async function scene09Planner(page, dur) {
  const t0 = Date.now();
  await goto(page, '/planner');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(1800);
  await page.evaluate(async () => {
    const el = document.querySelector('[class*="timeline"], [class*="gantt"], [class*="chart"]');
    if (el) el.scrollLeft = 160;
    window.scrollTo({ top: 200, behavior: 'smooth' });
  });
  await delay(1800);
  await page.evaluate(() => {
    const el = document.querySelector('[class*="timeline"], [class*="gantt"], [class*="chart"]');
    if (el) el.scrollLeft = 0;
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
  await delay(remaining(t0, dur));
}

async function scene10PromptBuilder(page, dur) {
  const t0 = Date.now();
  await goto(page, '/prompt-builder');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(1200);
  const clicked = await clickFirstSidebarItem(page, 4000);
  if (clicked) await delay(1500);
  await page.evaluate(() => window.scrollTo({ top: 200, behavior: 'smooth' }));
  await delay(remaining(t0, dur));
}

async function scene11Wrapup(page, dur) {
  const t0 = Date.now();
  await goto(page, '/');
  await page.waitForSelector('main', { timeout: 5000 }).catch(() => {});
  await delay(remaining(t0, dur));
}

// ─── Scene registry ───────────────────────────────────────────────────────

const SCENES = [
  ['01-intro',          scene01Intro],
  ['02-overview',       scene02Overview],
  ['03-sync',           scene03Sync],
  ['04-ask',            scene04Ask],
  ['05-flow-metrics',   scene05FlowMetrics],
  ['06-hygiene',        scene06Hygiene],
  ['07-release-notes',  scene07ReleaseNotes],
  ['08-sprint-summary', scene08SprintSummary],
  ['09-planner',        scene09Planner],
  ['10-prompt-builder', scene10PromptBuilder],
  ['11-wrapup',         scene11Wrapup],
];

// ─── Recording ────────────────────────────────────────────────────────────

function latestWebm(dir) {
  const files = readdirSync(dir).filter(f => f.endsWith('.webm'));
  return files.length ? join(dir, files.sort().pop()) : null;
}

async function recordScene(browser, storageState, key, fn) {
  const audioDur = audioDuration(key);
  // Budget: audio duration + transition hold + load buffer
  const budget = audioDur + TRANSITION_S + RECORD_BUFFER;

  const context = await browser.newContext({
    storageState,
    viewport: { width: WIDTH, height: HEIGHT },
    recordVideo: { dir: CLIPS_DIR, size: { width: WIDTH, height: HEIGHT } },
  });
  const page = await context.newPage();
  await fn(page, budget);
  await context.close(); // flushes webm

  const webm = latestWebm(CLIPS_DIR);
  if (!webm) throw new Error(`No .webm found after recording ${key}`);

  const out = join(CLIPS_DIR, `${key}.mp4`);
  execSync(`ffmpeg -y -i "${webm}" -c:v libx264 -preset fast -crf 20 "${out}"`, { stdio: 'pipe' });
  unlinkSync(webm);

  const actualDur = execSync(
    `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${out}"`,
    { stdio: ['pipe', 'pipe', 'pipe'] }
  ).toString().trim();

  console.log(`   ✅ clips/${key}.mp4  (${parseFloat(actualDur).toFixed(1)}s, audio: ${audioDur.toFixed(1)}s)`);
}

// ─── Main ─────────────────────────────────────────────────────────────────

async function main() {
  mkdirSync(CLIPS_DIR, { recursive: true });

  const sceneFilter = process.argv[2];

  const scenesToRecord = sceneFilter
    ? SCENES.filter(([key]) => key === sceneFilter)
    : SCENES;

  if (sceneFilter && scenesToRecord.length === 0) {
    const valid = SCENES.map(([k]) => k).join(', ');
    throw new Error(`Unknown scene: "${sceneFilter}". Valid: ${valid}`);
  }

  console.log(`Connecting to ${BASE_URL}...`);
  await waitForServer(`${BASE_URL}/api/auth`);
  console.log('✅ App is up\n');

  const browser = await chromium.launch({ headless: true });
  try {
    console.log('Logging in...');
    const storageState = await getStorageState(browser);
    console.log('✅ Session ready\n');

    for (const [key, fn] of scenesToRecord) {
      const audioDur = audioDuration(key);
      console.log(`▶  ${key}  (audio: ${audioDur.toFixed(1)}s)`);
      await recordScene(browser, storageState, key, fn);
    }
  } finally {
    await browser.close();
  }

  console.log('\n✅ All scenes recorded.');
}

main().catch(err => {
  console.error('Recording failed:', err.message);
  process.exit(1);
});
