# AI Agent HTTP Relay

給「只能操作瀏覽器、無法執行程式 / curl / Python」的 AI Agent 用的 HTTP Relay 橋接工具。

Agent 開啟 Relay Page、填表單、按 SEND REQUEST，由 Relay Server 代為送出真正的 HTTP Request（呼叫 Webhook、觸發 n8n Workflow、打 REST API）。可執行程式的 Agent 也能跳過網頁、直接打 API。

一份程式碼可部署到 Docker / Vercel（Node.js Serverless）/ Cloudflare Workers。

- Agent Skill 範本：[`docs/agent-skill.md`](docs/agent-skill.md)
- 開發者指引：[`CLAUDE.md`](CLAUDE.md)

## 為什麼需要這個

很多瀏覽器自動化型 Agent（Claude computer-use、Operator 類產品、純網頁操作型 Agent）沒有 shell、沒有 curl、也不一定有原生 HTTP tool 或 MCP fetch server，卻常需要呼叫 Webhook、打 API、觸發自動化流程。

這個 Relay 提供一個穩定、DOM 簡單、AI 容易判讀的網頁介面，讓這類 Agent 用「填表單、按按鈕」的方式間接發出任意 HTTP Request，同時保留必要的安全防護（Token 認證 + Domain Allowlist + SSRF Protection），避免 Relay 淪為 Open Proxy。

## 安全模型

Secret Relay URL + 256-bit Token + Domain Allowlist + SSRF Protection +
Header Filtering + Payload Limit + Timeout + Rate Limit。

Token 決定「誰可以呼叫 Relay」；Allowlist 與 SSRF 決定「Relay 可以呼叫哪裡」。
兩者互不替代，缺一不可。

## 端點

| 路徑 | 認證 | 說明 |
|---|---|---|
| `GET /` | 不需要 | Relay Page（表單操作介面） |
| `GET /test.html` | 不需要 | Agent 自我驗證頁 |
| `GET /health` | 不需要 | 只回 `{"status":"ok"}` |
| `POST /api/relay` | Bearer Token | 代送 HTTP Request（核心 API） |
| `ALL /api/echo` | 不需要 | 回音端點，作為自我驗證的目標 |

---

## 依 Agent 類型的使用方式

先判斷你的 Agent 屬於哪一種，再挑對應的整合方式。兩種方式打的是同一個後端、同一組安全防護，差別只在「誰負責填表單」。

### A. 純瀏覽器操作型 Agent（無法執行程式 / curl）

適用：Claude computer-use、Operator 類產品、任何只能「開網頁、點按鈕、填欄位」的 Agent。

1. 用瀏覽器開啟 `https://<你的 relay 網域>/#token=<RELAY_TOKEN>`（用 `#`，不是 `?`；Token 不會進 Server Log）。若 Relay Page 已經開著，不用重開。
2. 確認頁面顯示 `TOKEN: LOADED`。
3. 選 `Method`、填 `URL`，需要的話用 `ADD PARAMETER` / `ADD HEADER` / `ADD FORM FIELD` 逐欄補齊，不需要自己做 URL encoding。
4. 想先確認內容可按 `SHOW REQUEST PREVIEW`（Authorization 等敏感 Header 只在預覽中顯示為 `********`）。
5. 按 `SEND REQUEST`，等按鈕從 `SENDING...` 變回 `SEND REQUEST`。
6. 讀 `HTTP RESPONSE` 區塊的 `STATUS`、`HTTP_STATUS`、`RESPONSE_BODY`，判斷工作是否完成。

把 [`docs/agent-skill.md`](docs/agent-skill.md) 整份貼進 Agent 的 Skill / System Prompt / Custom Instructions，就能讓它照這套流程自主操作。**這份 Skill 內含 Relay URL 與 Token，屬於 credential-bearing configuration，保管方式等同密碼。**

### B. 可執行程式碼 / Shell 的 Agent（Claude Code、Codex、Cursor Agent 等）

這類 Agent 不需要走網頁，直接呼叫 API 更快更省 token：

```bash
curl -X POST https://<你的 relay 網域>/api/relay \
  -H "Authorization: Bearer $RELAY_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "method": "POST",
    "url": "https://example.com/webhook",
    "query": { "source": "agent" },
    "headers": { "X-API-Key": "xxx" },
    "bodyType": "json",
    "body": { "title": "Hello" }
  }'
```

`RELAY_TOKEN` 用環境變數注入，**不要**寫進程式碼、commit、或印進終端機 log。回應格式見下方「Payload 與回應格式」。

### C. 已有原生 HTTP Tool 或 MCP fetch server 的 Agent

如果 Agent 本來就能直接發 HTTP Request（原生 tool、MCP `fetch`/`http` server），通常不需要這個 Relay ——直接呼叫目標 API 就好，多一層 Relay 只是多一個延遲與依賴。

例外：目標服務有 IP allowlist、需要固定出口 IP，或執行環境的網路被限制對外連線時，可以把這個 Relay 當作「有固定出口 IP 的跳板」，一樣照方式 B 呼叫 `/api/relay`。

### D. Workflow 平台（n8n、Zapier 等）

把 Relay 當作一般 HTTP Request 節點打：`POST /api/relay`，`Authorization: Bearer <RELAY_TOKEN>`，Body 放 JSON payload（格式同上）。適合平台本身連不到目標網域、需要先過 SSRF / Allowlist 檢查的情境。

---

## Payload 與回應格式

`POST /api/relay` 的 Request Body：

```json
{
  "method": "POST",
  "url": "https://example.com/webhook",
  "query": { "source": "agent" },
  "headers": { "Authorization": "Bearer abc123" },
  "bodyType": "json",
  "body": { "title": "Hello", "content": "Hello World" }
}
```

`bodyType` 可選 `none` / `json` / `raw` / `form`（對應 `application/x-www-form-urlencoded`）。

成功回應：

```json
{
  "success": true,
  "requestId": "req_01JXYZ",
  "request": { "method": "POST", "url": "https://example.com/webhook?source=agent" },
  "response": { "status": 200, "statusText": "OK", "headers": {}, "body": { "id": 123 } }
}
```

**Target 回 4xx/5xx 不算 Relay 錯誤** —— Relay 一樣回 `success: true`，`response.status` 是目標服務的實際狀態碼。只有 Relay 自己拒絕或失敗時才會回 `success: false`：

```json
{ "success": false, "error": { "code": "SSRF_BLOCKED", "message": "..." } }
```

## 錯誤碼

`INVALID_RELAY_TOKEN` `METHOD_NOT_ALLOWED` `HOST_NOT_ALLOWED` `INVALID_URL`
`SSRF_BLOCKED` `INVALID_HEADER` `REQUEST_TOO_LARGE` `RESPONSE_TOO_LARGE`
`DNS_LOOKUP_FAILED` `TARGET_TIMEOUT` `TARGET_CONNECTION_FAILED` `INVALID_JSON`
`RATE_LIMITED` `INTERNAL_ERROR`

常見判讀：`HOST_NOT_ALLOWED` 要請管理者把網域加進 `ALLOWED_HOSTS`；`SSRF_BLOCKED` 代表目標指向內部網路，不要重試；`RATE_LIMITED` 等一分鐘再送；`INVALID_RELAY_TOKEN` 重新確認 Token 是否正確帶入。

## 環境變數

完整清單見 [`.env.example`](.env.example)。必填只有 `RELAY_TOKEN`。

產生 Token：

```bash
node -e "console.log('relay_'+require('crypto').randomBytes(32).toString('base64url'))"
```

Token 只能存在 server 環境，不可進 Git、不可回傳瀏覽器、不可寫入 log。Rotation 就是換掉 `RELAY_TOKEN` 後重啟／重新部署。

## 部署

### Docker

```bash
cp .env.example .env    # 填入 RELAY_TOKEN 與 ALLOWED_HOSTS
docker compose up -d
curl -s localhost:3000/health
```

### Vercel

```bash
vercel deploy
```

在 Vercel Dashboard 設定環境變數（至少 `RELAY_TOKEN`、`ALLOWED_HOSTS`）。API 跑 Node.js Serverless Function（非 Edge），保有完整 DNS 解析與 IP pinning。建議另外開 Vercel Firewall 的 rate limiting，內建的記憶體計數器在 serverless 只涵蓋單一 instance。

### Cloudflare Workers

```bash
npx wrangler secret put RELAY_TOKEN
npx wrangler deploy
```

限流由 Durable Object 負責。建議另外開 Cloudflare Rate Limiting Rules 作為主防線。

## 平台差異：Workers 的 SSRF 保護較弱

| | Docker / Vercel | Cloudflare Workers |
|---|---|---|
| DNS 解析 | `dns.promises.resolve4/6` | Cloudflare DoH JSON API |
| 連線 IP | **釘在已驗證的 IP 上**（undici 自訂 lookup） | 交給平台原生 `fetch`，無法指定 |
| DNS rebinding | 無 TOCTOU 空隙 | **存在 TOCTOU 空隙，best-effort** |

Workers runtime 沒有提供控制連線 IP 的能力，這是平台硬限制，不是實作疏漏。對 SSRF 防護強度要求最高的部署，請選 Docker 或 Vercel。

## Agent 自我驗證

1. 開 `/test.html`，複製 `ECHO URL`。
2. 把該網域加進 `ALLOWED_HOSTS`（或設 `ALLOW_ANY_PUBLIC_HOST=true`）。
3. 回 Relay Page（或直接打 API），依步驟送出一次請求。
4. 對照 `RESPONSE_BODY` 是否原樣包含剛才填的 query、header、body。

本機用 `localhost` 測試會得到 `SSRF_BLOCKED`，這是刻意保留的行為 —— allowlist 與 SSRF 是兩道獨立防線。本機自我驗證請改用可公開解析的網域。

## 開發

```bash
npm install
npm test              # core + node adapter 測試
npm run test:workers  # 在真實 workerd 上跑 Workers 測試
npm run typecheck
npm run dev            # 本機啟動（需要先設 RELAY_TOKEN）
```

`src/core/` 不得 import 任何 `node:*` 模組 —— 那會讓 Workers build 失敗。所有 IO 都透過 `DnsResolver` / `HttpClient` / `RateLimiter` 介面注入，三個部署 adapter（`src/adapters/{node,vercel,workers}/`）各自提供實作。細節見 [`CLAUDE.md`](CLAUDE.md)。
