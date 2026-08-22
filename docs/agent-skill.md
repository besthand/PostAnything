# Agent Skill：使用 HTTP Relay 發送請求

當你需要發送 HTTP Request（呼叫 Webhook、啟動 n8n Workflow、呼叫 REST API）時：

1. 用瀏覽器開啟 `https://<你的 relay 網域>/#token=<RELAY_TOKEN>`。
   如果 Relay Page 已經開著，不需要重新開啟。
2. 確認頁面上顯示 `TOKEN: LOADED`。
3. 在 `Method` 選單選擇 HTTP Method。
4. 在 `URL` 欄位輸入目標網址（不需要自己做 URL encoding）。
5. 需要 Query Parameter 時，按 `ADD PARAMETER`，填 Key 與 Value。
6. 需要 HTTP Header 時，按 `ADD HEADER`，填 Header 名稱與 Value。
7. 在 `Body Type` 選 `none` / `JSON` / `raw` / `application/x-www-form-urlencoded`。
8. 填入 Request Body（選 form 時改用 `ADD FORM FIELD` 逐欄填寫）。
9. 想先確認內容可按 `SHOW REQUEST PREVIEW`。
10. 按 `SEND REQUEST`，按鈕會變成 `SENDING...`。等它變回 `SEND REQUEST`。
11. 讀 `HTTP RESPONSE` 區域的 `STATUS`、`HTTP_STATUS`、`RESPONSE_BODY`。
12. 依 Target Server 的回應決定工作是否完成。

判讀規則：

- `STATUS: SUCCESS` = Relay 成功送出請求。再看 `HTTP_STATUS` 判斷目標服務的結果。
- `STATUS: ERROR` = Relay 本身拒絕或失敗，看 `ERROR_CODE`：
  - `INVALID_RELAY_TOKEN` — token 沒帶到或不正確，重新用 `#token=` 開啟頁面
  - `HOST_NOT_ALLOWED` — 目標網域不在管理者設定的 allowlist，需要管理者調整
  - `SSRF_BLOCKED` — 目標指向內部網路，這個請求不可能成功，不要重試
  - `METHOD_NOT_ALLOWED` — 換一個被允許的 Method
  - `TARGET_TIMEOUT` — 目標服務沒回應，可稍後重試
  - `RATE_LIMITED` — 送太快，等一分鐘再試

回報問題給管理者時附上 `REQUEST_ID`，可對照伺服器 log。

這份 Skill 保存了 Relay Token，應視為 credential-bearing configuration 妥善保管。
