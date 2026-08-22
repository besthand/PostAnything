# AI Agent HTTP Relay

給「只能操作瀏覽器、無法執行程式或 curl」的 AI Agent 使用的 HTTP Relay。
Agent 開啟 Relay Page、填表、按 SEND REQUEST，由 Relay Server 代為送出 HTTP Request。

- 需求文件：`requirement.md`
- 設計文件：`docs/superpowers/specs/2026-08-21-agent-http-relay-design.md`
- Agent Skill 範本：`docs/agent-skill.md`

## 安全模型

Secret Relay URL + 256-bit Token + Domain Allowlist + SSRF Protection +
Header Filtering + Payload Limit + Timeout + Rate Limit。

Token 決定「誰可以呼叫 Relay」；Allowlist 與 SSRF 決定「Relay 可以呼叫哪裡」。
兩者互不替代，缺一不可。

## 端點

| 路徑 | 認證 | 說明 |
|---|---|---|
| `GET /` | 不需要 | Relay Page |
| `GET /test.html` | 不需要 | Agent 自我驗證頁 |
| `GET /health` | 不需要 | 只回 `{"status":"ok"}` |
| `POST /api/relay` | Bearer Token | 代送 HTTP Request |
| `ALL /api/echo` | 不需要 | 回音端點，作為自我驗證的目標 |

## 環境變數

完整清單見 `.env.example`。必填只有 `RELAY_TOKEN`。

產生 Token：

    node -e "console.log('relay_'+require('crypto').randomBytes(32).toString('base64url'))"

Token 只能存在 server 環境，不可進 Git、不可回傳瀏覽器、不可寫入 log。
Rotation 方式就是換掉 `RELAY_TOKEN` 後重啟／重新部署。

## 部署

### Docker

    cp .env.example .env    # 填入 RELAY_TOKEN 與 ALLOWED_HOSTS
    docker compose up -d
    curl -s localhost:3000/health

### Vercel

    vercel deploy

在 Vercel Dashboard 設定環境變數（至少 `RELAY_TOKEN`、`ALLOWED_HOSTS`）。
API 跑 Node.js Serverless Function（非 Edge），因此保有完整 DNS 解析與 IP pinning。
建議另外開 Vercel Firewall 的 rate limiting，內建的記憶體計數器在 serverless 只涵蓋單一 instance。

### Cloudflare Workers

    npx wrangler secret put RELAY_TOKEN
    npx wrangler deploy

限流由 Durable Object 負責。建議另外開 Cloudflare Rate Limiting Rules 作為主防線。

## 平台差異：Workers 的 SSRF 保護較弱

| | Docker / Vercel | Cloudflare Workers |
|---|---|---|
| DNS 解析 | `dns.promises.resolve4/6` | Cloudflare DoH JSON API |
| 連線 IP | **釘在已驗證的 IP 上**（undici 自訂 lookup） | 交給平台原生 `fetch`，無法指定 |
| DNS rebinding | 無 TOCTOU 空隙 | **存在 TOCTOU 空隙，best-effort** |

Workers runtime 沒有提供控制連線 IP 的能力，這是平台硬限制，不是實作疏漏。
對 SSRF 防護強度要求最高的部署，請選 Docker 或 Vercel。

## Agent 自我驗證

1. 開 `/test.html`，複製 `ECHO URL`
2. 把該網域加進 `ALLOWED_HOSTS`（或設 `ALLOW_ANY_PUBLIC_HOST=true`）
3. 回 Relay Page，依 `/test.html` 上的步驟送出一次請求
4. 對照 `RESPONSE_BODY` 是否原樣包含剛才填的 query、header、body

本機用 `localhost` 測試會得到 `SSRF_BLOCKED`，這是刻意保留的行為 —
allowlist 與 SSRF 是兩道獨立防線。本機自我驗證請改用可公開解析的網域。

## 錯誤碼

`INVALID_RELAY_TOKEN` `METHOD_NOT_ALLOWED` `HOST_NOT_ALLOWED` `INVALID_URL`
`SSRF_BLOCKED` `INVALID_HEADER` `REQUEST_TOO_LARGE` `RESPONSE_TOO_LARGE`
`DNS_LOOKUP_FAILED` `TARGET_TIMEOUT` `TARGET_CONNECTION_FAILED` `INVALID_JSON`
`RATE_LIMITED` `INTERNAL_ERROR`

Target 回 4xx/5xx **不是** Relay 錯誤：Relay 會回 `STATUS: SUCCESS` 加上該 HTTP 狀態碼。

## 開發

    npm install
    npm test              # core + node adapter 測試
    npm run test:workers  # 在真實 workerd 上跑 Workers 測試
    npm run typecheck
    npm run dev           # 本機啟動（需要先設 RELAY_TOKEN）

`src/core/` 不得 import 任何 `node:*` 模組 — 那會讓 Workers build 失敗。
所有 IO 都透過 `DnsResolver` / `HttpClient` / `RateLimiter` 介面注入。
