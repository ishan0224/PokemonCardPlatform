# PullVault

A Pokémon card collectibles platform: buy mystery packs, rip them open, discover real market value, trade peer-to-peer, and compete in live auctions. Built as a work-trial submission combining Part A (core platform) and Part B (economics, anti-bot, auction integrity, provably-fair packs, operational health).

**Live deployment:** https://pokemoncardplatform-production.up.railway.app

---

## Admin access

A pre-provisioned admin account is available for evaluating admin surfaces (drop scheduler, economics dashboard, fairness audit, auction-flag review, what-if simulator, rebalance).

| Field | Value |
|---|---|
| **Email** | `admin@test.com` |
| **Password** | `12345678` |

Sign in at `/login`, then admin surfaces become available at:

- `/admin` — tool landing page
- `/admin/drops` — schedule new drops, configure tier inventory, publish
- `/admin/economics` — revenue, per-tier EV, margin alerts, what-if simulator, rebalance trigger
- `/admin/fairness` — nightly chi-squared audit, observed vs expected rarity distribution
- `/admin/auction-flags` — wash-trade heuristic review queue

Regular users can register via `/register` and start with a $250 balance.

---

## Quick start — local development

Requirements: **Node 20+**, a **PostgreSQL** instance (Supabase cloud or local), a **Redis** instance (Upstash or local), and an optional Pokemon TCG API key (the platform falls back to simulated prices if unavailable).

### 1. Clone and install

```bash
git clone https://github.com/ishan0224/PokemonCardPlatform.git
cd PokemonCardPlatform
npm install
```

### 2. Configure environment

Copy `.env.example` → `.env` and fill the required values. Minimum needed to boot:

```env
# Postgres
DATABASE_URL=postgresql://user:pass@host:5432/pullvault
DATABASE_SSL=true                  # set to false for local Postgres

# Redis
REDIS_URL=rediss://default:token@host:6379

# Supabase Auth (identity layer)
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...

# Fairness (server-seed encryption key — generate with: openssl rand -hex 32)
PACK_FAIRNESS_SECRET=64-hex-character-secret

# App
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

The full list of optional tuning flags (rate limits, auto-rebalance thresholds, alert webhook, economics windows, etc.) is documented inline in `.env.example`.

### 3. Initialise the database

Apply schema + Part B migrations:

```bash
psql "$DATABASE_URL" -f src/server/db/schema.sql
for f in src/server/db/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

### 4. Run

```bash
npm run dev
```

Opens on http://localhost:3000. Custom server boots Next.js + Socket.io + background jobs (price scheduler/worker, auction closer, drop scheduler, drop-lottery closer, fairness auditor) in one process.

---

## Architecture overview

PullVault is a **single Node process** deployed on Railway containing the Next.js frontend, the API layer, a Socket.io server, and every background worker. PostgreSQL (Supabase) is the single source of truth; Redis (Upstash) is a cache and pub/sub relay. This keeps the correctness story tractable for a trial while remaining horizontally splittable later.

### Layered architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client (Next.js 14 App Router)                         │
│   React · Tailwind · SWR · Socket.io client · Web Crypto fairness verifier   │
└─────────┬────────────────────────────────────────────┬──────────────────────┘
          │ HTTPS / REST                               │ WSS (Socket.io)
          ▼                                            ▼
┌────────────────────────────┐         ┌──────────────────────────────────────┐
│  Next.js API Routes        │         │  Custom Express + Socket.io          │
│  + global rate-limit mw    │         │  (server.ts, Redis adapter ready)    │
└─────────────┬──────────────┘         └───────────────┬──────────────────────┘
              │                                        │
              ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Service Layer (src/server/services/)                   │
│   Domain · Part B Integrity · Algorithms (weight solver, HMAC draw engine)   │
└──────┬────────────────────────────┬──────────────────────────┬──────────────┘
       │                            │                          │
       ▼                            ▼                          ▼
┌─────────────────────────┐   ┌────────────────────────────┐   ┌────────────────┐
│ PostgreSQL (Supabase)   │   │ Redis (Upstash)            │   │ External APIs  │
│ Authoritative + audit   │   │ Cache · Pub/Sub · ZSET     │   │ Pokemon TCG    │
└─────────────────────────┘   └────────────────────────────┘   │ Supabase Auth  │
       ▲                                                       └────────────────┘
       │  Write order: Postgres commit → Redis cache → Socket.io fanout
┌──────┴──────────────────────────────────────────────────────────────────────┐
│  Background jobs  (same Node process)                                        │
│  Price Scheduler/Worker · Drop Scheduler · Lottery Closer                    │
│  Auction Closer · Fairness Auditor · Auto-Rebalance Coordinator              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### The five things that matter most

1. **Pack drops handle concurrent purchases correctly.** Four stacked defences: Redis advisory fast-fail to drop late arrivals; `FOR UPDATE` on the user row to serialise that user's spending; an atomic conditional `UPDATE … WHERE remaining_inventory > 0` on `drop_packs`; a `CHECK (remaining_inventory >= 0)` constraint as last-resort storage-level defence. All of inventory + balance + pack insert + deterministic card generation + revenue ledger happens in one transaction. A 10-s waiting-room lottery (HMAC-scored Redis ZSET + atomic Lua cohort selection) sits on top for fairness — admission control only, never authority.
2. **Auctions maintain consistency under concurrent bids.** Unified lock order `auctions → users → balance_holds` across bid and close flows; auction closer uses `FOR UPDATE SKIP LOCKED`. The soft-close extension is a `CASE` expression inside the same UPDATE that writes the bid — never a second query. Partial unique index on `balance_holds(auction_id) WHERE status='active'` makes at-most-one-active-hold structural.
3. **Provably fair packs.** Commit-reveal: server seed created at drop activation, SHA-256 hash committed publicly, seed encrypted at rest with AES-256-GCM using a key derived from `PACK_FAIRNESS_SECRET`. Card generation is deterministic HMAC-SHA256 with rejection sampling to avoid modulo bias, using a single monotonic draw counter. Revealed at drop completion. Browser re-runs the exact same algorithm via Web Crypto — no server round-trip for verification. A canonical fixture committed in the repo proves Node and browser produce byte-identical output.
4. **Pack economics that the house wins.** A two-stage bounded solver (`src/server/economics/weight-solver.ts`) computes rarity weights per tier against live card prices, validated with 10 000-roll Monte Carlo. Target house edges: Standard 30.9 %, Premium 20.9 %, Elite 17.0 %. Version-pinned: every pack stamps its `generation_version_id` inside the purchase transaction, so rebalancing is safe mid-flight — existing packs reproduce forever from their pinned version. Auto-rebalance triggers on 500-bps price drift with 120 s debounce + 30 min cooldown.
5. **Observability and integrity.** Admin economics dashboard with real-time coalesced WebSocket delta stream; nightly chi-squared fairness audit with Monte Carlo bootstrap for sparse buckets; wash-trade heuristics that flag for human review (repeat pair, lone bidder below market, rapid flip); per-tier margin alerts with Redis-backed dedup and optional HMAC-signed webhook.

---

## Tech stack

| Layer | Technology | Why |
|---|---|---|
| Frontend | Next.js 14 App Router + React 18 + TypeScript | Required by spec; RSC for server-fetched hot paths (auction detail, drops list, home), SWR for client-managed caches |
| Styling | Tailwind CSS | Rapid iteration without leaving the component |
| Backend | Next.js API Routes + custom Express (server.ts) | Routes own per-endpoint logic; Express wraps for the custom Socket.io server and global rate-limit middleware |
| Database | PostgreSQL (Supabase) | Row-level locking, partial indexes, CHECK constraints — all the tools the concurrency story depends on |
| Cache / Pub-Sub | Redis (Upstash) | Sliding-window rate limiter, atomic lottery Lua, pub/sub relay for Socket.io fanout, inventory advisory cache |
| Real-time | Socket.io 4 with Redis adapter | Single-process today, horizontal-ready via the adapter |
| Financial math | decimal.js; `BIGINT` cents in Postgres | Floating-point is not acceptable for money — the decimal-cents combo makes rounding impossible at the storage layer |
| Cryptography | Node `crypto`, browser `crypto.subtle` | SHA-256, HMAC-SHA256, AES-256-GCM — no custom crypto |
| Card data | Pokemon TCG API ([pokemontcg.io](https://pokemontcg.io/)) | Free tier used, with local simulated fallback |
| Image optimisation | next/image for external CDN; pre-converted AVIF/WebP for static assets | Static `/public/images/*` pre-converted (Logo, card back, drop pack images, hero) to AVIF + WebP with `<picture>` fallback; Pokemon card art served through next/image's Sharp pipeline |
| Deploy | Railway | Single-process monolith; Postgres via Supabase pooler; Redis via Upstash |

---

## Project structure

```
PokemonCardPlatform/
├── src/
│   ├── app/                                 # Next.js App Router
│   │   ├── (app)/                           # Authenticated routes (home, drops, collection, auctions, admin, etc.)
│   │   ├── (auth)/                          # Login, register
│   │   ├── (legal)/                         # Public fairness verifier, legal pages
│   │   └── api/                             # REST API endpoints
│   ├── components/                          # React components grouped by domain
│   ├── hooks/                               # Client-side hooks (use-auth, use-socket, use-collection, use-pack-reveal, ...)
│   ├── lib/                                 # Client-safe utilities (api-client, format, socket-client, fairness spec)
│   └── server/                              # Server-only code
│       ├── services/                        # Service layer — DropService, PackService, CardService, TradeService, AuctionService, BalanceService, PriceService, EconomicsService, FairnessService, FairnessAuditService, AuctionFlagService, AuctionWashTradeService, AuctionSnipeMetricsService, MarginAlertService, DropLotteryService, SecurityEventService, ...
│       ├── economics/                       # Pure algorithm modules — weight-solver, rebalance, drift-detector, auto-rebalance-coordinator, phase0-bootstrap-solver
│       ├── jobs/                            # Background schedulers/workers — price-poller, price-worker, drop-scheduler, drop-lottery-closer, auction-closer, fairness-auditor
│       ├── websocket/                       # Socket.io server, coalescers, room handlers
│       ├── middleware/                      # Auth + rate limit
│       ├── redis/                           # Redis client + atomic Lua (claim_lottery.lua)
│       ├── db/                              # schema.sql, migrations, pool
│       └── config/                          # Constants (pack tiers, rarity anchors, target edges, rate limits, feature flags)
├── server.ts                                # Custom server entry (Express + Next + Socket.io + jobs)
├── next.config.mjs
├── tsconfig.json
└── package.json
```

---

## Scope cuts

Deliberate de-scopes, documented so a reviewer knows what was intentional.

| Area | What was cut | Why |
|---|---|---|
| B2 behavioural bot signals | Device fingerprinting, rapid-click clustering, IP-subnet correlation, multi-account linking | Requires false-positive tuning against real traffic. Continues to log every relevant event to `security_events` so a future classifier has the data it needs. Rate limiter, waiting-room lottery, per-user tier cap ship. |
| Portfolio performance over time | Time-series chart on the collection page | Would need a price-history table, hourly snapshot job, and a chart component. Current collection shows live spot value + absolute P&L per card. Explicit gap; queued as a follow-up. |
| Card detail drill-in | `/collection/[cardId]` page | Implemented post-audit — the detail page now ships with pack lineage, per-card transactions, "Go to auction room" deep link. |
| Mobile pack-reveal latency | Eager prefetch of all slot cards after `openPack` | Preload on revisit/refresh implemented; just-opened path still fetches per slot. Flavor B ("fire all reveals in parallel + skip on-click API") is designed but held. |
| Offer system on marketplace | Counter-offers, negotiation | Not in the core Part A P0 scope. Marketplace uses fixed-price listings. |
| Multiple concurrent auctions per card | One active auction per card | Unique partial index enforces it. A seller must close an auction before starting a new one. |
| Historical price charts per card | Sparkline on card detail | Cost/benefit didn't clear the bar for a trial. Current + previous price shown; trend arrow derivable. |
| External alerting (Slack, email) | Webhook-only margin alerts | HMAC-SHA256 signed webhook shipped. Slack/email connectors deferred. |
| Horizontal WebSocket scale | Multi-replica with Redis adapter active | Redis adapter is wired; scale-out is a flag flip. Running single-replica today. |
| Sealed-bid auction phase | Full hidden-bid endgame | Spec explicitly allowed it as an option; chose randomised soft-close + final-window confirm gate + fat-finger guards + wash-trade detection as the bid-integrity stack instead. Lower blast radius; no new state machine. |
| CI pg_dump-vs-schema drift check | Automated schema verification | A bug during the trial (the `'custom'` auction duration case) revealed that schema.sql and the live DB can drift silently. Fix queued; would have caught the bug at PR time. |

---

## Scripts reference

| Command | Purpose |
|---|---|
| `npm run dev` | Local dev server (Next + Socket.io + jobs) |
| `npm run build` | Production Next.js build |
| `npm run start` | Start production server |
| `npm run typecheck` | TS typecheck across app + server projects |

---

## Feature flags (environment)

All Part B features ship behind flags so they can be disabled instantly without a redeploy. Defaults in `src/server/config/constants.ts`.

| Flag | Default | Effect when off |
|---|---|---|
| `PRICE_SCHEDULER_ENABLED` / `PRICE_WORKER_ENABLED` | `true` | No price updates; prices stay at seeded values |
| `AUTO_REBALANCE_ENABLED` | `false` | Manual rebalance only, even on price drift |
| `GLOBAL_API_RATE_LIMIT_ENABLED` | `false` | Per-endpoint rate limits remain active; blanket `/api/*` limit is off |
| `FINAL_WINDOW_GATE_ENABLED` | `true` | Removes the confirm gate on last-10% bids |
| `ECONOMICS_ALERTS_ENABLED` | `true` | Margin-deviation alerts suppressed |
| `FAIRNESS_AUDITOR_ENABLED` | `true` | Nightly audit stops; existing rows remain visible |
| `DROP_LOTTERY_CLOSER_ENABLED` | `true` | Waiting-room lottery remains open — drops become pure FCFS |
| `ADMIN_METRICS_COALESCING_ENABLED` | `true` | Admin metrics room emits every event uncoalesced |

---

## License

Private work-trial submission. Not open source.
