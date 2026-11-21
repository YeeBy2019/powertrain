// Records a short guided demo: a sales engineer walks through the hall with a real cursor.
// One unbroken take on a virtual clock so every run is identical. node tools/film.mjs
import { createRequire } from 'node:module'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const require = createRequire(import.meta.url)
const { chromium } = require('playwright')
os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)

const PORT = process.env.PORT ?? 5495
import { fileURLToPath } from 'node:url'
const toolsDir = path.dirname(fileURLToPath(import.meta.url))
const outputRoot = path.resolve(toolsDir, '../media')
const framesDir = path.join(outputRoot, 'frames')
fs.rmSync(framesDir, { recursive: true, force: true })
fs.mkdirSync(framesDir, { recursive: true })
const FPS = 30
const FRAME_MS = 1000 / FPS
const TOTAL_FRAMES = 420

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
const problems = []
page.on('pageerror', (error) => problems.push(error.message))
await page.goto(`http://localhost:${PORT}/?preroll=900&dpr=1`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => {
  window.advanceVirtualFrame?.(0)
  return window.__app?.ready
}, null, { timeout: 240000, polling: 1000 })
for (let index = 0; index < 16; index++) {
  await page.evaluate((milliseconds) => window.advanceVirtualFrame(milliseconds), 0)
  await page.waitForTimeout(100)
}

const session = await page.context().newCDPSession(page)
let frame = 0
let mouse = { x: 900, y: 420 }
await page.mouse.move(mouse.x, mouse.y)

async function capture() {
  await page.evaluate((milliseconds) => {
    window.advanceVirtualFrame(milliseconds)
    window.tickFilmCursor()
  }, FRAME_MS)
  const { data } = await session.send('Page.captureScreenshot', { format: 'png', optimizeForSpeed: true })
  fs.writeFileSync(path.join(framesDir, `${String(frame).padStart(4, '0')}.png`), Buffer.from(data, 'base64'))
  frame++
}

const ease = (progress) => (progress < 0.5 ? 2 * progress * progress : 1 - (-2 * progress + 2) ** 2 / 2)

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

async function orbit(deltaX, deltaY, frames) {
  await page.mouse.down()
  await glide({ x: mouse.x + deltaX, y: mouse.y + deltaY }, frames)
  await page.mouse.up()
}

async function hold(frames) {
  for (let index = 0; index < frames; index++) await capture()
}

async function checkSelected(expected) {
  const kind = await page.evaluate(() => window.__app.selected()?.kind ?? 'none')
  if (kind !== expected) problems.push(`frame ${frame}: expected ${expected}, got ${kind}`)
}

const screenOf = (point) => page.evaluate((p) => window.__app.screenOf(p), point)
// Advance the virtual clock (render skipped, sim still steps) until an AGV is
// actually at a rack with its forks going in / lifting the core clear — the
// real pick-up moment. Returns the unit so the camera can lock onto it.
async function waitForPickup(maxFrames = 2400) {
  return await page.evaluate(({ frameMs, limit }) => {
    const composer = window.__app.composer
    const realRender = composer.render
    composer.render = () => {}
    let hit = null
    try {
      for (let index = 0; index < limit; index++) {
        const unit = window.__app.sim.forklifts.find((item) =>
          item.task?.kind === 'retrieve' && !item.pallet &&
          /Sliding the forks in|Lifting the pallet clear/.test(item.stateLabel || ''))
        if (unit) {
          hit = {
            id: unit.id,
            label: unit.stateLabel,
            sku: ['V8', 'V6', 'V12', 'electric'][unit.task.slot.pallet.sku],
          }
          break
        }
        window.advanceVirtualFrame(frameMs)
      }
    } finally {
      composer.render = realRender
    }
    return hit
  }, { frameMs: FRAME_MS, limit: maxFrames })
}

const busiestLine = () => page.evaluate(() => {
  const { lines } = window.__app.sim
  const line = lines.slice().sort((a, b) => b.conveyorCases.length - a.conveyorCases.length)[0] ?? lines[0]
  return window.__app.screenOf([(line.conveyorStartX + line.conveyorEndX) / 2, 1.6, line.z])
})

const homeBox = await page.locator('#home').boundingBox()
const homePoint = { x: homeBox.x + homeBox.width / 2, y: homeBox.y + homeBox.height / 2 }

async function backToOverview() {
  await glide(homePoint, 16)
  await click()
  await checkSelected('none')
  await hold(26)
}

// 0–2.5 s: the whole hall, a small orbit by the sales engineer.
await orbit(-34, 6, 46)
// Assembly line: cores travel down the belt.
await glide(() => busiestLine(), 22)
await click()
await checkSelected('line')
await hold(74)
await backToOverview()
// AGV taking a core out of a rack: find the real pick-up moment and lock a close view.
// The standard "follow one AGV" shot could land anywhere on its route; this one waits
// until the forks are actually sliding into a shelf, then watches the pallet leave.
const pickup = await waitForPickup()
if (pickup) {
  const locked = await page.evaluate((id) => window.__app.cinematicFollow(id, [3.6, 3.2, 8]), pickup.id)
  if (!locked) problems.push(`frame ${frame}: could not lock camera on ${pickup.id}`)
  await checkSelected('forklift')
  await capture()
  await hold(96)
  await page.evaluate(() => window.__app.releaseFollow())
} else {
  problems.push(`frame ${frame}: no rack pick-up found within the search window`)
}
await backToOverview()
// Parts store: bins on the rack rows.
await glide(() => screenOf([2.14, 2, 0]), 22)
await click()
await checkSelected('rack')
await hold(46)
await backToOverview()
await hold(Math.max(0, TOTAL_FRAMES - frame))

await page.screenshot({ path: path.join(outputRoot, 'last-frame.png') })
const kpis = await page.evaluate(() => document.getElementById('kpis').innerText.replace(/\n/g, ' '))
console.log('frames', frame, kpis, problems.length ? problems.join(' | ') : 'no problems')
fs.writeFileSync(path.join(outputRoot, 'film-meta.json'), JSON.stringify({ fps: FPS, frames: frame, kpis, problems }, null, 2))
await browser.close()
