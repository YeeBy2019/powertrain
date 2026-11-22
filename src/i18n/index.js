// Lightweight, dependency-free i18n: locale state, dictionary lookup, static
// DOM updates, and the top-right language switch. Entity IDs stay in English.
import { DICT, LOCALES } from './strings.js'

const LOCALE_KEY = 'powertrain.locale.v1'
const listeners = new Set()

function normalize(value) {
  return LOCALES.includes(value) ? value : null
}

export function resolveInitialLocale() {
  if (typeof window === 'undefined') return 'en'
  const params = new URLSearchParams(window.location.search)
  const fromUrl = normalize(params.get('lang'))
  if (fromUrl) return fromUrl
  const fromBoot = normalize(window.__POWERTRAIN_LOCALE__)
  if (fromBoot) return fromBoot
  let stored = null
  try {
    stored = normalize(JSON.parse(localStorage.getItem(LOCALE_KEY) || 'null'))
  } catch {
    stored = null
  }
  return stored || 'en'
}

let locale = resolveInitialLocale()

function syncDocument(next) {
  if (typeof document === 'undefined') return
  document.documentElement.lang = next
  document.documentElement.dataset.locale = next
}
syncDocument(locale)

export function getLocale() {
  return locale
}

export function setLocale(next) {
  const value = normalize(next)
  if (!value || value === locale) return locale
  locale = value
  syncDocument(locale)
  try {
    localStorage.setItem(LOCALE_KEY, JSON.stringify(locale))
  } catch {
    // Private mode or blocked storage: the switch still works for this session.
  }
  const translator = createTranslator(locale)
  listeners.forEach((listener) => listener(translator, locale))
  return locale
}

export function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function createTranslator(localeArg = locale) {
  const active = normalize(localeArg) || 'en'
  const table = DICT[active]

  const t = (key, params) => {
    let value = table[key]
    if (value == null) value = DICT.en[key]
    if (value == null) return key
    if (!params) return value
    return value.replace(/\{(\w+)\}/g, (match, name) => (
      params[name] == null ? match : String(params[name])
    ))
  }
  t.locale = active
  return t
}

// --- stateLabel translation -------------------------------------------------
// sim.js keeps canonical English labels (recording scripts depend on them).
// This module translates only at the display boundary.

const EXACT_STATE_KEYS = {
  'Idle, waiting for a job': 'state.idle',
  'Backing out': 'state.backingOut',
  'Lowering the mast': 'state.loweringMast',
  'Waiting to back onto the lane': 'state.waitingToBack',
  'Waiting for the aisle to clear': 'state.waitingAisle',
  'Going to park': 'state.goingPark',
  'Sliding the forks in': 'state.forksIn',
  'Lifting the pallet clear': 'state.liftPallet',
  'Setting the pallet down': 'state.setPallet',
  'Rolling onto the conveyor': 'state.rollingConveyor',
  'Sliding into the rack': 'state.slideRack',
  'Lining up with the pick stand': 'state.linePickStand',
  'Rolling onto the stand': 'state.rollingStand',
  'Lining up with the conveyor': 'state.liningConveyor',
  'Lining up with the pack stand': 'state.liningPackStand',
  'Lining up with the stack': 'state.liningStack',
  'Sliding over the stack': 'state.slideStack',
  'Lining up with the dock conveyor': 'state.dockConveyor',
  'Taking the empty pallet to the stack': 'state.emptyPalletStack',
}

const STATE_PATTERNS = [
  [/^Fetching a (\w+) core for batch (\d+)$/, 'state.fetching', (m) => ({ sku: m[1], batch: m[2] })],
  [/^Delivering the engine core to (Line \d)$/, 'state.delivering', (m) => ({ line: m[1] })],
  [/^Clearing the pallet at (Line \d)$/, 'state.clearingPallet', (m) => ({ line: m[1] })],
  [/^Collecting batch (\d+) cores$/, 'state.collecting', (m) => ({ batch: m[1] })],
  [/^Loading batch (\d+) at (Door \d)$/, 'state.loadingBatch', (m) => ({ batch: m[1], door: m[2] })],
  [/^Putting away, (.+)$/, 'state.puttingAway', (m) => ({ slot: m[1] })],
  [/^Lifting to (.+)$/, 'state.liftingTo', (m) => ({ slot: m[1] })],
  [/^Returning to (.+)$/, 'state.returningTo', (m) => ({ slot: m[1] })],
  [/^Heading to (Door \d) for an inbound parts pallet$/, 'state.inboundPallet', (m) => ({ door: m[1] })],
  [/^Waiting for (.+) to clear$/, 'state.waitingFor', (m) => ({ unit: m[1] })],
]

export function parseStateLabel(label) {
  const text = String(label || '')
  if (EXACT_STATE_KEYS[text]) return { key: EXACT_STATE_KEYS[text], params: {} }
  for (const [pattern, key, paramsOf] of STATE_PATTERNS) {
    const match = text.match(pattern)
    if (match) return { key, params: paramsOf(match) }
  }
  return null
}

export function tState(label, localeArg = locale) {
  const active = normalize(localeArg) || 'en'
  if (active === 'en') return String(label || '')
  const parsed = parseStateLabel(label)
  if (!parsed) return String(label || '') // safe fallback, never blank
  return createTranslator(active)(parsed.key, parsed.params)
}

// --- static DOM -------------------------------------------------------------

export function applyStaticI18n(root = document, t = createTranslator()) {
  root.querySelectorAll?.('[data-i18n]').forEach((node) => {
    node.textContent = t(node.dataset.i18n)
  })
  root.querySelectorAll?.('[data-i18n-title]').forEach((node) => {
    node.title = t(node.dataset.i18nTitle)
  })
  root.querySelectorAll?.('[data-i18n-placeholder]').forEach((node) => {
    node.placeholder = t(node.dataset.i18nPlaceholder)
  })
  root.querySelectorAll?.('[data-i18n-aria]').forEach((node) => {
    node.setAttribute('aria-label', t(node.dataset.i18nAria))
  })
}

export function installLanguageToggle() {
  let button = document.getElementById('lang-toggle')
  if (!button) {
    button = document.createElement('button')
    button.id = 'lang-toggle'
    button.type = 'button'
    document.body.appendChild(button)
  }
  const update = (nextT = createTranslator()) => {
    const chinese = getLocale() === 'zh-CN'
    button.textContent = chinese ? '中' : 'EN'
    button.title = nextT('lang.switchTo')
    button.setAttribute('aria-label', nextT('lang.switchTo'))
  }
  button.addEventListener('click', () => {
    setLocale(getLocale() === 'en' ? 'zh-CN' : 'en')
  })
  subscribe(update)
  update()
  return button
}
