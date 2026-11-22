// Turns a structured tool call into a safe simulation operation. The LLM never
// touches sim objects directly: it sends strings/numbers, this module resolves
// them to real references and performs the write. No three.js, no DOM.
import { computeKpis } from './sim.js'

const SKU = { V8: 0, V6: 1, V12: 2, electric: 3 }
const SKU_NAME = ['V8', 'V6', 'V12', 'electric']

function resolveSku(value) {
  if (value == null) return null
  if (typeof value === 'number' && value >= 0 && value < SKU_NAME.length) return value
  const key = String(value).trim().toLowerCase()
  // SKU keys are upper-case, so look them up case-insensitively.
  const hit = Object.keys(SKU).find((name) => name.toLowerCase() === key)
  if (hit) return SKU[hit]
  if (key === 'ev' || key === 'elec') return SKU.electric
  return null
}

function resolveLine(sim, value) {
  if (value == null) return null
  const key = String(value).trim().toLowerCase()
  const match = key.match(/(?:line\s*)?([12])/)
  if (!match) return null
  return sim.lines.find((line) => line.id.toLowerCase().endsWith(match[1])) ?? null
}

function resolveRackRow(value) {
  if (value == null) return null
  const match = String(value).trim().match(/(?:row\s*)?([123])/)
  if (!match) return null
  return Number(match[1]) - 1 // 0-based, matches sim.slots[].row
}

function resolveForklift(sim, value) {
  if (value == null) return null
  const key = String(value).trim().toUpperCase()
  if (/^FL-?\d+$/.test(key)) return sim.forklifts.find((item) => item.id === key.replace('-', '-')) ?? null
  const match = key.match(/(\d+)/)
  if (match) return sim.forklifts[Number(match[1]) - 1] ?? null
  return null
}

function dispatchPickup(sim, { sku, row, line }) {
  const skuIndex = resolveSku(sku)
  const lineObj = resolveLine(sim, line)
  if (skuIndex == null || !lineObj) return { ok: false, message: 'I could not recognise that engine model or line. Try "V8" and "Line 1".' }

  const inStock = (slot) => slot.pallet && !slot.reserved && slot.pallet.sku === skuIndex && slot.pallet.cases > 0
  let candidates = sim.slots.filter(inStock)
  const wantedRow = resolveRackRow(row)
  let fromOtherRow = false
  if (wantedRow != null) {
    const inRow = candidates.filter((slot) => slot.row === wantedRow)
    if (inRow.length) candidates = inRow
    else if (candidates.length) fromOtherRow = true
  }
  if (!candidates.length) return { ok: false, message: `No ${SKU_NAME[skuIndex]} cores are available on the racks right now. Try another model.` }
  candidates.sort((a, b) => b.pallet.cases - a.pallet.cases || a.level - b.level)
  const slot = candidates[0]
  const model = SKU_NAME[skuIndex]

  // A retrieve task reads task.line.order.id (sim.js:512), so an idle line must
  // be fully claimed. If the line is busy, queue an order and let stepOrders do it.
  const busy = lineObj.order || lineObj.retrieving || lineObj.pickPallet || lineObj.returning
  if (busy) {
    const order = {
      id: 9000 + sim.orders.length,
      sku: skuIndex,
      cases: Math.min(6, slot.pallet.cases),
      createdAt: sim.time,
      shippedAt: null,
      state: 'queued',
      line: null,
    }
    sim.orders.push(order)
    sim.pendingOrders.push(order)
    return { ok: true, message: `${lineObj.id} is busy, so the ${model} pickup is queued and will depart as soon as it is free.` }
  }

  const order = {
    id: 9000 + sim.orders.length,
    sku: skuIndex,
    cases: Math.min(6, slot.pallet.cases),
    createdAt: sim.time,
    shippedAt: null,
    state: 'retrieving',
    line: lineObj.id,
  }
  sim.orders.push(order)
  // Exactly the assignment block from stepOrders (sim.js:628-636).
  order.cases = Math.min(order.cases, slot.pallet.cases)
  slot.reserved = true
  lineObj.order = order
  lineObj.retrieving = true
  lineObj.picked = 0
  lineObj.packed = 0
  sim.tasks.push({ kind: 'retrieve', slot, line: lineObj, createdAt: sim.time })

  const source = fromOtherRow ? ` (row ${slot.row + 1} instead — the requested row had none)` : ''
  return { ok: true, message: `An AGV is heading to ${slot.label} for a ${model} core, then on to ${lineObj.id}.${source}` }
}

function queryStatus(sim, app) {
  const k = app.getKpis()
  return {
    ok: true,
    message: `Running at about ${(k.ordersPerHour * 12).toFixed(0)} engines/hour. ${k.freeForklifts} of ${k.forkliftCount} AGVs are free, racks are ${Math.round(k.rackFillPercent)}% full, ${k.queuedOrders} orders queued and ${k.shippedTotal} engines shipped.`,
  }
}

function focusUnit(sim, app, { kind, id }) {
  const normalized = String(kind || '').toLowerCase()
  let unit = null
  let actualKind = normalized
  if (normalized === 'forklift') unit = resolveForklift(sim, id)
  else if (normalized === 'line') {
    const line = resolveLine(sim, id)
    unit = line?.id ?? null
  } else if (normalized === 'rack') unit = resolveRackRow(id)
  else if (normalized === 'dock') unit = sim.outbound.find((d) => d.id.toLowerCase() === String(id).toLowerCase())?.id ?? null
  else if (normalized === 'inbound') unit = sim.inbound.find((d) => d.id.toLowerCase() === String(id).toLowerCase())?.id ?? null
  if (unit == null || unit === false) return { ok: false, message: 'I could not find that unit. Try "FL-1", "Line 1", "Row 2" or "Door 4".' }
  if (!app.focus({ kind: actualKind, unit })) return { ok: false, message: 'That unit is not focusable.' }
  return { ok: true, message: `Camera is now following ${normalized === 'forklift' ? unit.id : normalized === 'rack' ? `parts row ${unit + 1}` : unit}.` }
}

function setSpeed(app, { action, speed }) {
  if (action === 'pause') {
    app.pause()
    return { ok: true, message: 'Simulation paused.' }
  }
  if (action === 'resume') {
    app.resume()
    return { ok: true, message: 'Simulation resumed.' }
  }
  const value = Number(speed)
  if (![1, 2, 5, 10].includes(value)) return { ok: false, message: 'Speed must be 1x, 2x, 5x or 10x.' }
  app.resume()
  app.setSpeed(value)
  return { ok: true, message: `Simulation running at ${value}x.` }
}

export function executeCommand({ app, sim, command }) {
  if (!command || !command.name) return { ok: false, message: 'No command was received.' }
  try {
    switch (command.name) {
      case 'dispatch_agv_pickup': return dispatchPickup(sim, command.args ?? {})
      case 'query_kpis': return queryStatus(sim, app)
      case 'focus_unit': return focusUnit(sim, app, command.args ?? {})
      case 'show_overview': app.home(); return { ok: true, message: 'Back to the hall overview.' }
      case 'set_sim_speed': return setSpeed(app, command.args ?? {})
      default: return { ok: false, message: `Unknown command: ${command.name}` }
    }
  } catch (error) {
    return { ok: false, message: `That command failed: ${error.message}` }
  }
}

export { computeKpis }
