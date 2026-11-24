import { AISLE_ONE_X, AISLE_TWO_X } from './layout.js'
// The live app: renders the sim, runs the camera, and reads every dashboard number from the sim.
import * as THREE from 'three'
import { EffectComposer, EffectPass, RenderPass, BloomEffect, SMAAEffect, VignetteEffect, HueSaturationEffect, BrightnessContrastEffect } from 'postprocessing'
import { N8AOPostPass } from 'n8ao'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { caseOffset, computeKpis, createSim, remainingPathPoints, stepSim, STEP_SECONDS } from './sim.js'
import { buildWorld, composeMatrix, preloadAssets } from './world.js'
import { CONVEYOR_TOP, EMPTY_STACK, OUTBOUND_DROP_Z, STAND_TOP } from './layout.js'
import { mountChat } from './chat.js'
import { applyStaticI18n, createTranslator, getLocale, installLanguageToggle, setLocale, subscribe, tState } from './i18n/index.js'

// ---------- Loading screen ----------
// The markup is static so the screen is visible before this module even executes.
const loaderElement = document.getElementById('loader')
const loaderPhase = document.getElementById('loader-phase')
const loaderPercent = document.getElementById('loader-percent')
const loaderBar = document.getElementById('loader-bar')
const loaderStage = document.getElementById('loader-stage')
const loaderCount = document.getElementById('loader-count')
const loaderStageBar = document.getElementById('loader-stage-bar')
const loaderItem = document.getElementById('loader-item')
const loaderRows = new Map([...document.querySelectorAll('.loader-stages li')].map((row) => [row.dataset.stage, row]))
const STAGE_KEYS = ['environment', 'structure', 'equipment', 'logistics', 'engines', 'compile']
let stageIndex = -1

let t = createTranslator(getLocale())
installLanguageToggle()
applyStaticI18n(document, t)

function showProgress({ key, label, loaded, total, overall, item }) {
  loaderPhase.textContent = key === 'ready' ? t('loader.phase.finalizing') : t('loader.phase.loading')
  loaderPercent.textContent = `${Math.round(overall * 100)}%`
  loaderBar.style.width = `${overall * 100}%`
  loaderStage.textContent = t(`loader.stage.${key}`) === `loader.stage.${key}` ? label : t(`loader.stage.${key}`)
  loaderCount.textContent = total ? `${loaded} / ${total}` : ''
  loaderStageBar.style.width = total ? `${(loaded / total) * 100}%` : '0%'
  loaderItem.textContent = item ? t('loader.item.loading', { item }) : key === 'compile' ? t('loader.item.compiling') : t('loader.item.transferring')
  const index = STAGE_KEYS.indexOf(key)
  if (index > stageIndex) stageIndex = index
  STAGE_KEYS.forEach((stageKey, position) => {
    const row = loaderRows.get(stageKey)
    row.classList.toggle('active', key !== 'ready' && stageKey === key)
    row.classList.toggle('done', key === 'ready' || position < stageIndex)
    if (stageKey === key && total) row.querySelector('.loader-num').textContent = `${loaded}/${total}`
  })
}

const parameters = new URLSearchParams(location.search)
const PRE_ROLL_SECONDS = Number(parameters.get('preroll') ?? 900)
// Quality tier: 'high' by default; auto-drops to 'low' if the GPU context is lost
// (memory-constrained machines), so the scene degrades gracefully instead of going black.
const LOW = parameters.get('quality') === 'low'

const sim = createSim(Number(parameters.get('seed') ?? 7))
for (let step = 0; step < PRE_ROLL_SECONDS / STEP_SECONDS; step++) stepSim(sim)

const canvas = document.getElementById('world')
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', stencil: false, preserveDrawingBuffer: false })
// Graceful degradation: if the driver drops the WebGL context, reload once into the light tier.
let reloading = false
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault()
  if (reloading || LOW) return
  reloading = true
  const url = new URL(location.href)
  url.searchParams.set('quality', 'low')
  location.replace(url.toString())
})
// DPR 1.25 is the quality/memory sweet spot for this asset-heavy scene: sharp enough to avoid
// moiré on the conveyor rollers, while the shadow/AO cuts below keep VRAM well under the limit.
// Use ?dpr=1 to drop further, or ?dpr=1.5 for maximum sharpness on a strong GPU.
renderer.setPixelRatio(Number(parameters.get('dpr') ?? (LOW ? 1 : Math.min(window.devicePixelRatio, 1.25))))
renderer.setSize(window.innerWidth, window.innerHeight)
renderer.outputColorSpace = THREE.SRGBColorSpace
// Use three.js's built-in ACES tone mapping. postprocessing's ToneMappingEffect (in EffectPass)
// blows saturated reds out to pure white on this HDR-lit scene — the SimReady AGV's red body
// rendered as a white block. Built-in ACES keeps reds red while still rolling off highlights.
renderer.toneMapping = THREE.ACESFilmicToneMapping
renderer.toneMappingExposure = 1.15
renderer.shadowMap.enabled = true
renderer.shadowMap.type = THREE.PCFSoftShadowMap

const scene = new THREE.Scene()
const camera = new THREE.PerspectiveCamera(38, window.innerWidth / window.innerHeight, 0.5, 400)
// A low, close three-quarter view centred on the assembly lines. Engines and robot arms dominate;
// the parts store stays in the background instead of filling the frame as it did in the warehouse.
const OVERVIEW_POSITION = new THREE.Vector3(24, 5.6, 15)
const OVERVIEW_TARGET = new THREE.Vector3(17, 1.3, -0.5)
camera.position.copy(OVERVIEW_POSITION)
const controls = new OrbitControls(camera, canvas)
controls.target.copy(OVERVIEW_TARGET)
controls.enableDamping = true
controls.dampingFactor = 0.08
controls.minDistance = 7
controls.maxDistance = 120
controls.minPolarAngle = 0.25
controls.maxPolarAngle = 1.32
controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN }
controls.update()

// Light: cool industrial daylight through the open side, cyan-white LEDs from the fixtures overhead.
const sun = new THREE.DirectionalLight(0xc8dcf5, 2.4)
sun.position.set(46, 30, 26)
sun.target.position.set(2, 0, -2)
sun.castShadow = true
sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048)
sun.shadow.camera.left = -46
sun.shadow.camera.right = 46
sun.shadow.camera.top = 40
sun.shadow.camera.bottom = -40
sun.shadow.camera.near = 5
sun.shadow.camera.far = 120
sun.shadow.bias = -0.0002
sun.shadow.normalBias = 0.03
sun.shadow.radius = 3
scene.add(sun, sun.target)
scene.add(new THREE.HemisphereLight(0x9cb4d0, 0x1a2230, 0.4))
for (const [x, z] of [[-14, -7], [6, -8], [22, -8], [-14, 6], [6, 5], [24, 5]]) {
  const lamp = new THREE.PointLight(0xcfe4ff, 42, 24, 1.7)
  lamp.position.set(x, 7.8, z)
  scene.add(lamp)
}
// Accent lights over the two assembly bays give the engines a metallic highlight.
for (const z of [3.6, -3.6]) {
  const bayLamp = new THREE.SpotLight(0xcfe6ff, 55, 20, 0.85, 0.6, 1.5)
  bayLamp.position.set(18, 8.5, z)
  bayLamp.target.position.set(18, 0.5, z)
  scene.add(bayLamp, bayLamp.target)
}

await preloadAssets(showProgress)
const world = await buildWorld(scene, renderer, sim)

// Post: ambient occlusion + bloom + grade. Tone mapping is done by three.js's renderer (see above),
// NOT by postprocessing's ToneMappingEffect. That effect pushed this scene's saturated reds (the
// AGV body) to pure white through the HDR-lit HalfFloat buffer — the "white block" bug. Built-in
// ACES keeps reds red, so the EffectPass below deliberately omits ToneMappingEffect.
const composer = new EffectComposer(renderer, { frameBufferType: LOW ? THREE.UnsignedByteType : THREE.HalfFloatType })
composer.addPass(new RenderPass(scene, camera))
// Half-resolution AO: N8AO's internal buffers are a major VRAM consumer at full resolution.
const aoDivisor = LOW ? 3 : 2
const occlusion = new N8AOPostPass(scene, camera, Math.round(window.innerWidth / aoDivisor), Math.round(window.innerHeight / aoDivisor))
occlusion.configuration.aoRadius = 1.5
occlusion.configuration.distanceFalloff = 1.2
occlusion.configuration.intensity = 3.2
occlusion.configuration.color = new THREE.Color(0x0a0f18)
occlusion.configuration.gammaCorrection = false
occlusion.setQualityMode('Medium')
composer.addPass(occlusion)
composer.addPass(new EffectPass(
  camera,
  new BloomEffect({ intensity: 0.75, luminanceThreshold: 1.05, luminanceSmoothing: 0.25, mipmapBlur: true, radius: 0.7 }),
  new BrightnessContrastEffect({ brightness: 0.0, contrast: 0.1 }),
  new HueSaturationEffect({ saturation: 0.08 }),
  new VignetteEffect({ offset: 0.3, darkness: 0.55 }),
  new SMAAEffect(),
))

// Shader compilation is the last visible pause on first load. Render one frame while the
// loading screen still covers the canvas, so the first visible frame is already warm.
showProgress({ key: 'compile', label: t('loader.stage.compile'), loaded: 0, total: 0, overall: 0.99, item: '' })
await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
composer.render(0)
showProgress({ key: 'ready', label: t('loader.stage.ready'), loaded: 1, total: 1, overall: 1, item: '' })
loaderElement.classList.add('done')

// ---------- Path lines ----------

const lineMaterial = new LineMaterial({ color: 0x5fb8ff, linewidth: 2.2, transparent: true, opacity: 0.5, depthTest: true, worldUnits: false })
const lineMaterialSelected = new LineMaterial({ color: 0x5fb8ff, linewidth: 4.5, transparent: true, opacity: 1, depthTest: false, worldUnits: false })
lineMaterial.resolution.set(window.innerWidth, window.innerHeight)
lineMaterialSelected.resolution.set(window.innerWidth, window.innerHeight)
const pathLines = sim.forklifts.map(() => {
  const line = new Line2(new LineGeometry(), lineMaterial)
  line.frustumCulled = false
  line.renderOrder = 5
  line.visible = false
  scene.add(line)
  return line
})

function updatePathLine(line, forklift) {
  const isSelected = selected?.kind === 'forklift' && selected.unit === forklift
  const points = remainingPathPoints(forklift, 80, isSelected)
  if (points.length < 2) {
    line.visible = false
    return
  }
  const positions = []
  positions.push(forklift.x, 0.05, forklift.z)
  for (const point of points) positions.push(point[0], 0.05, point[1])
  line.geometry.dispose()
  line.geometry = new LineGeometry()
  line.geometry.setPositions(positions)
  line.material = isSelected ? lineMaterialSelected : lineMaterial
  line.visible = true
}

// ---------- State marks ----------

const ICONS = {
  overview: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 3h7v2H5v5H3zm11 0h7v7h-2V5h-5zM3 14h2v5h5v2H3zm16 0h2v7h-7v-2h5z"/></svg>',
  driving: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 3l8 9h-5v9H9v-9H4z"/></svg>',
  running: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4l13 8-13 8z"/></svg>',
  working: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l3 7h7l-5.5 4.5L18 21l-6-4.5L6 21l1.5-7.5L2 9h7z"/></svg>',
  waiting: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zm8 0h4v16h-4z"/></svg>',
  idle: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><circle cx="12" cy="12" r="8"/></svg>',
  fault: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2L1 22h22zM11 9h2v7h-2zm0 8.5h2v2h-2z"/></svg>',
}

const marksRoot = document.getElementById('marks')
function createMark() {
  const element = document.createElement('div')
  element.className = 'mark'
  marksRoot.appendChild(element)
  return { element, state: null }
}
const forkliftMarks = sim.forklifts.map(createMark)
const lineMarks = sim.lines.map(createMark)

function updateMark(mark, state, worldPoint, isSelected) {
  if (mark.state !== state) {
    mark.state = state
    mark.element.className = `mark ${state}`
    mark.element.innerHTML = ICONS[state]
  }
  mark.element.classList.toggle('selected', isSelected)
  const projected = new THREE.Vector3(...worldPoint).project(camera)
  const hidden = projected.z > 1 || Math.abs(projected.x) > 1.05 || Math.abs(projected.y) > 1.05
  mark.element.style.display = hidden ? 'none' : 'grid'
  const x = (projected.x * 0.5 + 0.5) * window.innerWidth
  const y = (-projected.y * 0.5 + 0.5) * window.innerHeight
  mark.element.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`
}

function lineState(line) {
  if (sim.time < line.jammedUntil) return 'fault'
  if (line.order || line.conveyorCases.length) return 'running'
  return 'idle'
}

// ---------- Selection ----------

let selected = null
let following = null
let flight = null
const cardElement = document.getElementById('card')

function iconRow(state, text) {
  return `<div class="status ${state}">${ICONS[state]}<span>${text}</span></div>`
}

function renderCard() {
  if (!selected) {
    cardElement.hidden = true
    return
  }
  cardElement.hidden = false
  const locale = getLocale()
  const batchState = (state) => {
    const key = `order.${state}`
    const translated = t(key)
    return translated === key ? state : translated
  }
  if (selected.kind === 'forklift') {
    const forklift = selected.unit
    const job = forklift.pallet ? t('card.agv.load', { n: forklift.pallet.cases }) : t('card.agv.empty')
    cardElement.innerHTML = `<h2>AGV ${forklift.id}</h2>${iconRow(forklift.state, tState(forklift.stateLabel, locale))}
      <dl><dt>${t('card.agv.loadLabel')}</dt><dd>${job}</dd>
      <dt>${t('card.agv.forkHeight')}</dt><dd>${(forklift.lift + 0.18).toFixed(1)} m</dd>
      <dt>${t('card.agv.speed')}</dt><dd>${forklift.speed.toFixed(1)} m/s</dd>
      <dt>${t('card.agv.loadsMoved')}</dt><dd>${forklift.moves}</dd></dl>`
  } else if (selected.kind === 'line') {
    const line = selected.unit
    const state = lineState(line)
    const order = line.order
    const text = state === 'fault'
      ? t('card.line.fault', { n: Math.ceil(line.jammedUntil - sim.time) })
      : order ? t('card.line.batch', { id: order.id, state: batchState(order.state) }) : t('card.line.waiting')
    const progress = order ? (line.packed / order.cases) * 100 : 0
    cardElement.innerHTML = `<h2>${line.id}</h2>${iconRow(state, text)}
      <dl><dt>${t('card.line.enginesOnLine')}</dt><dd>${line.conveyorCases.length}</dd>
      <dt>${t('card.line.coresFitted')}</dt><dd>${order ? `${line.picked} ${t('card.line.of')} ${order.cases}` : t('card.line.none')}</dd>
      <dt>${t('card.line.enginesTested')}</dt><dd>${order ? `${line.packed} ${t('card.line.of')} ${order.cases}` : t('card.line.none')}</dd></dl>
      <div class="bar"><i style="width:${progress.toFixed(0)}%"></i></div>`
  } else if (selected.kind === 'dock') {
    const door = selected.unit
    const status = door.state === 'loading' ? t('card.dock.loading') : t('card.dock.swapping')
    cardElement.innerHTML = `<h2>${t('card.dock.title', { id: door.id })}</h2>${iconRow(door.state === 'loading' ? 'running' : 'waiting', status)}
      <dl><dt>${t('card.dock.enginesInCarrier')}</dt><dd>${door.loaded} ${t('card.line.of')} 10</dd><dt>${t('card.dock.carriersSent')}</dt><dd>${door.trailersSent}</dd></dl>
      <div class="bar"><i style="width:${door.loaded * 10}%"></i></div>`
  } else if (selected.kind === 'inbound') {
    const door = selected.unit
    cardElement.innerHTML = `<h2>${t('card.inbound.title', { id: door.id })}</h2>${iconRow('running', t('card.inbound.palletsOnConveyor', { n: door.pallets.length }))}
      <dl><dt>${t('card.inbound.palletsReceived')}</dt><dd>${door.received}</dd></dl>`
  } else if (selected.kind === 'rack') {
    const rowSlots = sim.slots.filter((slot) => slot.row === selected.unit)
    const full = rowSlots.filter((slot) => slot.pallet).length
    cardElement.innerHTML = `<h2>${t('card.rack.title', { n: selected.unit + 1 })}</h2>${iconRow('running', t('card.rack.bins', { full, total: rowSlots.length }))}
      <div class="bar"><i style="width:${(full / rowSlots.length) * 100}%"></i></div>`
  }
}

function hitTargets() {
  const targets = []
  for (const forklift of sim.forklifts) {
    const reach = 1.8
    const box = new THREE.Box3(new THREE.Vector3(forklift.x - reach, 0, forklift.z - reach), new THREE.Vector3(forklift.x + reach, 3 + forklift.lift, forklift.z + reach))
    targets.push({ box, kind: 'forklift', unit: forklift, priority: 0 })
  }
  for (const line of sim.lines) {
    targets.push({ box: new THREE.Box3(new THREE.Vector3(line.pickX - 1.5, 0, line.z - 1.5), new THREE.Vector3(line.packX + 1.5, 3.4, line.z + 1.5)), kind: 'line', unit: line, priority: 1 })
  }
  for (const door of sim.outbound) {
    targets.push({ box: new THREE.Box3(new THREE.Vector3(door.x - 1.8, 0, -16.5), new THREE.Vector3(door.x + 1.8, 4.5, OUTBOUND_DROP_Z + 1.2)), kind: 'dock', unit: door, priority: 1 })
  }
  for (const door of sim.inbound) {
    targets.push({ box: new THREE.Box3(new THREE.Vector3(-27, 0, door.z - 1.5), new THREE.Vector3(-23.5, 4, door.z + 1.5)), kind: 'inbound', unit: door, priority: 1 })
  }
  sim.slots.slice(0, 0)
  ;[-16, -6.93, 2.14].forEach((rowX, row) => {
    targets.push({ box: new THREE.Box3(new THREE.Vector3(rowX - 1.1, 0, -6), new THREE.Vector3(rowX + 1.1, 6, 6)), kind: 'rack', unit: row, priority: 2 })
  })
  return targets
}

const raycaster = new THREE.Raycaster()
function pick(clientX, clientY) {
  raycaster.setFromCamera(new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1), camera)
  let best = null
  for (const target of hitTargets()) {
    const hit = raycaster.ray.intersectBox(target.box, new THREE.Vector3())
    if (!hit) continue
    const distance = hit.distanceTo(camera.position)
    if (!best || target.priority < best.priority || (target.priority === best.priority && distance < best.distance)) {
      best = { ...target, distance }
    }
  }
  return best
}

function selectTarget(target) {
  selected = target ? { kind: target.kind, unit: target.unit } : null
  following = target?.kind === 'forklift' ? target.unit : null
  if (target) {
    const view = viewFor(target)
    startFlight(view.target, view.position)
  }
  renderCard()
}

function showOverview() {
  selectTarget(null)
  startFlight(OVERVIEW_TARGET, OVERVIEW_POSITION)
}

// Each kind of unit has the view that shows its work: down the aisle for a forklift at a rack, along the belt for a line.
function viewFor(target) {
  if (target.kind === 'forklift') {
    const forklift = target.unit
    const point = new THREE.Vector3(forklift.x, 1.4, forklift.z)
    const inAisle = Math.abs(forklift.z) < 7 && [AISLE_ONE_X, AISLE_TWO_X].some((aisleX) => Math.abs(forklift.x - aisleX) < 3)
    if (inAisle) return { target: point, position: point.clone().add(new THREE.Vector3(1.2, 3.8, 11)) }
    return { target: point, position: point.clone().add(viewDirection().multiplyScalar(18)) }
  }
  if (target.kind === 'line') {
    const center = target.box.getCenter(new THREE.Vector3())
    return { target: center, position: center.clone().add(new THREE.Vector3(-6, 5.5, 9)) }
  }
  if (target.kind === 'dock') {
    const door = target.unit
    return { target: new THREE.Vector3(door.x, 1.4, -14), position: new THREE.Vector3(door.x + 5, 5, -4) }
  }
  const center = target.box.getCenter(new THREE.Vector3())
  const distance = Math.max(20, target.box.getSize(new THREE.Vector3()).length() * 1.5)
  return { target: center, position: center.clone().add(viewDirection().multiplyScalar(distance)) }
}

function viewDirection() {
  return camera.position.clone().sub(controls.target).normalize()
}

function startFlight(targetPoint, position) {
  flight = {
    fromTarget: controls.target.clone(),
    toTarget: targetPoint.clone(),
    fromPosition: camera.position.clone(),
    toPosition: position.clone(),
    elapsed: 0,
    duration: 1.1,
  }
}

let pointerDown = null
canvas.addEventListener('pointerdown', (event) => {
  pointerDown = { x: event.clientX, y: event.clientY }
  flight = null
})
canvas.addEventListener('pointerup', (event) => {
  if (!pointerDown) return
  const moved = Math.hypot(event.clientX - pointerDown.x, event.clientY - pointerDown.y)
  pointerDown = null
  if (moved > 5) return
  selectTarget(pick(event.clientX, event.clientY))
})
canvas.addEventListener('pointermove', (event) => {
  if (pointerDown) return
  canvas.classList.toggle('hovering', Boolean(pick(event.clientX, event.clientY)))
})
addEventListener('keydown', (event) => {
  // Typing in the LLM console must not toggle the sim or fly the camera away.
  if (event.target.closest('input, textarea, [contenteditable]')) return
  if (event.code === 'Space') {
    paused = !paused
    renderDock()
  }
  if (event.code === 'Escape') showOverview()
})

// ---------- Dashboard ----------

const SPEEDS = [1, 2, 5, 10]
let simSpeed = 1
let paused = false
const speedsElement = document.getElementById('speeds')
const pauseElement = document.getElementById('pause')
for (const speed of SPEEDS) {
  const button = document.createElement('button')
  button.textContent = `${speed}x`
  button.dataset.speed = speed
  button.addEventListener('click', () => {
    simSpeed = speed
    paused = false
    renderDock()
  })
  speedsElement.appendChild(button)
}
const homeElement = document.getElementById('home')
homeElement.innerHTML = ICONS.overview
homeElement.addEventListener('click', showOverview)
pauseElement.addEventListener('click', () => {
  paused = !paused
  renderDock()
})

function renderDock() {
  pauseElement.innerHTML = paused ? ICONS.running : ICONS.waiting
  pauseElement.title = paused ? t('dock.resume') : t('dock.pause')
  for (const button of speedsElement.children) button.classList.toggle('on', Number(button.dataset.speed) === simSpeed && !paused)
}
renderDock()

function renderKpis() {
  const kpis = computeKpis(sim)
  const entries = [
    [t('kpi.enginesPerHour'), (kpis.ordersPerHour * 12).toFixed(0), ''],
    [t('kpi.coreToDispatch'), kpis.orderToShipMinutes.toFixed(1), 'min'],
    [t('kpi.partsBinFill'), kpis.rackFillPercent.toFixed(0), '%'],
    [t('kpi.freeAgvs'), kpis.freeForklifts, t('kpi.of', { n: kpis.forkliftCount })],
  ]
  document.getElementById('kpis').innerHTML = entries.map(([label, value, unit]) => `<div class="kpi"><label>${label}</label><strong>${value}<small>${unit}</small></strong></div>`).join('')
  const totalMinutes = Math.floor(sim.time / 60) + 8 * 60
  const hours = String(Math.floor(totalMinutes / 60) % 24).padStart(2, '0')
  const minutes = String(totalMinutes % 60).padStart(2, '0')
  document.getElementById('clock').textContent = `${hours}:${minutes}`
}

// ---------- Per-frame world update ----------

function writePallets() {
  let palletIndex = 0
  let binIndex = 0
  const caseIndexes = world.casePools.map(() => 0)
  const placeCase = (sku, matrix) => {
    const pool = world.casePools[sku]
    pool.setMatrix(caseIndexes[sku]++, matrix)
  }
  for (const pallet of sim.pallets) {
    const heading = pallet.heading ?? 0
    composeMatrix(pallet.x, pallet.y, pallet.z, heading, tempMatrix)
    world.palletPool.setMatrix(palletIndex++, tempMatrix)
    const sine = Math.sin(heading)
    const cosine = Math.cos(heading)
    // Pallets in the store hold uniform parts bins, not the coloured product cartons.
    for (let index = 0; index < pallet.cases; index++) {
      const offset = caseOffset(index)
      const worldX = pallet.x + offset.x * cosine + offset.z * sine
      const worldZ = pallet.z - offset.x * sine + offset.z * cosine
      composeMatrix(worldX, pallet.y + offset.y, worldZ, heading, tempMatrix, 0.97)
      world.binPool.setMatrix(binIndex++, tempMatrix)
    }
  }
  // Only the units travelling the assembly lines are rendered as engine assemblies.
  for (const item of sim.cases) {
    composeMatrix(item.x, item.y, item.z, item.heading, tempMatrix)
    placeCase(item.sku, tempMatrix)
  }
  world.palletPool.setCount(palletIndex)
  world.palletPool.commit()
  world.binPool.setCount(binIndex)
  world.binPool.commit()
  world.casePools.forEach((pool, sku) => {
    pool.setCount(caseIndexes[sku])
    pool.commit()
  })
  const stackCount = Math.min(sim.emptyStack.count, 16)
  for (let index = 0; index < stackCount; index++) {
    composeMatrix(EMPTY_STACK.x, STAND_TOP + index * 0.14, EMPTY_STACK.z, Math.PI / 2 + (index % 2) * 0.02, tempMatrix)
    world.emptyStackPool.setMatrix(index, tempMatrix)
  }
  world.emptyStackPool.setCount(stackCount)
  world.emptyStackPool.commit()
}

const tempMatrix = new THREE.Matrix4()

function writeForklifts() {
  sim.forklifts.forEach((forklift, index) => {
    composeMatrix(forklift.x, 0, forklift.z, forklift.heading, tempMatrix)
    world.forkliftParts.chassis.setMatrix(index, tempMatrix)
    composeMatrix(forklift.x, forklift.lift, forklift.z, forklift.heading, tempMatrix)
    world.forkliftParts.cab.setMatrix(index, tempMatrix)
    composeMatrix(forklift.x, Math.max(0, forklift.lift * 0.52), forklift.z, forklift.heading, tempMatrix)
    world.forkliftParts.stage.setMatrix(index, tempMatrix)
  })
  for (const part of Object.values(world.forkliftParts)) {
    part.setCount(sim.forklifts.length)
    part.commit()
  }
}

function writeGantries() {
  sim.lines.forEach((line, lineIndex) => {
    const pairs = [[world.gantries[lineIndex * 2], line.pickGantry], [world.gantries[lineIndex * 2 + 1], line.packGantry]]
    for (const [model, state] of pairs) {
      model.bridge.position.x = state.x - model.group.position.x
      model.carriage.position.z = state.headZ - line.z
      const height = model.legHeight - state.y
      model.mast.scale.y = Math.max(0.05, height + 0.2)
      model.mast.position.y = state.y + (height + 0.2) / 2
      model.head.position.y = state.y
    }
  })
}

function writeTrailers() {
  sim.outbound.forEach((door, index) => {
    world.doors.outbound[index].trailer.position.z = -door.trailerOffset * 24
  })
}

function updateMarks() {
  sim.forklifts.forEach((forklift, index) => {
    const isSelected = selected?.kind === 'forklift' && selected.unit === forklift
    updateMark(forkliftMarks[index], forklift.state, [forklift.x, 3.5 + Math.max(0, forklift.lift), forklift.z], isSelected)
    updatePathLine(pathLines[index], forklift)
  })
  sim.lines.forEach((line, index) => {
    updateMark(lineMarks[index], lineState(line), [(line.conveyorStartX + line.conveyorEndX) / 2, 2.2, line.z], selected?.kind === 'line' && selected.unit === line)
  })
}

// ---------- Main loop ----------

let lastNow = performance.now()
let accumulator = 0
let framesSinceDashboard = 0

function frame(now) {
  requestAnimationFrame(frame)
  const deltaSeconds = Math.min(0.1, (now - lastNow) / 1000)
  lastNow = now
  if (!paused) {
    accumulator += deltaSeconds * simSpeed
    while (accumulator >= STEP_SECONDS) {
      stepSim(sim)
      accumulator -= STEP_SECONDS
    }
  }

  if (flight) {
    flight.elapsed += deltaSeconds
    const progress = Math.min(1, flight.elapsed / flight.duration)
    const eased = progress * progress * (3 - 2 * progress)
    const followShift = following ? new THREE.Vector3(following.x, 1.4, following.z).sub(flight.toTarget) : new THREE.Vector3()
    controls.target.copy(flight.fromTarget).lerp(flight.toTarget.clone().add(followShift), eased)
    camera.position.copy(flight.fromPosition).lerp(flight.toPosition.clone().add(followShift), eased)
    if (progress >= 1) flight = null
  } else if (following) {
    const goal = new THREE.Vector3(following.x, 1.4 + Math.max(0, following.lift) * 0.5, following.z)
    const shift = goal.sub(controls.target).multiplyScalar(1 - Math.exp(-deltaSeconds * 5))
    controls.target.add(shift)
    camera.position.add(shift)
  }
  controls.update(deltaSeconds)

  writePallets()
  writeForklifts()
  writeGantries()
  writeTrailers()
  updateMarks()
  composer.render(deltaSeconds)

  framesSinceDashboard++
  if (framesSinceDashboard >= 6) {
    framesSinceDashboard = 0
    renderKpis()
    renderCard()
  }
}
renderKpis()
requestAnimationFrame(frame)

addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight
  camera.updateProjectionMatrix()
  renderer.setSize(window.innerWidth, window.innerHeight)
  composer.setSize(window.innerWidth, window.innerHeight)
  occlusion.setSize(Math.round(window.innerWidth / aoDivisor), Math.round(window.innerHeight / aoDivisor))
  lineMaterial.resolution.set(window.innerWidth, window.innerHeight)
  lineMaterialSelected.resolution.set(window.innerWidth, window.innerHeight)
})

// Hooks for the checks and the film recorder.
window.__app = {
  sim,
  camera,
  controls,
  scene,
  composer,
  renderer,
  ready: true,
  setSpeed(speed) {
    simSpeed = speed
    renderDock()
  },
  setView(position, target) {
    camera.position.set(...position)
    controls.target.set(...target)
    controls.update()
  },
  screenOf(worldPoint) {
    const projected = new THREE.Vector3(...worldPoint).project(camera)
    return { x: (projected.x * 0.5 + 0.5) * window.innerWidth, y: (-projected.y * 0.5 + 0.5) * window.innerHeight }
  },
  selected: () => selected,
  ticket: renderCard,
  // Demo hook used by tools/film.mjs: lock the camera onto one AGV at a close
  // three-quarter angle without the 1.1 s selection flight, so a short shelf
  // pick-up is fully captured. Keeps the selection card live.
  cinematicFollow(id, offset = [2, 3, 7.5]) {
    const forklift = sim.forklifts.find((item) => item.id === id)
    if (!forklift) return false
    selected = { kind: 'forklift', unit: forklift }
    following = forklift
    flight = null
    controls.target.set(forklift.x, 1.4, forklift.z)
    camera.position.set(forklift.x + offset[0], 1.4 + offset[1], forklift.z + offset[2])
    controls.update()
    renderCard()
    return true
  },
  releaseFollow() {
    following = null
    flight = null
  },
  // Natural-language console hooks. `focus` takes { kind, unit } where unit is
  // a live sim object (or a 0-based row number for racks) and builds the same
  // target shape that ray picking produces, so viewFor/renderCard work unchanged.
  focus({ kind, unit }) {
    let target = null
    if (kind === 'forklift' && unit && typeof unit === 'object') {
      target = { kind, unit }
    } else if (kind === 'line') {
      const line = sim.lines.find((item) => item.id === unit) ?? sim.lines.find((item) => item === unit)
      if (line) target = { kind, unit: line, box: new THREE.Box3(
        new THREE.Vector3(line.pickX - 1.5, 0, line.z - 1.5),
        new THREE.Vector3(line.packX + 1.5, 3.4, line.z + 1.5)) }
    } else if (kind === 'dock') {
      const door = sim.outbound.find((item) => item.id === unit) ?? sim.outbound.find((item) => item === unit)
      if (door) target = { kind, unit: door, box: new THREE.Box3(
        new THREE.Vector3(door.x - 1.8, 0, -16.5),
        new THREE.Vector3(door.x + 1.8, 4.5, OUTBOUND_DROP_Z + 1.2)) }
    } else if (kind === 'inbound') {
      const door = sim.inbound.find((item) => item.id === unit) ?? sim.inbound.find((item) => item === unit)
      if (door) target = { kind, unit: door, box: new THREE.Box3(
        new THREE.Vector3(-27, 0, door.z - 1.5),
        new THREE.Vector3(-23.5, 4, door.z + 1.5)) }
    } else if (kind === 'rack') {
      const row = Number(unit)
      const rowX = [-16, -6.93, 2.14][row]
      if (rowX != null) target = { kind, unit: row, box: new THREE.Box3(
        new THREE.Vector3(rowX - 1.1, 0, -6), new THREE.Vector3(rowX + 1.1, 6, 6)) }
    }
    if (!target) return false
    selectTarget(target)
    return true
  },
  home: showOverview,
  pause() {
    paused = true
    renderDock()
  },
  resume() {
    paused = false
    renderDock()
  },
  getKpis: () => computeKpis(sim),
  getPaused: () => paused,
  setLocale,
  getLocale,
  getT: () => t,
}

// Re-render every dynamic surface when the language changes. Chat bubbles are
// intentionally untouched; chat.js only clears its own model history.
subscribe((nextT) => {
  t = nextT
  applyStaticI18n(document, t)
  renderDock()
  renderKpis()
  renderCard()
})

// Mount the optional natural-language console after __app exists. Its module
// only defines functions at top level, so the static import above is safe.
mountChat({ app: window.__app, getSim: () => sim, getT: () => t, subscribe })
