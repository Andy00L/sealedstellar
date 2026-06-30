// Capture of the Faucet dialog (the "Add tokens" feature). Opens the app, clicks
// the Faucet trigger, and writes two screenshots into docs/screenshots/.
// The dev server must already be running on BASE_URL (npm --prefix web run dev).
// sourceRef: web/scripts/shoot-screenshots.mjs (chromium resolution + launch args).
import { chromium } from 'playwright-core'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
import { existsSync, readdirSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = process.env.SCREENSHOT_OUT_DIR
  ? resolve(process.env.SCREENSHOT_OUT_DIR)
  : resolve(SCRIPT_DIR, '../../docs/screenshots')
const BASE_URL = process.env.BASE_URL || 'http://localhost:5173'

const resolveChromeExecutable = () => {
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
  mkdirSync(OUT_DIR, { recursive: true })
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
  page.on('pageerror', (error) => console.log(`[shoot] pageerror: ${error.message}`))

  await page.goto(BASE_URL, { waitUntil: 'load', timeout: 30000 })
  await page.waitForTimeout(2500)

  // Open the faucet dialog via the trigger button (title is on the <button>).
  await page.locator('button[title="Get testnet funds"]').click({ timeout: 15000 })

  await page.getByText('Get testnet funds', { exact: true }).waitFor({ state: 'visible', timeout: 10000 })
  await page.waitForTimeout(700)

  await page.screenshot({ path: resolve(OUT_DIR, 'faucet-dialog-full.png') })

  const dialog = page.getByRole('dialog')
  const box = await dialog.boundingBox()
  if (box) {
    const pad = 28
    await page.screenshot({
      path: resolve(OUT_DIR, 'faucet-dialog.png'),
      clip: {
        x: Math.max(0, box.x - pad),
        y: Math.max(0, box.y - pad),
        width: Math.min(1440 - Math.max(0, box.x - pad), box.width + pad * 2),
        height: box.height + pad * 2,
      },
    })
  }

  await browser.close()
  console.log(`[shoot] wrote faucet dialog shots to ${OUT_DIR}`)
}

main().catch((error) => {
  console.error(`[shoot] failed: ${error.message}`)
  process.exit(1)
})
