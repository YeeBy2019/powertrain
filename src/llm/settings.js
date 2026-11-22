// Provider presets and localStorage-backed settings for the optional LLM console.
const KEY = 'powertrain.llm.v1'

export const PROVIDERS = {
  openai: { label: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  deepseek: { label: 'DeepSeek', base: 'https://api.deepseek.com', model: 'deepseek-flash' },
  custom: { label: 'Custom (OpenAI-compatible)', base: '', model: '' },
}

export const DEFAULT_SETTINGS = {
  mode: 'demo', // 'demo' works offline; 'live' needs a key.
  provider: 'openai',
  base: PROVIDERS.openai.base,
  model: PROVIDERS.openai.model,
  apiKey: '',
}

export function loadSettings() {
  let stored = {}
  try {
    stored = JSON.parse(localStorage.getItem(KEY) || '{}') || {}
  } catch {
    stored = {}
  }
  // URL params win for the current session but are never persisted.
  const params = new URLSearchParams(location.search)
  const forced = params.get('llm')
  const mode = forced === 'demo' || forced === 'live' ? forced : stored.mode
  return { ...DEFAULT_SETTINGS, ...stored, mode, apiKey: stored.apiKey ?? '' }
}

export function saveSettings(settings) {
  const { mode, provider, base, model, apiKey } = settings
  localStorage.setItem(KEY, JSON.stringify({ mode, provider, base, model, apiKey }))
}

export function applyProvider(settings, provider) {
  const preset = PROVIDERS[provider]
  if (!preset) return settings
  return { ...settings, provider, base: preset.base, model: preset.model }
}
