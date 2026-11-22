// Collapsible natural-language console. Own DOM only; talks to the app through
// the documented __app hooks and to the LLM through client.js + commands.js.
import { askLLM } from './llm/client.js'
import { executeCommand } from './commands.js'
import { applyProvider, loadSettings, PROVIDERS, saveSettings } from './llm/settings.js'

const SUGGESTIONS = [
  'Dispatch an AGV to pick a V8 core from Row 2 and take it to Line 1',
  "What's the status?",
  'Focus on FL-3',
  'Back to overview',
]

export function mountChat({ app, getSim }) {
  const root = document.getElementById('chat-root')
  if (!root) return
  let settings = loadSettings()
  const history = []

  root.innerHTML = `
    <button id="chat-launcher" type="button" aria-label="Open control console" title="Control console">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-3 11H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
      <span class="chat-launch-dot"></span>
    </button>
    <aside id="chat-panel" hidden aria-label="Control console">
      <header class="chat-head">
        <div><strong>Control console</strong><span id="chat-mode" class="chat-mode">DEMO</span></div>
        <div class="chat-head-actions">
          <button id="chat-gear" type="button" title="Settings" aria-label="Settings">&#9881;</button>
          <button id="chat-close" type="button" title="Close" aria-label="Close">&#10005;</button>
        </div>
      </header>
      <div id="chat-log" class="chat-log" role="log" aria-live="polite"></div>
      <div id="chat-suggestions" class="chat-suggestions"></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" type="text" autocomplete="off" spellcheck="false" placeholder="Ask the hall to do something\u2026" aria-label="Command" />
        <button type="submit" title="Send" aria-label="Send">&#10148;</button>
      </form>
      <form id="llm-settings" class="llm-settings" hidden>
        <div class="llm-settings-title">Model connection</div>
        <label><input type="radio" name="llm-mode" value="demo" /> Demo (offline, no key)</label>
        <label><input type="radio" name="llm-mode" value="live" /> Live (your own API key)</label>
        <label>Provider
          <select id="llm-provider">${Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${p.label}</option>`).join('')}</select>
        </label>
        <label>Base URL <input id="llm-base" type="text" spellcheck="false" /></label>
        <label>Model <input id="llm-model" type="text" spellcheck="false" /></label>
        <label>API key <input id="llm-key" type="password" autocomplete="off" placeholder="sk-\u2026" /></label>
        <div class="llm-settings-foot"><span class="llm-note">Key stays in this browser and is used only by the local dev server.</span><button type="submit">Save</button></div>
      </form>
    </aside>`

  const launcher = root.querySelector('#chat-launcher')
  const panel = root.querySelector('#chat-panel')
  const closeButton = root.querySelector('#chat-close')
  const gearButton = root.querySelector('#chat-gear')
  const log = root.querySelector('#chat-log')
  const suggestions = root.querySelector('#chat-suggestions')
  const form = root.querySelector('#chat-form')
  const input = root.querySelector('#chat-input')
  const modeBadge = root.querySelector('#chat-mode')
  const settingsForm = root.querySelector('#llm-settings')

  function setModeBadge() {
    const live = settings.mode === 'live'
    modeBadge.textContent = live ? 'LIVE' : 'DEMO'
    modeBadge.classList.toggle('live', live)
  }

  function open() {
    panel.hidden = false
    launcher.classList.add('open')
    input.focus()
  }

  function close() {
    panel.hidden = true
    launcher.classList.remove('open')
  }

  function scrollDown() {
    log.scrollTop = log.scrollHeight
  }

  function addMessage(role, text) {
    const element = document.createElement('div')
    element.className = `chat-msg ${role}`
    element.textContent = text
    log.appendChild(element)
    scrollDown()
    return element
  }

  function renderSuggestions() {
    suggestions.innerHTML = ''
    for (const text of SUGGESTIONS) {
      const button = document.createElement('button')
      button.type = 'button'
      button.textContent = text
      button.addEventListener('click', () => {
        input.value = text
        form.requestSubmit()
      })
      suggestions.appendChild(button)
    }
  }

  function fillSettingsForm() {
    settingsForm.querySelector(`input[name="llm-mode"][value="${settings.mode}"]`).checked = true
    settingsForm.querySelector('#llm-provider').value = settings.provider
    settingsForm.querySelector('#llm-base').value = settings.base
    settingsForm.querySelector('#llm-model').value = settings.model
    settingsForm.querySelector('#llm-key').value = settings.apiKey
  }

  function syncSettingsFromForm() {
    const mode = settingsForm.querySelector('input[name="llm-mode"]:checked').value
    const provider = settingsForm.querySelector('#llm-provider').value
    settings = {
      mode,
      provider,
      base: settingsForm.querySelector('#llm-base').value.trim(),
      model: settingsForm.querySelector('#llm-model').value.trim(),
      apiKey: settingsForm.querySelector('#llm-key').value.trim(),
    }
    saveSettings(settings)
    setModeBadge()
    return settings
  }

  async function submit(text) {
    const command = String(text || '').trim()
    if (!command) return { ok: false, message: 'Empty command' }
    addMessage('user', command)
    input.value = ''
    const thinking = addMessage('assistant thinking', 'Thinking\u2026')
    history.push({ role: 'user', content: command })

    let result
    try {
      const answer = await askLLM({ text: command, history, settings })
      history.push({ role: 'assistant', content: [answer.content, ...answer.toolCalls.map((call) => call.name)].join(' ') })
      const outcomes = answer.toolCalls.map((call) => executeCommand({ app, sim: getSim(), command: call }))
      const failed = outcomes.find((item) => !item.ok)
      const spoken = answer.content || ''
      const report = outcomes.map((item) => item.message).filter(Boolean).join(' ')
      // The tool result is already phrased as a confirmation. Prefer it over a
      // second generated sentence so the chat never says the same thing twice.
      const message = report || spoken || (failed ? failed.message : 'Done.')
      result = { ok: !failed, message, content: answer.content, outcomes, mode: answer.mode }
      thinking.className = 'chat-msg assistant'
      thinking.textContent = message
    } catch (error) {
      result = { ok: false, message: error.message }
      thinking.className = 'chat-msg assistant error'
      thinking.textContent = `Error: ${error.message}`
    }
    scrollDown()
    if (app.ticket) app.ticket()
    return result
  }

  launcher.addEventListener('click', () => (panel.hidden ? open() : close()))
  closeButton.addEventListener('click', close)
  gearButton.addEventListener('click', () => {
    settingsForm.hidden = !settingsForm.hidden
    if (!settingsForm.hidden) fillSettingsForm()
  })

  form.addEventListener('submit', (event) => {
    event.preventDefault()
    submit(input.value)
  })

  // Keep global Space/Escape from reaching the canvas while typing.
  input.addEventListener('keydown', (event) => event.stopPropagation())

  settingsForm.addEventListener('submit', (event) => {
    event.preventDefault()
    syncSettingsFromForm()
    settingsForm.hidden = true
    addMessage('system', `Switched to ${settings.mode === 'live' ? 'live model' : 'offline demo'} mode.`)
  })
  settingsForm.addEventListener('keydown', (event) => event.stopPropagation())
  settingsForm.querySelector('#llm-provider').addEventListener('change', (event) => {
    settings = applyProvider(settings, event.target.value)
    settingsForm.querySelector('#llm-base').value = settings.base
    settingsForm.querySelector('#llm-model').value = settings.model
  })

  setModeBadge()
  renderSuggestions()
  addMessage('assistant', 'Hello. I can dispatch AGVs, report status, focus the camera, reset the view or change speed. Ask me anything in plain English.')

  app.llm = {
    open,
    close,
    submit,
    getSettings: () => ({ ...settings, apiKey: settings.apiKey ? '***' : '' }),
    setMode(mode) {
      settings.mode = mode === 'live' ? 'live' : 'demo'
      setModeBadge()
    },
    setKey(key) {
      settings.apiKey = key
    },
  }
}
