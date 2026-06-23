// Capture README screenshots of the running app against live testnet data.
// The dev server must already be running on BASE_URL (npm --prefix web run dev).
// Usage: node web/scripts/shoot-screenshots.mjs
// sourceRef: routes in web/src/App.tsx (/, /auction/:auctionId, /specimen).
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { mkdirSync, existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const OUTPUT_DIR = resolve(SCRIPT_DIR, '../../docs/screenshots')
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

// Which auctions to feature: an open one (staged by stage-demo-auction.sh) and
// a settled one. Override via env when the ids change.
const OPEN_AUCTION_ID = process.env.OPEN_AUCTION_ID || '8'
const SETTLED_AUCTION_ID = process.env.SETTLED_AUCTION_ID || '7'

const shots = [
  { path: '/', file: '01-auctions.png', waitMs: 8000, fullPage: false },
  { path: `/auction/${OPEN_AUCTION_ID}`, file: '02-auction-open.png', waitMs: 9000, fullPage: false },
  { path: `/auction/${SETTLED_AUCTION_ID}`, file: '03-auction-settled.png', waitMs: 9000, fullPage: false },
]

// playwright-core does not bundle a browser; reuse the chromium already in the
// playwright cache (its build number may differ from what the registry expects,
// so resolve the binary by path instead of by version).
const resolveChromeExecutable = () => {
  if (process.env.CHROME_EXECUTABLE && existsSync(process.env.CHROME_EXECUTABLE)) {
    return process.env.CHROME_EXECUTABLE
  }
  const cacheDir = resolve(homedir(), '.cache/ms-playwright')
  if (!existsSync(cacheDir)) return undefined
  const chromiumDirs = readdirSync(cacheDir)
    .filter((name) => name.startsWith('chromium-'))
    .sort()
    .reverse()
  for (const dirName of chromiumDirs) {
    for (const subPath of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const candidate = resolve(cacheDir, dirName, subPath)
      if (existsSync(candidate)) return candidate
    }
  }
  return undefined
}

const main = async () => {
  mkdirSync(OUTPUT_DIR, { recursive: true })
  // --no-sandbox: headless chromium has no usable sandbox under WSL as a
  // non-root user; this is a local screenshot tool, never a production path.
  const executablePath = resolveChromeExecutable()
  const browser = await chromium.launch({
    headless: true,
    args: ['--no-sandbox'],
    ...(executablePath ? { executablePath } : {}),
  })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  })
  const page = await context.newPage()
  page.on('console', (message) => {
    if (message.type() === 'error') console.log(`[shoot] console.error: ${message.text()}`)
  })
  page.on('pageerror', (error) => console.log(`[shoot] pageerror: ${error.message}`))

  for (const shot of shots) {
    const url = `${BASE_URL}${shot.path}`
    console.log(`[shoot] ${url} -> ${shot.file}`)
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    await page.waitForTimeout(shot.waitMs)
    await page.screenshot({ path: resolve(OUTPUT_DIR, shot.file), fullPage: shot.fullPage })
  }

  await browser.close()
  console.log(`[shoot] done, wrote ${shots.length} screenshots to ${OUTPUT_DIR}`)
}

main().catch((error) => {
  console.error(`[shoot] failed: ${error.message}`)
  process.exit(1)
})
