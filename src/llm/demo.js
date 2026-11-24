// Offline intent matcher. Produces the same shape as a live tool call so the
// rest of the pipeline is identical: { content, toolCalls: [{name, args}] }.
import { createTranslator } from '../i18n/index.js'

const reply = (content, name, args = {}) => ({
  content,
  toolCalls: name ? [{ name, args }] : [],
})

export function demoResolve(text, locale) {
  const t = createTranslator(locale)
  const line = String(text || '').trim()
  const lower = line.toLowerCase()

  if (/overview|\bfull hall\b|wide view|zoom out|whole hall|show everything|back to (the )?(start|overview)|总览|全景|回(到)?总览|整个车间|显示全部/.test(lower)) {
    return reply(t('demo.overview'), 'show_overview')
  }
  if (/\bpause\b|hold on|freeze|stop the sim|暂停|停一下|停住/.test(lower)) {
    return reply(t('demo.pause'), 'set_sim_speed', { action: 'pause' })
  }
  if (/\bresume\b|continue|unpause|start (the )?sim|继续|恢复|开始仿真/.test(lower)) {
    return reply(t('demo.resume'), 'set_sim_speed', { action: 'resume' })
  }
  const speedMatch = lower.match(/(\d+)\s*x\b|speed\s*(?:to|=)?\s*(\d+)|(\d+)\s*times|(\d+)\s*倍(速)?|速度\s*(?:设为|=)?\s*(\d+)/)
  if (speedMatch) {
    const value = Number(speedMatch[1] || speedMatch[2] || speedMatch[3] || speedMatch[4] || speedMatch[6])
    return reply(t('demo.speed', { value }), 'set_sim_speed', { action: 'set', speed: value })
  }
  if (/(faster|speed up|slower|slow down|加速|减速)/.test(lower)) {
    return reply(t('demo.faster'), null)
  }
  if (/(status|kpi|how (is|are)|what'?s|report|throughput|engines per hour|idle|free agv|queued|shipped|occupancy|状态|报表|产能|吞吐|每小时|空闲|排队|发运|占用率|数据|怎么样|查看当前)/.test(lower)) {
    return reply(t('demo.status'), 'query_kpis')
  }
  if (/(focus|camera|look at|show me|take me to|zoom in|follow|聚焦|看看|定位|镜头|跟随)/.test(lower)) {
    const fl = line.match(/\bFL-?\s*(\d+)\b/i) ?? line.match(/agv\s*#?\s*(\d+)/i)
    const ln = line.match(/\bline\s*([12])\b/i) ?? line.match(/([12])\s*号线/i) ?? line.match(/([12])\s*号线?产线/i)
    const rw = line.match(/\brow\s*([123])\b/i) ?? line.match(/([123])\s*号?(?:货架|排)/) ?? line.match(/第\s*([123])\s*排/)
    const dr = line.match(/\bdoor\s*([1-5])\b/i) ?? line.match(/([1-5])\s*号门/)
    if (fl) return reply(t('demo.focus.agv', { n: fl[1] }), 'focus_unit', { kind: 'forklift', id: `FL-${fl[1]}` })
    if (ln) return reply(t('demo.focus.line', { n: ln[1] }), 'focus_unit', { kind: 'line', id: `Line ${ln[1]}` })
    if (rw) return reply(t('demo.focus.rack', { n: rw[1] }), 'focus_unit', { kind: 'rack', id: `Row ${rw[1]}` })
    if (dr) {
      const kind = Number(dr[1]) >= 4 ? 'dock' : 'inbound'
      return reply(t('demo.focus.door', { n: dr[1] }), 'focus_unit', { kind, id: `Door ${dr[1]}` })
    }
    return reply(t('demo.focus.hint'), null)
  }
  if (/(dispatch|send|pick|fetch|collect|bring|deliver|get an? agv|取|派|取货|取料|搬运|送达|送到|让.*AGV.*取)/.test(lower)) {
    const skuWord = lower.match(/\b(v8|v6|v12|electric|ev)\b/) ?? line.match(/电动/)
    const sku = skuWord ? (skuWord[1] ? (skuWord[1] === 'ev' ? 'electric' : skuWord[1].toUpperCase()) : 'electric') : 'V8'
    const rowMatch = line.match(/(?:row|rack|aisle)\s*([123])/i) ?? line.match(/([123])\s*号?(?:货架|排)/) ?? line.match(/第\s*([123])\s*排/)
    const lineMatch = line.match(/(?:line|产线)\s*([12])/i) ?? line.match(/([12])\s*号线/)
    const args = { sku, line: lineMatch ? `Line ${lineMatch[1]}` : 'Line 1' }
    if (rowMatch) args.row = Number(rowMatch[1])
    return reply(t('demo.dispatch', { sku }), 'dispatch_agv_pickup', args)
  }
  return reply(t('demo.unknown'), null)
}
