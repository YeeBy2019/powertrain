// Offline intent matcher. Produces the same shape as a live tool call so the
// rest of the pipeline is identical: { content, toolCalls: [{name, args}] }.
const reply = (content, name, args = {}) => ({
  content,
  toolCalls: name ? [{ name, args }] : [],
})

export function demoResolve(text) {
  const line = String(text || '').trim()
  const lower = line.toLowerCase()

  if (/overview|\bfull hall\b|wide view|zoom out|whole hall|show everything|back to (the )?(start|overview)/.test(lower)) {
    return reply('Here is the whole hall again.', 'show_overview')
  }
  if (/\bpause\b|hold on|freeze|stop the sim/.test(lower)) {
    return reply('Paused the simulation.', 'set_sim_speed', { action: 'pause' })
  }
  if (/\bresume\b|continue|unpause|start (the )?sim/.test(lower)) {
    return reply('Resuming the simulation.', 'set_sim_speed', { action: 'resume' })
  }
  const speedMatch = lower.match(/(\d+)\s*x\b|speed\s*(?:to|=)?\s*(\d+)|(\d+)\s*times/)
  if (speedMatch) {
    const value = Number(speedMatch[1] || speedMatch[2] || speedMatch[3])
    return reply(`Running at ${value}x.`, 'set_sim_speed', { action: 'set', speed: value })
  }
  if (/(faster|speed up|slower|slow down)/.test(lower)) {
    return reply('I can set speed directly, for example "5x".', null)
  }
  if (/(status|kpi|how (is|are)|what'?s|report|throughput|engines per hour|idle|free agv|queued|shipped|occupancy)/.test(lower)) {
    return reply('Here is the current shift status.', 'query_kpis')
  }
  if (/(focus|camera|look at|show me|take me to|zoom in|follow)/.test(lower)) {
    const fl = line.match(/\bFL-?\s*(\d+)\b/i) ?? line.match(/agv\s*#?\s*(\d+)/i)
    const ln = line.match(/\bline\s*([12])\b/i)
    const rw = line.match(/\brow\s*([123])\b/i)
    const dr = line.match(/\bdoor\s*([1-5])\b/i)
    if (fl) return reply(`Focusing on AGV FL-${fl[1]}.`, 'focus_unit', { kind: 'forklift', id: `FL-${fl[1]}` })
    if (ln) return reply(`Focusing on Line ${ln[1]}.`, 'focus_unit', { kind: 'line', id: `Line ${ln[1]}` })
    if (rw) return reply(`Focusing on rack Row ${rw[1]}.`, 'focus_unit', { kind: 'rack', id: `Row ${rw[1]}` })
    if (dr) {
      const kind = Number(dr[1]) >= 4 ? 'dock' : 'inbound'
      return reply(`Focusing on Door ${dr[1]}.`, 'focus_unit', { kind, id: `Door ${dr[1]}` })
    }
    return reply('Tell me which unit to focus, e.g. "Focus on FL-3" or "Show me Line 1".', null)
  }
  if (/(dispatch|send|pick|fetch|collect|bring|deliver|get an? agv|取|派)/.test(lower)) {
    const skuWord = lower.match(/\b(v8|v6|v12|electric|ev)\b/)
    const sku = skuWord ? (skuWord[1] === 'ev' ? 'electric' : skuWord[1].toUpperCase()) : 'V8'
    const rowMatch = line.match(/(?:row|rack|aisle)\s*([123])/i) ?? line.match(/\b([123])\s*(?:号)?\s*(?:货架|rack)\b/i)
    const lineMatch = line.match(/(?:line|产线)\s*([12])/i) ?? line.match(/\b([12])\s*(?:号线|line)\b/i)
    const args = { sku, line: lineMatch ? `Line ${lineMatch[1]}` : 'Line 1' }
    if (rowMatch) args.row = Number(rowMatch[1])
    return reply(`Got it — dispatching an AGV for a ${sku} core.`, 'dispatch_agv_pickup', args)
  }
  return reply('I can dispatch AGVs, report status, focus the camera, reset the view or change speed. Try "Dispatch an AGV to pick a V8 core from Row 2 and take it to Line 1".', null)
}
