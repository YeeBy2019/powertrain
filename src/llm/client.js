// Single entry point for both the offline demo matcher and the live LLM proxy.
// Returns { content, toolCalls: [{ name, args }], mode }.
import { demoResolve } from './demo.js'
import { normalizeToolCalls, SYSTEM_PROMPT, TOOLS } from './tools.js'

export async function askLLM({ text, history = [], settings, signal } = {}) {
  if (settings.mode !== 'live') {
    const result = demoResolve(text)
    return { ...result, mode: 'demo' }
  }
  if (!settings.apiKey) {
    return { content: 'Live mode needs an API key. Open the settings gear to add one, or switch back to Demo.', toolCalls: [], mode: 'live' }
  }

  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    ...history.slice(-6).map((item) => ({ role: item.role, content: item.content })),
    { role: 'user', content: text },
  ]
  const response = await fetch('/api/llm/chat/completions', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-llm-base': settings.base,
      'x-llm-key': settings.apiKey,
    },
    body: JSON.stringify({
      model: settings.model,
      messages,
      tools: TOOLS,
      tool_choice: 'auto',
      temperature: 0,
      stream: false,
    }),
    signal,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const detail = data.error?.message || `HTTP ${response.status}`
    return { content: `LLM request failed: ${detail}`, toolCalls: [], mode: 'live', error: true }
  }
  const message = data.choices?.[0]?.message ?? {}
  return {
    content: message.content || '',
    toolCalls: normalizeToolCalls(message),
    mode: 'live',
  }
}
