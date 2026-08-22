# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

AI Agent HTTP Relay — lets an AI agent that can only drive a browser (no shell/curl access) send arbitrary HTTP
requests. The agent opens the Relay Page, fills a form, and the server sends the actual request on its behalf.
Deployable to Docker, Vercel (Node.js Serverless), or Cloudflare Workers from one codebase.

Reference docs: `requirement.md` (functional spec), `docs/superpowers/specs/2026-08-21-agent-http-relay-design.md`
(architecture design), `docs/agent-skill.md` (Agent Skill template), `README.md` (endpoints, deployment, env vars).

## Commands

```
npm run dev            # local dev server (tsx watch), needs RELAY_TOKEN set
npm run build           # tsc compile to dist/
npm start                # run compiled dist/adapters/node/server.js
npm test                  # core + node adapter tests (vitest)
npm run test:watch      # vitest watch mode
npm run test:workers   # Workers tests on real workerd (vitest.workers.config.ts)
npm run typecheck        # tsc -p tsconfig.typecheck.json
npm run dev:workers    # wrangler dev
npm run deploy:workers  # wrangler deploy
```

Run a single test file: `npx vitest run tests/relay.test.ts`. Run a single test by name: `npx vitest run -t "name"`.

`RELAY_TOKEN` must be set (≥32 chars) for the server/tests that touch config loading; see `.env.example`.

## Architecture

**Core/adapter split is the load-bearing constraint of this codebase.** `src/core/` is the entire relay logic
(auth, SSRF checks, rate limiting, request/response handling, Hono routes) and **must never import any `node:*`
module** — doing so breaks the Cloudflare Workers build. All IO is injected through three interfaces defined in
`src/core/relay.ts`: `DnsResolver`, `HttpClient`, `RateLimiter`. Each deployment target in `src/adapters/{node,vercel,workers}/`
supplies its own implementation of these and wires them into `createApp()` (`src/core/app.ts`).

- `src/adapters/node/` — `dnsResolver.ts` (`dns.promises.resolve4/6`) + `pinnedFetch.ts` (undici with a custom
  `lookup` that pins the connection to the already-validated IP). `server.ts` is the Docker/bare-metal entrypoint.
- `src/adapters/vercel/handler.ts` — reuses the Node adapter's resolver/HTTP client (Vercel functions run
  Node.js Serverless, not Edge, so full DNS pinning applies). Lazily builds the app on first request so importing
  the module doesn't throw before env vars are injected.
- `src/adapters/workers/` — `dohResolver.ts` (Cloudflare DoH JSON API instead of native DNS), `workersFetch.ts`
  (platform `fetch`, which **cannot** pin to a specific IP — see the SSRF caveat below), `rateLimitDO.ts` (Durable
  Object-backed rate limiter, exported as `RateLimitCounter`).

**Request pipeline** (`handleRelay` in `src/core/relay.ts`) runs 13 steps in a fixed, security-meaningful order —
e.g. rate limit and auth happen before any DNS lookup, host-allowlist checks happen before DNS resolution, and
every resolved IP (not just the first) is checked against `isPublicIp` before the request is sent. Don't reorder
these steps without understanding why the order was chosen (see the comment at the top of `handleRelay`).

**SSRF defense is two independent layers**: domain allowlist (`ALLOWED_HOSTS` / `ALLOW_ANY_PUBLIC_HOST`, checked
in `src/core/ssrf/hostAllowlist.ts`) and IP-range validation after DNS resolution (`src/core/ssrf/ipRules.ts`).
Neither substitutes for the other. On Docker/Vercel, the resolved IP is pinned for the actual connection
(no DNS-rebinding TOCTOU gap); on Workers, the platform `fetch` re-resolves DNS itself, so there's a best-effort
TOCTOU gap — this is a platform limitation, not a bug to "fix" in adapter code.

**Config** (`src/core/config.ts`) is a single zod schema parsing all env vars up front; `loadConfig` throws with a
field-name-only error message on invalid config — never let `RELAY_TOKEN`'s value leak into an error/log.

**Auth vs. allowlist**: `RELAY_TOKEN` (Bearer) controls *who* can call the relay; `ALLOWED_HOSTS`/SSRF controls
*where* the relay can call. Both are required; the README explicitly calls out that one is not a substitute for
the other.

Public routes: `GET /`, `GET /test.html`, `GET /health`, `ALL /api/echo`. Bearer-token-only route: `POST /api/relay`.

## Testing conventions

Tests mirror `src/` under `tests/` (e.g. `tests/relay.test.ts` for `src/core/relay.ts`, `tests/node/`, `tests/vercel/`,
`tests/workers/`). Adapter-specific behavior (DNS pinning, DoH resolution, Vercel handler wiring, static mounting)
gets its own test file per adapter rather than being folded into the core suite. `test:workers` uses
`@cloudflare/vitest-pool-workers` to run against real `workerd`, separate from the default vitest config — use it
when touching anything under `src/adapters/workers/`.
