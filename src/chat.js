// Collapsible natural-language console. Own DOM only; talks to the app through
// the documented __app hooks and to the LLM through client.js + commands.js.
import { askLLM } from './llm/client.js'
import { executeCommand } from './commands.js'
import { applyProvider, loadSettings, PROVIDERS, saveSettings } from './llm/settings.js'
import { createTranslator, getLocale } from './i18n/index.js'

const getSuggestions = (t) => [
  t('chat.suggest.1'),
  t('chat.suggest.2'),
  t('chat.suggest.3'),
  t('chat.suggest.4'),
]

export function mountChat({ app, getSim, getT = () => createTranslator(getLocale()), subscribe = () => () => {} }) {
  const root = document.getElementById('chat-root')
  if (!root) return
  let settings = loadSettings()
  let t = getT()
  const history = []

  root.innerHTML = `
    <button id="chat-launcher" type="button" aria-label="${t('chat.launchLabel')}" title="${t('chat.launchTitle')}">
      <svg viewBox="0 0 24 24" fill="currentColor"><path d="M20 2H4a2 2 0 0 0-2 2v18l4-4h14a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2zm-3 11H7v-2h10v2zm0-4H7V7h10v2z"/></svg>
      <span class="chat-launch-dot"></span>
    </button>
    <aside id="chat-panel" hidden aria-label="${t('chat.title')}">
      <header class="chat-head">
        <div><strong>${t('chat.title')}</strong><span id="chat-mode" class="chat-mode">DEMO</span></div>
        <div class="chat-head-actions">
          <button id="chat-gear" type="button" title="${t('chat.settings')}" aria-label="${t('chat.settings')}">&#9881;</button>
          <button id="chat-close" type="button" title="${t('chat.close')}" aria-label="${t('chat.close')}">&#10005;</button>
        </div>
      </header>
      <div id="chat-log" class="chat-log" role="log" aria-live="polite"></div>
      <div id="chat-suggestions" class="chat-suggestions"></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" type="text" autocomplete="off" spellcheck="false" placeholder="${t('chat.placeholder')}" aria-label="${t('chat.command')}" />
        <button type="submit" title="${t('chat.send')}" aria-label="${t('chat.send')}">&#10148;</button>
      </form>
      <form id="llm-settings" class="llm-settings" hidden>
        <div class="llm-settings-title">${t('chat.settingsTitle')}</div>
        <label><input type="radio" name="llm-mode" value="demo" /> ${t('chat.option.demo')}</label>
        <label><input type="radio" name="llm-mode" value="live" /> ${t('chat.option.live')}</label>
        <label>${t('chat.provider')}
          <select id="llm-provider">${Object.entries(PROVIDERS).map(([id, p]) => `<option value="${id}">${id === 'custom' ? t('provider.custom') : p.label}</option>`).join('')}</select>
        </label>
        <label>${t('chat.baseUrl')} <input id="llm-base" type="text" spellcheck="false" /></label>
        <label>${t('chat.model')} <input id="llm-model" type="text" spellcheck="false" /></label>
        <label>${t('chat.apiKey')} <input id="llm-key" type="password" autocomplete="off" placeholder="sk-\u2026" /></label>
        <div class="llm-settings-foot"><span class="llm-note">${t('chat.keyNote')}</span><button type="submit">${t('chat.save')}</button></div>
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
  const sendButton = form.querySelector('button[type="submit"]')
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
    for (const text of getSuggestions(t)) {
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

  function applyStaticText() {
    launcher.setAttribute('aria-label', t('chat.launchLabel'))
    launcher.title = t('chat.launchTitle')
    panel.setAttribute('aria-label', t('chat.title'))
    root.querySelector('.chat-head strong').textContent = t('chat.title')
    gearButton.title = t('chat.settings')
    gearButton.setAttribute('aria-label', t('chat.settings'))
    closeButton.title = t('chat.close')
    closeButton.setAttribute('aria-label', t('chat.close'))
    input.placeholder = t('chat.placeholder')
    input.setAttribute('aria-label', t('chat.command'))
    sendButton.title = t('chat.send')
    sendButton.setAttribute('aria-label', t('chat.send'))
    settingsForm.querySelector('.llm-settings-title').textContent = t('chat.settingsTitle')
    settingsForm.querySelector('input[value="demo"]').nextSibling.textContent = ` ${t('chat.option.demo')}`
    settingsForm.querySelector('input[value="live"]').nextSibling.textContent = ` ${t('chat.option.live')}`
    const labels = settingsForm.querySelectorAll(':scope > label')
    labels[2].firstChild.textContent = `${t('chat.provider')} `
    labels[3].firstChild.textContent = `${t('chat.baseUrl')} `
    labels[4].firstChild.textContent = `${t('chat.model')} `
    labels[5].firstChild.textContent = `${t('chat.apiKey')} `
    settingsForm.querySelector('.llm-note').textContent = t('chat.keyNote')
    settingsForm.querySelector('button[type="submit"]').textContent = t('chat.save')
    settingsForm.querySelector('#llm-provider option[value="custom"]').textContent = t('provider.custom')
    renderSuggestions()
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
    if (!command) return { ok: false, message: t('chat.empty') }
    addMessage('user', command)
    input.value = ''
    const thinking = addMessage('assistant thinking', t('chat.thinking'))
    history.push({ role: 'user', content: command })

    let result
    try {
      const answer = await askLLM({ text: command, history, settings, locale: getLocale(), t, signal: undefined })
      history.push({ role: 'assistant', content: [answer.content, ...answer.toolCalls.map((call) => call.name)].join(' ') })
      const outcomes = answer.toolCalls.map((call) => executeCommand({ app, sim: getSim(), command: call, t }))
      const failed = outcomes.find((item) => !item.ok)
      const spoken = answer.content || ''
      const report = outcomes.map((item) => item.message).filter(Boolean).join(' ')
      // The tool result is already phrased as a confirmation. Prefer it over a
      // second generated sentence so the chat never says the same thing twice.
      const message = report || spoken || (failed ? failed.message : t('chat.done'))
      result = { ok: !failed, message, content: answer.content, outcomes, mode: answer.mode }
      thinking.className = 'chat-msg assistant'
      thinking.textContent = message
    } catch (error) {
      result = { ok: false, message: t('chat.errorPrefix', { message: error.message }) }
      thinking.className = 'chat-msg assistant error'
      thinking.textContent = result.message
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
    const mode = settings.mode === 'live' ? t('chat.mode.liveLabel') : t('chat.mode.demoLabel')
    addMessage('system', t('chat.mode.switched', { mode }))
  })
  settingsForm.addEventListener('keydown', (event) => event.stopPropagation())
  settingsForm.querySelector('#llm-provider').addEventListener('change', (event) => {
    settings = applyProvider(settings, event.target.value)
    settingsForm.querySelector('#llm-base').value = settings.base
    settingsForm.querySelector('#llm-model').value = settings.model
  })

  subscribe((nextT) => {
    t = nextT
    applyStaticText()
    // Keep every bubble on screen; only drop the language-mixed model context.
    history.length = 0
  })

  setModeBadge()
  renderSuggestions()
  addMessage('assistant', t('chat.welcome'))

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
