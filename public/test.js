const echoInput = document.getElementById('echo-url')
const status = document.getElementById('copy-status')

echoInput.value = `${location.origin}/api/echo`

document.getElementById('copy-echo-url').addEventListener('click', async () => {
  echoInput.select()
  try {
    await navigator.clipboard.writeText(echoInput.value)
    status.textContent = 'COPY_STATUS: COPIED'
  } catch {
    // 沒有 clipboard 權限時，欄位已被選取，Agent 仍可直接讀值
    status.textContent = 'COPY_STATUS: SELECT_AND_COPY_MANUALLY'
  }
})
