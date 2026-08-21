# AI Agent HTTP Relay — 設計文件

版本：v1.0
狀態：Approved for planning
來源需求：`requirement.md`（同目錄上層）

---

## 1. 目的與範圍

實作 `requirement.md` 描述的 AI Agent HTTP Relay MVP，並額外滿足：**同一份 codebase 需可相容部署到 Cloudflare Workers、Vercel、以及 Docker 自架三種環境**。

三個部署目標：

1. **Docker 自架**（Node.js 長駐 process）
2. **Cloudflare Workers**（V8 isolate，無 Node API）
3. **Vercel**（Node.js Serverless Functions，非 Edge Runtime — 見 §4 決策）

非目標（沿用 `requirement.md` §53）：資料庫、User Account、Admin Panel、OAuth、OTP、JWT、Request History UI 等一律不做。

---

## 2. 架構總覽

```
                        ┌─────────────────────────────┐
                        │           core/             │
                        │  (runtime-agnostic 業務邏輯)  │
                        │                              │
                        │  app.ts (Hono routes)        │
                        │  config.ts / auth.ts         │
                        │  validation.ts / headers.ts  │
                        │  relay.ts (orchestrator)     │
                        │  ssrf/ipRules.ts             │
                        │  ssrf/hostAllowlist.ts       │
                        │  rateLimiter.ts (interface)  │
                        │  requestId.ts / logger.ts    │
                        │  errors.ts                   │
                        └───────────┬─────────────────┘
                                    │ 注入 resolver / httpClient / rateLimiter 介面
              ┌─────────────────────┼─────────────────────┐
              ▼                     ▼                     ▼
    adapters/node/          adapters/workers/       adapters/vercel/
    - dns 解析 + IP pin      - DoH 解析 (best-effort)  - 重用 adapters/node
    - undici 自訂 lookup     - Durable Object 計數器    - @hono/node-server/vercel
    - 記憶體 rate limiter    - Workers entry (fetch)     handle() 包裝
              │                     │                     │
              ▼                     ▼                     ▼
        Dockerfile           wrangler.toml           vercel.json
```

`core/` 不 import 任何 Node 專屬模組（`dns`、`http`、`node:*`）。所有 IO（DNS 解析、實際送出 HTTP 請求、rate limit 計數）都透過介面注入，三個 adapter 各自實作，`core/relay.ts` 的流程與安全檢查順序只寫一次、三邊共用、可單元測試。

---

## 3. 專案結構

```
agent-http-relay/
├─ src/
│  ├─ core/
│  │  ├─ app.ts                 # Hono app：GET /health, POST /api/relay, ALL /api/echo
│  │  ├─ config.ts              # zod schema，loadConfig(env: Record<string,string|undefined>)
│  │  ├─ auth.ts                # Bearer Token 比對（timing-safe compare）
│  │  ├─ validation.ts          # Payload schema：method/url/query/headers/bodyType/body
│  │  ├─ headers.ts             # Header 黑名單過濾（§14）
│  │  ├─ relay.ts               # 依 §51 十三步驟組裝流程
│  │  ├─ echo.ts                # /api/echo 邏輯：回音收到的 method/query/headers/body
│  │  ├─ ssrf/
│  │  │  ├─ ipRules.ts          # IPv4/IPv6 private/loopback/link-local/reserved/multicast 判斷
│  │  │  └─ hostAllowlist.ts    # exact-match allowlist（禁止 substring 誤判）
│  │  ├─ rateLimiter.ts         # RateLimiter 介面 + InMemoryRateLimiter 實作
│  │  ├─ requestId.ts
│  │  ├─ logger.ts              # 結構化 stdout log，遮蔽敏感資訊
│  │  └─ errors.ts              # RelayError + 錯誤碼列舉（§50）
│  │
│  ├─ adapters/
│  │  ├─ node/
│  │  │  ├─ dnsResolver.ts      # dns.promises.resolve4/resolve6
│  │  │  ├─ pinnedFetch.ts      # undici Agent + 自訂 lookup，連線釘住已驗證 IP
│  │  │  ├─ rateLimiter.ts      # 記憶體版（Docker + Vercel Node 共用）
│  │  │  └─ server.ts           # @hono/node-server serve()，Docker 進入點
│  │  ├─ workers/
│  │  │  ├─ dohResolver.ts      # Cloudflare DoH JSON API 查詢 A/AAAA
│  │  │  ├─ rateLimitDO.ts      # Durable Object 計數器
│  │  │  └─ entry.ts            # export default { fetch(request, env, ctx) }
│  │  └─ vercel/
│  │     └─ handler.ts          # @hono/node-server/vercel handle(app)，重用 adapters/node
│
├─ public/
│  ├─ index.html / app.js / style.css   # Relay Page（§5）
│  └─ test.html                         # Agent 自我驗證頁（本次新增）
│
├─ tests/
│  ├─ ssrf.test.ts / headers.test.ts / auth.test.ts
│  ├─ relay.test.ts             # mock resolver + httpClient，驗證 §51 順序與錯誤碼
│  ├─ rateLimiter.test.ts
│  └─ workers/                  # @cloudflare/vitest-pool-workers 專案，跑在真實 workerd
│     └─ dohResolver.test.ts
│
├─ Dockerfile
├─ docker-compose.yml
├─ wrangler.toml
├─ vercel.json
├─ .env.example
├─ vitest.config.ts             # workspace：node 環境 + workers 環境兩個 project
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

## 4. 關鍵技術決策

| 決策點 | 選擇 | 理由 |
|---|---|---|
| Web Framework | **Hono** | 原生支援 Workers / Vercel Node / Node.js standalone，符合「不用大型框架」精神，同一份路由與 middleware 三邊共用 |
| Vercel Runtime | **Node.js Serverless Functions**（非 Edge） | 讓 Vercel 也能做完整 DNS 解析 + IP pinning，SSRF 保護強度與 Docker 一致 |
| SSRF 防護 | Node/Vercel：DNS 解析 + IP pin（無 TOCTOU 空隙）；Workers：DoH 驗證後放行原生 fetch（best-effort，文件明確標註限制） | Workers runtime 無法控制連線 IP，這是該平台的硬限制，不可能做到跟 Node 對等的保護，需誠實記錄差異而非假裝相同 |
| Rate Limiting | Docker/Vercel：記憶體 Map；Workers：Durable Object | 三者皆為 defense-in-depth，主防線建議掛平台層（Cloudflare Rate Limiting Rules / Vercel Firewall） |
| 測試框架 | **Vitest** + `@cloudflare/vitest-pool-workers` | 可在真實 workerd 環境驗證 Workers 專屬邏輯（DoH resolver、Durable Object），同時一般 Node 邏輯用標準環境測試 |
| Agent 自我驗證 | 新增 `/api/echo` + `/test` 頁面 | Relay 沒有資料庫也不假設有外部 webhook，用自身提供的回音端點讓 Agent 端到端驗證整個流程可用 |

---

## 5. 安全檢查順序（`core/relay.ts`，對應 `requirement.md` §51）

1. Authentication（Bearer Token 比對，失敗回 `INVALID_RELAY_TOKEN`）
2. Payload Schema Validation（zod，失敗回對應錯誤）
3. Method Validation（比對 `ALLOWED_METHODS`）
4. Parse URL（失敗回 `INVALID_URL`）
5. Protocol Validation（僅 `http:`/`https:`，`http:` 需 `ALLOW_HTTP=true`）
6. Host Allowlist（exact-match，`ALLOWED_HOSTS` 或 `ALLOW_ANY_PUBLIC_HOST=true`）
7. DNS Resolution（Node：`dns.promises`；Workers：DoH）
8. SSRF Validation（所有候選 IP 都要通過 `ipRules.ts`，任一不通過即拒絕，回 `SSRF_BLOCKED`）
9. Header Filtering（黑名單見 `requirement.md` §14）
10. Body Size Validation（`MAX_REQUEST_BODY_BYTES`，超過回 413 `REQUEST_TOO_LARGE`）
11. Send HTTP Request（Node：IP-pinned；Workers：一般 fetch；不 follow redirect；套用 `REQUEST_TIMEOUT_MS`）
12. Response Size Validation（邊讀邊算 byte 數，超過 `MAX_RESPONSE_BODY_BYTES` 立刻中止並回 `RESPONSE_TOO_LARGE`）
13. Return Response（Target 的 HTTP 狀態一律視為 Relay 成功，見 `requirement.md` §30）

任何步驟拋出的 `RelayError` 都在 Hono 的錯誤處理 middleware 統一轉成 JSON 格式，帶上 `success:false`、`error.code`、`error.message`，並附 `requestId`。

---

## 6. Echo 測試端點與自我驗證頁（本次新增）

- **`/api/echo`**：接受任意 HTTP method，不需要 Bearer Token（角色是「被 Relay 呼叫的目標」，非管理端點）。回傳 JSON：`{ method, path, query, headers, body, receivedAt }`，其中 headers 套用與 `headers.ts` 相同的黑名單過濾。
- **`/test`**（`public/test.html`）：純靜態頁面，內容：
  - 用 `location.origin + "/api/echo"` 算出目前部署的 echo 網址，唯讀 input + 複製按鈕
  - 條列操作步驟（開 Relay Page → 選 Method → 貼 echo 網址 → 加測試用 Query/Header/Body → Send → 對照 `RESPONSE_BODY` 是否原樣包含剛填內容）
  - 沿用 Relay Page 的 DOM 穩定性與可操作性規則（label/id 齊全、純文字按鈕）
- **限制**（寫入 README）：echo 端點與 Relay 同源，需把部署網域加進 `ALLOWED_HOSTS` 才能被呼叫；本機用 `localhost` 測試會被 SSRF loopback 規則擋下，這是刻意保留的行為（allowlist 與 SSRF 是兩道獨立防線），本機驗證建議改用可公開解析的網域。

---

## 7. Config / 環境變數

`core/config.ts` 用 zod 定義 schema，函式簽名 `loadConfig(env: Record<string, string | undefined>): Config`，不直接讀 `process.env`：

- Node/Docker/Vercel adapter 傳入 `process.env`
- Workers adapter 傳入 `env`（`fetch(request, env, ctx)` 的第二參數）

環境變數沿用 `requirement.md` §31，新增：

```env
RATE_LIMIT_MAX=30
RATE_LIMIT_WINDOW_MS=60000
```

---

## 8. 各平台部署細節

- **Docker**：多階段 Dockerfile（build → `node:20-alpine` runtime），`adapters/node/server.ts` 用 `@hono/node-server` 監聽 `PORT`，靜態檔案用 `serveStatic` 提供 `public/`。
- **Cloudflare Workers**：`wrangler.toml` 設定 Assets binding 指向 `public/`（`run_worker_first` 設定 `/api/*` 與 `/health` 一定進 Worker script，其餘靜態檔由 Assets 直接處理不經過 script）；Durable Object binding 用於 rate limiter；`RELAY_TOKEN` 用 `wrangler secret put` 設定，不寫入 `wrangler.toml`。
- **Vercel**：`public/` 自動作為靜態資源；API 用 `adapters/vercel/handler.ts`（Node.js runtime，非 Edge）掛在 `/api` 路徑下；環境變數透過 Vercel Dashboard / `.env` 設定。

---

## 9. 測試計畫

- `tests/ssrf.test.ts`：`requirement.md` §59（SSRF 各私有/loopback/link-local IP）+ §60（allowlist exact-match，含 `example.com.attacker.com` 反例）全部案例
- `tests/headers.test.ts`：黑名單 Header 全部拒絕，允許清單全部通過
- `tests/auth.test.ts`：錯誤/正確 Token，確認 Token 不出現在 Response/Log/Error Stack
- `tests/relay.test.ts`：mock resolver + httpClient，驗證 13 步驟順序、各錯誤碼觸發時機、Target 4xx/5xx 視為 Relay 成功
- `tests/rateLimiter.test.ts`：超過限制回對應錯誤/429
- `tests/workers/dohResolver.test.ts`：在 `@cloudflare/vitest-pool-workers` 環境下驗證 DoH 查詢與 IP 驗證邏輯

---

## 10. 驗收標準

沿用 `requirement.md` §64 全部項目，額外加入：

- [ ] 同一份 `src/core` 邏輯可分別被 Docker / Workers / Vercel 三個 adapter 引用並通過測試
- [ ] `/api/echo` + `/test` 頁面可讓 Agent 完成一次端到端驗證（Relay Page → echo → 對照 RESPONSE_BODY）
- [ ] Workers 環境的 SSRF 限制（best-effort DoH 驗證）在 README 中明確記載
