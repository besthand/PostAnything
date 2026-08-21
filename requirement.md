# AI Agent HTTP Relay
## 需求文件與技術設計說明

版本：v1.0  
狀態：MVP Specification

---

# 1. 專案目的

AI Agent HTTP Relay 是一個提供給「具有瀏覽器操作能力，但無法執行程式、Shell、curl、Python 或原生 HTTP Tool」的 AI Agent 使用的 HTTP Relay。

AI Agent 可以透過瀏覽器開啟 Relay Page，填寫 HTTP Request 所需資訊並送出，由 Relay Server 代替 Agent 對外發送 HTTP Request。

主要用途包括：

- 呼叫 Webhook
- 啟動 n8n Workflow
- 呼叫 REST API
- 發送內容到第三方服務
- 使用需要自訂 HTTP Header 的 API
- 執行 GET、POST、PUT、PATCH、DELETE 等 HTTP Request

整體設計以以下原則為優先：

- Agent 可全自動操作
- 無需人工登入
- 無需 OTP
- 無需 OAuth
- 無需資料庫
- 無需 Session Server
- 無需帳號系統
- 使用 `.env` 管理 Relay Token 與安全設定
- Token 可直接寫入 Agent Skill
- 保留基本安全防護，避免 Relay 成為 Open Proxy 或 SSRF 跳板

---

# 2. 核心使用情境

典型流程：

```text
AI Agent
   │
   │ 開啟瀏覽器
   ▼
https://relay.example.com/#token=SECRET
   │
   ▼
Relay Page
   │
   │ Agent 填寫 HTTP Request
   ▼
POST /api/relay
   │
   ▼
Relay Backend
   │
   ├─ 驗證 Relay Token
   ├─ 驗證 HTTP Method
   ├─ 驗證 Target URL
   ├─ SSRF Protection
   ├─ Header Filtering
   ├─ Payload Size Limit
   └─ Timeout Protection
   │
   ▼
Target HTTP Endpoint
   │
   ▼
Relay Backend
   │
   ▼
Relay Page 顯示 Response
   │
   ▼
AI Agent 判讀結果
```

---

# 3. 使用者角色

## 3.1 AI Agent

主要使用者。

能力假設：

- 可以開啟網址
- 可以讀取網頁
- 可以填寫 Input / Textarea
- 可以選擇 Select / Radio
- 可以點擊 Button
- 可以閱讀送出後的 HTTP Response

不假設 Agent 可以：

- 執行 JavaScript
- 執行 Shell
- 執行 Python
- 使用 curl
- 使用 MCP
- 直接發送 HTTP Request
- 設定瀏覽器 Request Header

---

## 3.2 管理者

負責部署與設定 Relay。

管理者透過：

```text
.env
```

設定：

- Relay Token
- 可存取 Domain
- 可使用 HTTP Method
- Request 大小限制
- Response 大小限制
- Timeout
- 其他安全限制

MVP 不需要 Web Admin Panel。

---

# 4. MVP 功能需求

## 4.1 HTTP Method

Relay 必須至少支援：

```text
GET
POST
PUT
PATCH
DELETE
HEAD
OPTIONS
```

預設允許的 Method 由環境變數控制。

例如：

```env
ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE
```

HEAD 與 OPTIONS 可以視部署需求決定是否開放。

---

# 5. Relay Page

Relay Page 為 AI Agent 操作的主要介面。

頁面設計應以：

- 簡單
- 結構清楚
- DOM 穩定
- Label 明確
- 不依賴拖拉操作
- 不使用複雜 Modal
- 不使用 Canvas UI

為原則。

建議介面：

```text
┌─────────────────────────────────────────────┐
│ HTTP Relay                                  │
├─────────────────────────────────────────────┤
│                                             │
│ Method                                      │
│ [ POST ▼ ]                                  │
│                                             │
│ URL                                         │
│ [ https://example.com/webhook             ] │
│                                             │
│ Query Parameters                            │
│ Key                Value                    │
│ [ source ]         [ agent ]                │
│ [+ Add Parameter]                           │
│                                             │
│ Headers                                     │
│ Header             Value                    │
│ [ Content-Type ]   [ application/json ]     │
│ [+ Add Header]                              │
│                                             │
│ Body Type                                   │
│ [ JSON ▼ ]                                  │
│                                             │
│ Body                                        │
│ ┌─────────────────────────────────────────┐ │
│ │ {                                       │ │
│ │   "title": "Hello"                      │ │
│ │ }                                       │ │
│ └─────────────────────────────────────────┘ │
│                                             │
│ [ SEND REQUEST ]                            │
│                                             │
├─────────────────────────────────────────────┤
│ HTTP RESPONSE                               │
│                                             │
│ STATUS: 200 OK                              │
│                                             │
│ Headers                                     │
│ ...                                         │
│                                             │
│ Body                                        │
│ {...}                                       │
└─────────────────────────────────────────────┘
```

---

# 6. URL Token 認證

## 6.1 Token 傳遞

Agent Skill 中保存 Relay URL：

```text
https://relay.example.com/#token=<RELAY_TOKEN>
```

必須使用：

```text
#token=
```

而非：

```text
?token=
```

URL Fragment 不會透過 HTTP Request 傳給伺服器，可降低 Token 出現在以下位置的風險：

- Reverse Proxy Access Log
- Cloudflare Request Log
- Server Request Log
- Referer
- Analytics Request

---

# 7. 前端 Token 處理

頁面載入後：

```text
location.hash
      ↓
取得 token
      ↓
存入 sessionStorage
      ↓
移除 URL Fragment
```

概念流程：

```javascript
// 從 URL Fragment 讀取 Relay Token
const params = new URLSearchParams(location.hash.substring(1));
const token = params.get("token");

if (token) {
  // Token 僅存在目前瀏覽器分頁的 sessionStorage
  sessionStorage.setItem("relay_token", token);

  // 清除網址列中的 Token
  history.replaceState(null, "", location.pathname);
}
```

不建議使用：

```text
localStorage
```

因為 localStorage 會長期保存。

MVP 使用：

```text
sessionStorage
```

即可。

關閉 Browser Tab 後 Token 自動清除。

---

# 8. Relay API 認證

Agent 按下 Send 時，Frontend 呼叫：

```http
POST /api/relay
Authorization: Bearer <RELAY_TOKEN>
Content-Type: application/json
```

例如：

```javascript
// 將 HTTP Request 設定送到 Relay Backend
await fetch("/api/relay", {
  method: "POST",
  headers: {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${sessionStorage.getItem("relay_token")}`,
  },
  body: JSON.stringify(payload),
});
```

Backend 從：

```text
Authorization
```

取得 Token。

再與：

```text
process.env.RELAY_TOKEN
```

比對。

驗證失敗：

```http
HTTP/1.1 401 Unauthorized
```

回傳：

```json
{
  "success": false,
  "error": {
    "code": "INVALID_RELAY_TOKEN",
    "message": "Relay authentication failed."
  }
}
```

---

# 9. Token 生命週期

MVP 不需要實作 Token Expiration。

Relay Token 視同 API Key：

```text
永久有效
直到管理者更換 .env
```

例如：

```env
RELAY_TOKEN=OLD_SECRET
```

更換成：

```env
RELAY_TOKEN=NEW_SECRET
```

重新部署或重新啟動 Relay 後：

```text
OLD_SECRET → Invalid
NEW_SECRET → Valid
```

這樣即可完成 Token Rotation。

MVP 不實作：

- Refresh Token
- JWT
- Expiration
- Session Database
- Credential Database
- OAuth
- OTP

---

# 10. Token 強度

`RELAY_TOKEN` 必須使用密碼學安全亂數產生。

最低建議：

```text
256-bit
```

亦即：

```text
32 random bytes
```

禁止使用：

- UUID 作為唯一 Secret
- Timestamp
- Agent Name
- Sequential ID
- 自訂簡單密碼
- 可預測 Hash

建議格式：

```text
relay_<random-secret>
```

例如：

```text
relay_7N2qgHk......... 
```

---

# 11. HTTP Request Payload

Frontend 呼叫 `/api/relay` 時使用統一 JSON 格式。

例如：

```json
{
  "method": "POST",
  "url": "https://example.com/webhook",
  "query": {
    "source": "agent"
  },
  "headers": {
    "Authorization": "Bearer abc123",
    "Content-Type": "application/json"
  },
  "bodyType": "json",
  "body": {
    "title": "Hello",
    "content": "Hello World"
  }
}
```

---

# 12. Query Parameters

UI 必須支援 Key / Value 形式的 Query Parameter。

例如：

```text
source = agent
type = article
```

Backend 負責 URL Encoding。

最後產生：

```text
https://example.com/webhook?source=agent&type=article
```

Agent 不需要自行處理 URL Encoding。

---

# 13. Header 支援

UI 必須允許新增任意一般 HTTP Header。

例如：

```text
Authorization
Content-Type
Accept
User-Agent
X-API-Key
X-Custom-Header
Cookie
```

---

# 14. Header Blacklist

以下 Header 禁止由使用者指定：

```text
Host
Content-Length
Connection
Transfer-Encoding
Upgrade
Proxy-Authorization
Proxy-Connection
Forwarded
X-Forwarded-For
X-Forwarded-Host
X-Forwarded-Proto
X-Real-IP
```

另外建議阻擋：

```text
CF-*
X-Vercel-*
X-AWS-*
```

是否阻擋上述 Infrastructure Header 可以由實作決定。

HTTP Client 應自行管理：

```text
Content-Length
Host
Connection
Transfer-Encoding
```

---

# 15. Body Type

MVP 建議支援：

```text
none
JSON
raw
application/x-www-form-urlencoded
```

第二階段可以增加：

```text
multipart/form-data
```

若要維持 MVP 簡單，檔案上傳可以先不支援。

---

# 16. JSON Body

若選擇：

```text
bodyType = json
```

Backend 應：

1. 驗證 Body 為有效 JSON。
2. 自動加入：

```http
Content-Type: application/json
```

前提是 Agent 沒有自行指定 Content-Type。

---

# 17. Raw Body

Raw Body 必須允許自訂：

```text
Content-Type
```

例如：

```text
text/plain
application/xml
text/xml
text/html
application/octet-stream
```

---

# 18. Form URL Encoded

支援：

```http
Content-Type: application/x-www-form-urlencoded
```

UI 可以使用：

```text
Key / Value
```

格式輸入。

---

# 19. Domain Allowlist

Relay 不應預設允許任意網域。

使用：

```env
ALLOWED_HOSTS=
```

例如：

```env
ALLOWED_HOSTS=flow.handbro.pro,talkai.soft4fun.tw,api.example.com
```

Backend 只允許：

```text
hostname === allowed host
```

不要用危險的 substring 比對。

錯誤範例：

```text
allowed:
example.com

evil:
example.com.attacker.com
```

必須確保：

```text
example.com.attacker.com
```

不會通過。

---

# 20. Wildcard Domain

MVP 可以先不支援 Wildcard。

若之後需要：

```text
*.example.com
```

必須正確判斷 Domain Boundary。

例如：

```text
api.example.com
```

可以通過。

但：

```text
example.com.attacker.net
```

不可通過。

---

# 21. Custom HTTP Mode

若使用者需要真正通用 HTTP Client，可設定：

```env
ALLOW_ANY_PUBLIC_HOST=true
```

預設：

```env
ALLOW_ANY_PUBLIC_HOST=false
```

當設定為 true 時仍然必須執行完整 SSRF Protection。

---

# 22. SSRF Protection

這是 MVP 不可省略的安全功能。

即使 Relay Token 無法被猜到，Relay 仍然不得允許對內部網路發送 HTTP Request。

必須阻擋：

```text
localhost
```

以及：

```text
127.0.0.0/8
10.0.0.0/8
172.16.0.0/12
192.168.0.0/16
169.254.0.0/16
```

IPv6 至少阻擋：

```text
::1
fc00::/7
fe80::/10
```

以及其他：

- Loopback
- Private
- Link-local
- Reserved
- Multicast

位址。

---

# 23. DNS 驗證

不能只檢查 URL 字串。

Backend 流程必須：

```text
解析 Target URL
       ↓
取得 hostname
       ↓
DNS Resolve
       ↓
取得實際 IP
       ↓
判斷 IP 是否允許
       ↓
Allowed
       ↓
才送出 HTTP Request
```

如果 DNS Resolve 得到多個 IP：

```text
A
AAAA
```

所有候選 IP 都必須符合安全規則。

只要其中包含禁止位址，就應拒絕 Request。

---

# 24. Redirect

預設建議：

```text
不自動 Follow Redirect
```

例如 Target 回：

```http
HTTP/1.1 302 Found
Location: http://127.0.0.1/admin
```

Relay 不得直接跟隨。

MVP：

```env
FOLLOW_REDIRECTS=false
```

若未來允許 Redirect，每一次 Redirect 都必須重新：

- 驗證 Domain
- DNS Resolve
- SSRF Validation

---

# 25. Request Size Limit

避免 Relay 被用來傳送超大型 Request。

例如：

```env
MAX_REQUEST_BODY_BYTES=2097152
```

代表：

```text
2 MB
```

超過後：

```http
413 Payload Too Large
```

---

# 26. Response Size Limit

Relay 不應無限制下載 Target Response。

例如：

```env
MAX_RESPONSE_BODY_BYTES=5242880
```

代表：

```text
5 MB
```

若超過限制：

停止讀取。

回傳：

```json
{
  "success": false,
  "error": {
    "code": "RESPONSE_TOO_LARGE"
  }
}
```

---

# 27. Timeout

必須設定：

```env
REQUEST_TIMEOUT_MS=30000
```

例如：

```text
30 秒
```

避免 Target Server 長期占用 Relay 連線。

---

# 28. HTTP Response

Relay API 必須回傳：

```json
{
  "success": true,
  "request": {
    "method": "POST",
    "url": "https://example.com/webhook"
  },
  "response": {
    "status": 200,
    "statusText": "OK",
    "headers": {
      "content-type": "application/json"
    },
    "body": {
      "id": 123,
      "status": "published"
    }
  }
}
```

---

# 29. Agent Friendly Response UI

Relay Page 不能只顯示：

```text
SUCCESS
```

必須提供明確、容易讓 AI Agent 判讀的文字。

成功：

```text
STATUS: SUCCESS

HTTP_STATUS: 200

HTTP_STATUS_TEXT: OK

RESPONSE_BODY:

{
  "id": 123,
  "status": "published"
}
```

失敗：

```text
STATUS: ERROR

ERROR_CODE: TARGET_TIMEOUT

MESSAGE:
The target server did not respond within 30000 ms.
```

---

# 30. HTTP 失敗與 Relay 失敗要分開

例如 Target 回：

```text
HTTP 404
```

不代表 Relay 執行失敗。

Relay 應回：

```text
STATUS: SUCCESS

HTTP_STATUS: 404

HTTP_STATUS_TEXT: Not Found
```

意思是：

```text
Relay 成功完成 HTTP Request
Target Server 回應 404
```

只有以下情況屬於 Relay Error：

- Invalid Token
- URL Blocked
- SSRF Blocked
- Invalid Method
- Request Too Large
- Timeout
- DNS Failure
- Network Failure

---

# 31. `.env` 設計

MVP 建議：

```env
# ==============================
# Authentication
# ==============================

RELAY_TOKEN=replace_with_256_bit_random_secret


# ==============================
# HTTP Access Control
# ==============================

ALLOWED_METHODS=GET,POST,PUT,PATCH,DELETE

ALLOWED_HOSTS=flow.handbro.pro,talkai.soft4fun.tw

ALLOW_ANY_PUBLIC_HOST=false


# ==============================
# HTTP Limits
# ==============================

MAX_REQUEST_BODY_BYTES=2097152

MAX_RESPONSE_BODY_BYTES=5242880

REQUEST_TIMEOUT_MS=30000

FOLLOW_REDIRECTS=false


# ==============================
# Server
# ==============================

PORT=3000

NODE_ENV=production
```

---

# 32. 多 Agent 支援

MVP 可以只支援：

```env
RELAY_TOKEN=
```

若未來有多個 Agent，可增加：

```env
RELAY_TOKENS=
```

例如：

```env
RELAY_TOKENS=news:SECRET_A,research:SECRET_B,publisher:SECRET_C
```

但此功能不是 MVP 必要條件。

---

# 33. Secret 儲存原則

Relay 本身的：

```text
RELAY_TOKEN
```

只能存在：

```text
Server Environment
```

不可：

- hardcode 在 Frontend Bundle
- hardcode 在 JavaScript
- 放入 Git Repository
- 回傳給 Browser
- 寫入 Log

Agent Skill 本身會保存 Token URL，因此 Agent Skill 應被視為 Credential-bearing configuration。

---

# 34. Frontend 第三方資源

Relay Page 不應載入：

- Google Analytics
- Meta Pixel
- 廣告 SDK
- 第三方 Analytics
- 第三方 Chat Widget
- 不必要的 CDN JavaScript

原因是 Token 會短暫存在：

```text
location.hash
```

並保存於：

```text
sessionStorage
```

應降低第三方 JavaScript 存取 Secret 的可能性。

---

# 35. Content Security Policy

建議設定嚴格 CSP。

例如概念：

```text
default-src 'self';
script-src 'self';
style-src 'self';
connect-src 'self';
img-src 'self' data:;
frame-src 'none';
object-src 'none';
base-uri 'none';
```

若實作方式允許，避免：

```text
unsafe-inline
unsafe-eval
```

---

# 36. Logging

MVP 不需要資料庫。

Log 直接輸出：

```text
stdout
```

再交由：

- Docker Logs
- Portainer
- Cloudflare
- Hosting Platform

管理。

建議紀錄：

```text
timestamp
method
target_host
target_path
http_status
duration_ms
result
```

例如：

```text
2026-08-21T23:00:00+08:00
method=POST
host=flow.handbro.pro
path=/webhook/article
status=200
duration=431ms
result=success
```

禁止紀錄：

```text
Relay Token
Authorization Header
Cookie
API Key
完整 Request Body
完整敏感 Response Body
```

---

# 37. Header Log Masking

若需要 Log Header，只能記錄 Header Name。

例如：

```text
headers=[
  "content-type",
  "authorization",
  "x-api-key"
]
```

不可記錄：

```text
Authorization: Bearer SECRET
```

---

# 38. Rate Limiting

MVP 可以有兩種策略。

## Option A：Cloudflare Rate Limiting

推薦部署於 Cloudflare 後方時使用。

例如：

```text
/api/relay
```

限制：

```text
30 requests / minute / IP
```

---

## Option B：Application Rate Limiting

若不依賴 Cloudflare，可使用記憶體型 Rate Limiter。

因為不使用資料庫，所以重新啟動後計數歸零即可接受。

MVP 不需要 Redis。

---

# 39. Cloudflare 的角色

Cloudflare 不負責 Agent Authentication。

Cloudflare 可以負責：

- DNS
- TLS
- DDoS Protection
- WAF
- Rate Limiting

Agent Authentication 由：

```text
RELAY_TOKEN
```

完成。

因此不需要：

```text
Cloudflare Access
```

---

# 40. 部署架構

推薦：

```text
Internet
   │
   ▼
Cloudflare
   │
   ▼
Reverse Proxy
   │
   ▼
HTTP Relay Container
   │
   ▼
Target API / Webhook
```

若使用 Docker：

```text
Cloudflare
   ↓
Tengine / nginx
   ↓
relay:3000
```

---

# 41. Docker

應提供：

```text
Dockerfile
docker-compose.yml
.env.example
```

Container 本身保持 stateless。

因此可以：

```text
docker compose down
docker compose up -d
```

而不需要任何資料 migration。

---

# 42. 健康檢查

提供：

```http
GET /health
```

回：

```json
{
  "status": "ok"
}
```

`/health` 不需要 Relay Token。

但只能提供最低限度資訊。

不要回：

- Environment Variable
- Version Dependency
- Internal IP
- Token
- Allowed Hosts

---

# 43. API Endpoint

MVP 只需要：

```text
GET /
POST /api/relay
GET /health
```

即可。

不需要：

```text
/admin
/login
/logout
/users
/sessions
/oauth
```

---

# 44. Agent Skill 使用方式

Agent Skill 只需要描述：

```text
當需要發送 HTTP Request 時：

1. 使用瀏覽器開啟指定 HTTP Relay URL。

2. 如果 Relay Page 已經開啟，不需要重新開啟。

3. 選擇 HTTP Method。

4. 輸入 Target URL。

5. 如果需要 Query Parameter，新增 Key 與 Value。

6. 如果需要 HTTP Header，新增 Header Name 與 Value。

7. 選擇 Body Type。

8. 輸入 Request Body。

9. 點擊 SEND REQUEST。

10. 等待 HTTP RESPONSE 區域出現結果。

11. 讀取：
    STATUS
    HTTP_STATUS
    RESPONSE_BODY

12. 根據 Target Server 的 Response 決定工作是否完成。
```

Skill 不需要知道 Relay Backend 如何實作。

---

# 45. Agent 可操作性要求

所有 Form Element 必須具有：

```text
label
name
id
```

例如：

```html
<label for="target-url">URL</label>

<input
  id="target-url"
  name="targetUrl"
/>
```

按鈕名稱應清楚：

```text
SEND REQUEST
ADD HEADER
ADD PARAMETER
REMOVE
```

避免：

```text
只有 icon
```

例如不要只有：

```text
+
×
▶
```

因為不同 Browser Agent 對 icon 的辨識可靠度不同。

---

# 46. DOM 穩定性

為提高 Browser Agent 成功率：

不要使用：

- 動態拖曳
- Hover 才出現的按鈕
- Nested Modal
- Virtualized Form
- Shadow DOM
- Canvas Form
- 動畫才能操作的控制項

應使用標準：

```text
input
textarea
select
button
```

---

# 47. Send 防止重複操作

Agent 有可能重複點擊 Send。

Frontend 在 Request 執行期間：

```text
SEND REQUEST
```

應變成：

```text
SENDING...
```

並 disabled。

Request 完成後恢復。

避免短時間重複送出。

---

# 48. Request ID

每一次 Relay Request 建議產生：

```text
REQUEST_ID
```

例如：

```text
req_01J...
```

Response 顯示：

```text
REQUEST_ID: req_01JXYZ
```

Log 也紀錄同一個 ID。

如果 Agent 回報錯誤，管理者可以從 Docker Log 找到該 Request。

Request ID 不需要資料庫。

---

# 49. Request 預覽

Send 前可以顯示：

```text
REQUEST PREVIEW
```

例如：

```text
POST https://example.com/webhook?source=agent

Content-Type: application/json
Authorization: ********

{
  "title": "Hello"
}
```

敏感 Header 必須 mask。

此功能非 MVP 必須，但建議加入。

---

# 50. 錯誤代碼

至少定義：

```text
INVALID_RELAY_TOKEN

METHOD_NOT_ALLOWED

HOST_NOT_ALLOWED

INVALID_URL

SSRF_BLOCKED

INVALID_HEADER

REQUEST_TOO_LARGE

RESPONSE_TOO_LARGE

DNS_LOOKUP_FAILED

TARGET_TIMEOUT

TARGET_CONNECTION_FAILED

INVALID_JSON

INTERNAL_ERROR
```

---

# 51. 安全檢查順序

Backend 收到 `/api/relay` 後建議按照：

```text
1. Authentication
      ↓
2. Payload Schema Validation
      ↓
3. Method Validation
      ↓
4. Parse URL
      ↓
5. Protocol Validation
      ↓
6. Host Allowlist
      ↓
7. DNS Resolution
      ↓
8. SSRF Validation
      ↓
9. Header Filtering
      ↓
10. Body Size Validation
      ↓
11. Send HTTP Request
      ↓
12. Response Size Validation
      ↓
13. Return Response
```

---

# 52. Protocol

MVP 只允許：

```text
http:
https:
```

建議 Production 預設：

```text
https:
```

如果有特殊用途才開：

```env
ALLOW_HTTP=true
```

禁止：

```text
file:
ftp:
gopher:
data:
javascript:
ws:
wss:
```

等其他 Protocol。

---

# 53. Non-goals

MVP 明確不做：

- 資料庫
- User Account
- Admin Panel
- OAuth
- OTP
- Cloudflare Access Authentication
- JWT
- Refresh Token
- Server Session
- API Preset
- Secret Vault
- Request History UI
- Team Management
- Billing
- Complex Permission System
- Webhook Scheduler
- Cron
- File Storage

避免產品過早膨脹。

---

# 54. 未來可以增加但目前不需要

未來視需求加入：

## Preset

例如：

```text
TalkAI Publish
Soft4Fun Publish
Start n8n Workflow
```

Agent 只填必要欄位。

---

## Secret Variable

例如：

```text
{{N8N_API_KEY}}
```

由 Relay Server 展開。

---

## 多 Agent Token

不同 Agent 使用不同 Token。

---

## Per-Agent Allowlist

例如：

```text
news-agent
→ flow.handbro.pro

research-agent
→ api.example.com
```

---

## Request History

可以改用 SQLite，而不一定需要完整 Database Server。

---

# 55. MVP 安全模型

Relay 的安全模型為：

```text
Secret Relay URL
      +
256-bit Token
      +
Domain Allowlist
      +
SSRF Protection
      +
Header Filtering
      +
Payload Limit
      +
Timeout
      +
Rate Limit
```

Token 解決：

```text
誰可以呼叫 Relay
```

Domain Allowlist 與 SSRF Protection 解決：

```text
Relay 可以呼叫哪些地方
```

兩者不可互相替代。

---

# 56. 最終架構

```text
┌───────────────────────────────────┐
│ AI Agent                          │
│                                   │
│ Browser only                      │
└───────────────┬───────────────────┘
                │
                │
                ▼
https://relay.example.com/#token=SECRET
                │
                ▼
┌───────────────────────────────────┐
│ Relay Page                        │
│                                   │
│ Method                            │
│ URL                               │
│ Query                             │
│ Headers                           │
│ Body                              │
│                                   │
│ SEND REQUEST                      │
└───────────────┬───────────────────┘
                │
                │ Authorization Bearer
                ▼
┌───────────────────────────────────┐
│ Relay Backend                     │
│                                   │
│ Token Check                       │
│ Method Check                      │
│ URL Check                         │
│ Domain Allowlist                  │
│ DNS Check                         │
│ SSRF Protection                   │
│ Header Filter                     │
│ Size Limit                        │
│ Timeout                           │
└───────────────┬───────────────────┘
                │
                ▼
┌───────────────────────────────────┐
│ Target API / Webhook              │
└───────────────┬───────────────────┘
                │
                ▼
┌───────────────────────────────────┐
│ HTTP Response                     │
│                                   │
│ STATUS                            │
│ HTTP_STATUS                       │
│ RESPONSE_HEADERS                  │
│ RESPONSE_BODY                     │
└───────────────────────────────────┘
```

---

# 57. 建議技術實作

為了降低複雜度，推薦：

```text
Node.js
TypeScript
Express 或 Fastify
原生 fetch / undici
Vanilla HTML / JavaScript
Docker
```

Frontend 不需要 React、Next.js 或其他大型 Framework。

理由是這個系統：

- 頁面只有一個
- 沒有複雜 State
- 沒有 SEO 需求
- 沒有 Account
- 沒有 Dashboard
- 沒有 Database

使用大型 Frontend Framework 反而會增加：

- Dependency
- Bundle Size
- Attack Surface
- 維護成本

---

# 58. 建議專案結構

```text
agent-http-relay/
│
├─ src/
│  ├─ server.ts
│  ├─ relay.ts
│  ├─ auth.ts
│  ├─ security.ts
│  ├─ ssrf.ts
│  └─ config.ts
│
├─ public/
│  ├─ index.html
│  ├─ app.js
│  └─ style.css
│
├─ tests/
│  ├─ auth.test.ts
│  ├─ ssrf.test.ts
│  ├─ headers.test.ts
│  └─ relay.test.ts
│
├─ Dockerfile
├─ docker-compose.yml
├─ .env.example
├─ package.json
├─ tsconfig.json
└─ README.md
```

---

# 59. SSRF 測試要求

至少測試：

```text
http://127.0.0.1

http://localhost

http://10.0.0.1

http://172.16.0.1

http://192.168.1.1

http://169.254.169.254

http://[::1]
```

全部必須被拒絕。

---

# 60. Allowlist 測試

如果：

```env
ALLOWED_HOSTS=example.com
```

允許：

```text
https://example.com/api
```

如果未明確支援 Subdomain，則：

```text
https://api.example.com/
```

預設拒絕。

一定拒絕：

```text
https://example.com.attacker.com/
```

---

# 61. Redirect 測試

Target：

```text
https://allowed.example.com/
```

如果回：

```text
302
Location: http://127.0.0.1/
```

Relay 不得 follow。

---

# 62. Header 測試

以下 Request：

```text
Host: internal.service
```

必須：

```text
INVALID_HEADER
```

以下應允許：

```text
Authorization: Bearer xxx
X-API-Key: xxx
Content-Type: application/json
```

---

# 63. Token 測試

錯誤 Token：

```text
HTTP 401
```

正確 Token：

```text
Request 繼續
```

Token 不得出現在：

```text
Response
Application Log
Error Stack
```

---

# 64. 驗收標準

MVP 完成需滿足：

- [ ] Agent 可以透過 URL Fragment 帶入 Relay Token
- [ ] URL Token 載入後自動從網址列移除
- [ ] Token 暫存於 sessionStorage
- [ ] Relay API 使用 Bearer Token 驗證
- [ ] Token 來源為 `.env`
- [ ] 不使用資料庫
- [ ] 支援 GET
- [ ] 支援 POST
- [ ] 支援 PUT
- [ ] 支援 PATCH
- [ ] 支援 DELETE
- [ ] 支援 Query Parameters
- [ ] 支援 Custom Headers
- [ ] 支援 JSON Body
- [ ] 支援 Raw Body
- [ ] 支援 Form URL Encoded
- [ ] 支援 Domain Allowlist
- [ ] 阻擋 Private IP
- [ ] 阻擋 Loopback
- [ ] 阻擋 Link-local
- [ ] 阻擋 Cloud Metadata IP
- [ ] 禁止危險 HTTP Header
- [ ] Redirect 預設不 Follow
- [ ] 有 Request Size Limit
- [ ] 有 Response Size Limit
- [ ] 有 Request Timeout
- [ ] HTTP Response 可被 AI Agent 清楚判讀
- [ ] 不在 Log 中輸出 Secret
- [ ] 可透過 Docker 部署
- [ ] 所有設定均可由 `.env` 控制

---

# 65. MVP 核心原則

整個專案應維持：

```text
No Database
No Login
No OAuth
No OTP
No Session Server
No Admin Panel
No unnecessary framework
```

核心只有：

```text
Secret Token
+
HTTP Relay
+
SSRF Protection
+
Allowlist
```

設計目標不是打造另一個 Postman。

設計目標是：

> 提供一個足夠簡單、穩定、安全，讓只有瀏覽器操作能力的 AI Agent 也能自主發送 HTTP Request 的橋接工具。