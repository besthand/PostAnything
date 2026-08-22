import { buildPayload, formatRequestPreview, formatResponseText } from './payload.js'

const TOKEN_KEY = 'relay_token'

// requirement.md §7：從 URL Fragment 取 token，存進 sessionStorage 後把網址列洗乾淨。
function loadToken() {
  const params = new URLSearchParams(location.hash.substring(1))
  const token = params.get('token')
  if (token) {
    sessionStorage.setItem(TOKEN_KEY, token)
    history.replaceState(null, '', location.pathname)
  }
  return sessionStorage.getItem(TOKEN_KEY)
}

function makeRow(container, keyLabel, valueLabel, index) {
  const row = document.createElement('div')
  row.className = 'kv-row'

  const keyId = `${container.id}-key-${index}`
  const valueId = `${container.id}-value-${index}`

  const keyLabelEl = document.createElement('label')
  keyLabelEl.htmlFor = keyId
  keyLabelEl.textContent = keyLabel

  const keyInput = document.createElement('input')
  keyInput.type = 'text'
  keyInput.id = keyId
  keyInput.name = keyId
  keyInput.className = 'kv-key'

  const valueLabelEl = document.createElement('label')
  valueLabelEl.htmlFor = valueId
  valueLabelEl.textContent = valueLabel

  const valueInput = document.createElement('input')
  valueInput.type = 'text'
  valueInput.id = valueId
  valueInput.name = valueId
  valueInput.className = 'kv-value'

  const removeButton = document.createElement('button')
  removeButton.type = 'button'
  removeButton.textContent = 'REMOVE'
  removeButton.addEventListener('click', () => row.remove())

  row.append(keyLabelEl, keyInput, valueLabelEl, valueInput, removeButton)
  container.append(row)
}

function readRows(container) {
  return Array.from(container.querySelectorAll('.kv-row')).map((row) => ({
    key: row.querySelector('.kv-key').value,
    value: row.querySelector('.kv-value').value,
  }))
}

const el = (id) => document.getElementById(id)

const queryRows = el('query-rows')
const headerRows = el('header-rows')
const formRows = el('form-rows')

let rowCounter = 0
const addRow = (container, keyLabel, valueLabel) => {
  rowCounter += 1
  makeRow(container, keyLabel, valueLabel, rowCounter)
}

function currentPayload() {
  return buildPayload({
    method: el('method').value,
    url: el('target-url').value,
    queryRows: readRows(queryRows),
    headerRows: readRows(headerRows),
    bodyType: el('body-type').value,
    bodyText: el('body-text').value,
    formRows: readRows(formRows),
  })
}

function syncBodySections() {
  const type = el('body-type').value
  el('body-text-section').hidden = type === 'none' || type === 'form'
  el('body-form-section').hidden = type !== 'form'
}

async function send(event) {
  event.preventDefault()

  const token = sessionStorage.getItem(TOKEN_KEY)
  const responseEl = el('http-response')

  if (!token) {
    responseEl.textContent =
      'STATUS: ERROR\n\nERROR_CODE: INVALID_RELAY_TOKEN\n\nMESSAGE:\nNo relay token in this tab. Open the relay URL with #token=... again.\n'
    return
  }

  const button = el('send-button')
  button.disabled = true
  button.textContent = 'SENDING...'
  responseEl.textContent = 'STATUS: SENDING'

  try {
    const res = await fetch('/api/relay', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(currentPayload()),
    })
    const json = await res.json()
    responseEl.textContent = formatResponseText(json)
  } catch (err) {
    responseEl.textContent = `STATUS: ERROR\n\nERROR_CODE: INTERNAL_ERROR\n\nMESSAGE:\n${String(err)}\n`
  } finally {
    button.disabled = false
    button.textContent = 'SEND REQUEST'
  }
}

el('add-query').addEventListener('click', () => addRow(queryRows, 'Key', 'Value'))
el('add-header').addEventListener('click', () => addRow(headerRows, 'Header', 'Value'))
el('add-form-field').addEventListener('click', () => addRow(formRows, 'Field', 'Value'))
el('body-type').addEventListener('change', syncBodySections)
el('preview-button').addEventListener('click', () => {
  el('request-preview').textContent = formatRequestPreview(currentPayload())
})
el('relay-form').addEventListener('submit', send)

// 初始各給一列，Agent 不必先按 ADD 就能填第一組值
addRow(queryRows, 'Key', 'Value')
addRow(headerRows, 'Header', 'Value')
addRow(formRows, 'Field', 'Value')
syncBodySections()

el('token-status').textContent = loadToken() ? 'TOKEN: LOADED' : 'TOKEN: NOT LOADED'
