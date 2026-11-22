// Records the natural-language console demo with a REAL LLM driving the tools.
// Requires POWERTRAIN_LLM_KEY (and optionally POWERTRAIN_LLM_BASE / _MODEL /
// _PROVIDER) in the environment. The key is injected into localStorage only;
// it is never printed, written to a file, or shown on screen.
// Run from the project root with the dev server on 5495: node tools/film-llm.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)

const KEY = process.env.POWERTRAIN_LLM_KEY
if (!KEY) {
  console.error('POWERTRAIN_LLM_KEY is not set. Export your key first; it will not be logged or saved.')
  process.exit(1)
}
const PROVIDER = process.env.POWERTRAIN_LLM_PROVIDER || 'openai'
const BASE = process.env.POWERTRAIN_LLM_BASE || (PROVIDER === 'deepseek' ? 'https://api.deepseek.com' : 'https://api.openai.com/v1')
const MODEL = process.env.POWERTRAIN_LLM_MODEL || (PROVIDER === 'deepseek' ? 'deepseek-flash' : 'gpt-4o-mini')

const PORT = process.env.PORT ?? 5495
const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const outputRoot = path.resolve(toolsDir, '../media')
const framesDir = path.join(outputRoot, 'frames')
fs.rmSync(framesDir, { recursive: true, force: true })
fs.mkdirSync(framesDir, { recursive: true })
const FPS = 30
const FRAME_MS = 1000 / FPS

function virtualClock() {
  let now = 0
  const epoch = Date.UTC(2026, 9, 31, 1, 0)
  let nextId = 1
  const callbacks = new Map()
  window.requestAnimationFrame = (callback) => {
    const id = nextId++
    callbacks.set(id, callback)
    return id
  }
  window.cancelAnimationFrame = (id) => callbacks.delete(id)
  performance.now = () => now
  Date.now = () => epoch + now
  window.advanceVirtualFrame = (milliseconds) => {
    now += milliseconds
    const due = [...callbacks.values()]
    callbacks.clear()
    due.forEach((callback) => callback(now))
  }
  addEventListener('DOMContentLoaded', () => {
    const cursor = document.createElement('div')
    cursor.innerHTML = '<svg width="30" height="30" viewBox="0 0 24 24"><path d="M4 2.5l15 9.2-6.6 1.4 3.9 7.2-2.8 1.5-3.9-7.3L4.8 19z" fill="#fff" stroke="#10151b" stroke-width="1.5" stroke-linejoin="round"/></svg>'
    Object.assign(cursor.style, { position: 'fixed', left: '0', top: '0', zIndex: 99999, pointerEvents: 'none', transform: 'translate(-3px,-2px)', filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.6))' })
    document.body.appendChild(cursor)
    const ring = document.createElement('div')
    Object.assign(ring.style, { position: 'fixed', width: '36px', height: '36px', marginLeft: '-18px', marginTop: '-18px', borderRadius: '50%', border: '3px solid #35d6bf', zIndex: 99998, pointerEvents: 'none', opacity: '0' })
    document.body.appendChild(ring)
    let ringFrames = 0
    addEventListener('mousemove', (event) => {
      cursor.style.left = `${event.clientX}px`
      cursor.style.top = `${event.clientY}px`
    }, true)
    addEventListener('mousedown', (event) => {
      ring.style.left = `${event.clientX}px`
      ring.style.top = `${event.clientY}px`
      ringFrames = 12
    }, true)
    window.tickFilmCursor = () => {
      ring.style.opacity = String(Math.max(0, ringFrames / 12) * 0.9)
      ring.style.transform = `scale(${1.5 - ringFrames / 20})`
      ringFrames = Math.max(0, ringFrames - 1)
    }
  })
}

const browser = await chromium.launch({ channel: 'msedge', headless: true, args: ['--use-angle=d3d11', '--enable-gpu', '--ignore-gpu-blocklist'] })
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } })
await page.addInitScript(virtualClock)
// Inject the key before any app code reads localStorage. Never logged.
await page.addInitScript((settings) => {
  localStorage.setItem('powertrain.llm.v1', JSON.stringify(settings))
}, { mode: 'live', provider: PROVIDER, base: BASE, model: MODEL, apiKey: KEY })
const problems = []
page.on('pageerror', (error) => problems.push(error.message))
// preroll=60 leaves one line free and some activity on the belts, so a dispatch
// immediately creates a real retrieve task instead of only queueing an order.
await page.goto(`http://localhost:${PORT}/?preroll=60&dpr=1&llm=live`, { waitUntil: 'domcontentloaded' })
await page.waitForFunction(() => {
  window.advanceVirtualFrame?.(0)
  return window.__app?.ready && window.__app?.llm
}, null, { timeout: 240000, polling: 1000 })
for (let index = 0; index < 16; index++) {
  await page.evaluate((ms) => window.advanceVirtualFrame(ms), 0)
  await page.waitForTimeout(100)
}

const session = await page.context().newCDPSession(page)
let frame = 0
let mouse = { x: 900, y: 420 }
await page.mouse.move(mouse.x, mouse.y)

async function capture() {
  await page.evaluate((ms) => {
    window.advanceVirtualFrame(ms)
    window.tickFilmCursor()
  }, FRAME_MS)
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
  fs.writeFileSync(path.join(framesDir, `${String(frame).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
  frame++
}

const ease = (p) => (p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2)
async function glide(target, frames) {
  const start = { ...mouse }
  for (let index = 1; index <= frames; index++) {
    const goal = typeof target === 'function' ? await target() : target
    const progress = ease(index / frames)
    mouse = { x: start.x + (goal.x - start.x) * progress, y: start.y + (goal.y - start.y) * progress }
    await page.mouse.move(mouse.x, mouse.y)
    await capture()
  }
}
async function click() {
  await page.mouse.down()
  await capture()
  await page.mouse.up()
  await capture()
}
async function hold(frames) {
  for (let index = 0; index < frames; index++) await capture()
}

// Drive a command through the REAL LLM and wait for the async reply. Polling by
// milliseconds is essential: the virtual clock owns requestAnimationFrame, so
// the default rAF polling in waitForFunction would never fire.
async function command(text) {
  const resultPromise = page.evaluate((commandText) => window.__app.llm.submit(commandText), text)
  await page.waitForFunction(
    () => !document.querySelector('#chat-log .chat-msg.thinking'),
    null,
    { timeout: 60000, polling: 200 },
  )
  await hold(30)
  const result = await resultPromise
  if (!result.ok) problems.push(`command failed: ${text} → ${result.message}`)
  return result
}

const launcherBox = await page.locator('#chat-launcher').boundingBox()
const launcherPoint = { x: launcherBox.x + launcherBox.width / 2, y: launcherBox.y + launcherBox.height / 2 }

// 0–2 s: the hall.
await glide({ x: 900, y: 420 }, 12)
await hold(30)
// Open the console.
await glide(launcherPoint, 18)
await click()
await hold(20)

// The headline moment: dispatch a real pickup.
const dispatch = await command('Dispatch an AGV to pick a V8 core from Row 2 and take it to Line 1')
const dispatched = dispatch.outcomes?.[0]?.ok
if (!dispatched) problems.push('dispatch did not create a task')
await page.evaluate(() => window.__app.setSpeed(10))
await hold(20)

// Find the AGV actually carrying OUR order and follow the pickup.
const hero = await page.evaluate(() => {
  const unit = window.__app.sim.forklifts.find((item) =>
    item.task?.kind === 'retrieve' && item.task.line?.order?.id > 9000)
  return unit ? { id: unit.id, orderId: unit.task.line.order.id } : null
})
if (hero) {
  // Fast-forward (without rendering) until our AGV is actually at the rack with
  // its forks going in — the same trick as film.mjs — then use viewFor's aisle
  // camera (point + [1.2, 3.8, 11]), which is designed to look down the aisle
  // and does not bury the camera inside a rack like a fixed offset can.
  const reachedPickup = await page.evaluate(({ id, frameMs }) => {
    const composer = window.__app.composer
    const realRender = composer.render
    composer.render = () => {}
    let hit = false
    try {
      for (let index = 0; index < 3000; index++) {
        const unit = window.__app.sim.forklifts.find((item) => item.id === id)
        if (unit && /Sliding the forks in|Lifting the pallet clear/.test(unit.stateLabel || '')) {
          hit = true
          break
        }
        window.advanceVirtualFrame(frameMs)
      }
    } finally {
      composer.render = realRender
    }
    return hit
  }, { id: hero.id, frameMs: FRAME_MS })
  if (!reachedPickup) problems.push('AGV never reached the rack pickup')
  // Keep the whole hall in view instead of chasing the AGV between racks: a
  // close follow clips through racking in this dense layout. The clean high
  // angle still shows the AGV moving to the shelf, and the selection card and
  // chat reply carry the narrative.
  await page.evaluate((id) => {
    const unit = window.__app.sim.forklifts.find((item) => item.id === id)
    window.__app.focus({ kind: 'forklift', unit }) // keep the AGV's status card live
    window.__app.releaseFollow() // cancel the selection flight so setView sticks
    window.__app.setView([28, 7, 22], [5, 1.5, -2]) // hold a clean wide angle
  }, hero.id)
  await hold(150)
  await page.evaluate(() => window.__app.home())
} else {
  problems.push('no AGV picked up the LLM-created order')
}
await page.evaluate(() => window.__app.home())

// Status, focus, reset — all through the LLM.
await command("What's the status?")
await command('Focus on FL-1')
await hold(60)
await command('Back to overview')
await hold(60)

await page.screenshot({ path: path.join(outputRoot, 'last-frame.png') })
const kpis = await page.evaluate(() => document.getElementById('kpis').innerText.replace(/\n/g, ' '))
console.log('frames', frame, kpis, problems.length ? problems.join(' | ') : 'no problems')
const actualMode = await page.evaluate(() => window.__app.llm.getSettings().mode)
fs.writeFileSync(path.join(outputRoot, 'film-meta.json'), JSON.stringify({
  fps: FPS, frames: frame, kpis, problems, mode: actualMode, provider: PROVIDER, model: MODEL,
  hero, dispatchedOrder: hero?.orderId ?? null,
}, null, 2))
await browser.close()
