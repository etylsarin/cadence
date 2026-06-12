import { chromium } from 'playwright'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, 'public', 'screenshots')
const BASE = 'http://localhost:8765'
const USER = 'team'
const PASS = 'cadence'

const browser = await chromium.launch()
const ctx = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 2,
})
const login = await ctx.request.post(`${BASE}/api/login`, { data: { username: USER, password: PASS } })
console.log('login', login.status())
const page = await ctx.newPage()

const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) })

async function home() {
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' })
  await page.getByText('Flow Metrics', { exact: true }).waitFor()
}
async function open(title) {
  await home()
  await page.getByText(title, { exact: true }).first().click()
  await page.waitForTimeout(1500)
}
// Wait until the page text stops changing (for streaming AI output)
async function settle(maxMs = 120000, quietMs = 4000) {
  const start = Date.now()
  let last = '', lastChange = Date.now()
  while (Date.now() - start < maxMs) {
    const txt = await page.evaluate(() => document.body.innerText)
    if (txt !== last) { last = txt; lastChange = Date.now() }
    else if (Date.now() - lastChange > quietMs) return
    await page.waitForTimeout(1000)
  }
}

async function run(name, fn) {
  try { await fn(); await shot(name); console.log('shot', name) }
  catch (e) { console.log('FAIL', name, e.message); try { await shot(name) } catch {} }
}

// 1. Home
await run('home', async () => { await home(); await page.waitForTimeout(700) })

// 2. Flow Metrics (auto-loads)
await run('flow-metrics', async () => { await open('Flow Metrics'); await page.waitForTimeout(1500) })

// 3. Hygiene (auto-loads)
await run('hygiene', async () => { await open('Hygiene Auditor'); await page.waitForTimeout(1500) })

// 4. Sprint Summary — pick a completed sprint
await run('sprint-summary', async () => {
  await open('Sprint Summary')
  await page.getByText('ADM Sprint 37', { exact: true }).click()
  await page.waitForTimeout(3000)
})

// 5. Prompt Builder — pick a ticket
await run('prompt-builder', async () => {
  await open('Prompt Builder')
  await page.getByText('Add bulk export to catalog', { exact: false }).first().click()
  await page.waitForTimeout(2500)
})

// 6. Epic Planner — tick the first few epic rows into scope (epic titles are
// <input> values, so target each row's clickable checkbox cell instead of text)
await run('planner', async () => {
  await open('Epic Planner')
  const rows = page.locator('tr[data-epic-key]')
  const n = Math.min(3, await rows.count())
  for (let i = 0; i < n; i++) {
    await rows.nth(i).locator('td').first().click()
    await page.waitForTimeout(1500)
  }
  await page.waitForTimeout(2500)
})

// 7. Ask — ask a suggested question, let the answer stream
await run('ask', async () => {
  await open('Ask')
  await page.getByText('What did we deliver last month?', { exact: false }).first().click()
  await page.waitForTimeout(2000)
  await settle(120000, 5000)
})

// 8. Release Notes — pick a version, generate AI notes
await run('release-notes', async () => {
  await open('Release Notes')
  await page.getByText('ADM 2026.Q2.12', { exact: true }).first().click()
  await page.waitForTimeout(2000)
  try {
    await page.getByRole('button', { name: 'Generate', exact: true }).click()
    // wait until the button stops saying "Generating…" (AI finished)
    const start = Date.now()
    while (Date.now() - start < 180000) {
      if (!(await page.getByText('Generating…').count())) break
      await page.waitForTimeout(2000)
    }
    await page.waitForTimeout(2500)
  } catch (e) { console.log('  (generate skipped:', e.message, ')') }
})

await browser.close()
console.log('done')
