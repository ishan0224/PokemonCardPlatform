# PullVault — Architectural Design

## System at a glance

Monolithic Next.js 14 App Router application with a co-located Socket.io server, running as a single Node process on Railway. PostgreSQL (Supabase) is the single source of truth; Redis (Upstash) is a cache and pub/sub relay. Background jobs (price poller/worker, auction closer, drop scheduler, drop-lottery closer, fairness auditor, auto-rebalance coordinator) live in the same process behind feature flags. Financial math uses `decimal.js` at the application layer; all money is stored as `BIGINT` cents in Postgres. Code is organised into a service layer (`src/server/services/*`) that owns domain logic, consumed by API routes and by the socket layer over Redis pub/sub. The provably-fair pack layer lives in `src/lib/fairness/` (pure, runs identically in Node and browser) plus `src/server/services/fairness.service.ts` (seed encrypt/decrypt + nonce allocation).

### Architecture diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Client (Next.js 14 App Router)                         │
│   React · Tailwind · SWR · Socket.io client · Web Crypto fairness verifier   │
└─────────┬────────────────────────────────────────────┬──────────────────────┘
          │ HTTPS / REST                               │ WSS (Socket.io)
          ▼                                            ▼
┌────────────────────────────┐         ┌──────────────────────────────────────┐
│  Next.js API Routes        │         │  Custom Express + Socket.io          │
│  (src/app/api/**)          │         │  (server.ts, Redis adapter ready)    │
│  + global rate-limit mw    │         │  Rooms: drop, auction, portfolio,    │
│  (feature-flagged)         │         │    marketplace, auctions, admin      │
└─────────────┬──────────────┘         └───────────────┬──────────────────────┘
              │                                        │
              ▼                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       Service Layer (src/server/services/)                   │
│                                                                              │
│   Domain                      Part B integrity              Algorithms       │
│   ─────────                   ─────────────────             ──────────────   │
│   DropService                 FairnessService               WeightSolver     │
│   PackService                 FairnessAuditService          DriftDetector    │
│   CardService                 AuctionFlagService            AutoRebalance    │
│   TradeService                AuctionWashTradeService         Coordinator    │
│   AuctionService              AuctionSnipeMetricsService    HMAC draw engine │
│   BalanceService              MarginAlertService            (test vector)    │
│   CollectionService           DropLotteryService            Phase0 Bootstrap │
│   PriceService                SecurityEventService            Solver         │
│   EconomicsService                                                           │
└──────┬────────────────────────────┬──────────────────────────┬──────────────┘
       │                            │                          │
       ▼                            ▼                          ▼
┌─────────────────────────┐   ┌────────────────────────────┐   ┌────────────────┐
│ PostgreSQL (Supabase)   │   │ Redis (Upstash)            │   │ External APIs  │
│                         │   │                            │   │                │
│ Authoritative state     │   │ Cache · Pub/Sub            │   │ Pokemon TCG    │
│ + append-only audit     │   │ Sliding-window ZSET        │   │   API          │
│                         │   │ Lottery Lua (atomic EVAL)  │   │ Supabase Auth  │
│ users drops packs       │   │                            │   │                │
│ cards listings auctions │   │ Channels:                  │   └────────────────┘
│ bids balance_holds      │   │   price_updates            │
│ transactions            │   │   auction_events           │
│ platform_revenue        │   │   marketplace_events       │
│                         │   │   balance_events           │
│ pack_generation_        │   │   admin_metrics_delta      │
│   versions              │   │                            │
│ server_seeds            │   │ Keys:                      │
│ server_seed_nonce_      │   │   price:{id}               │
│   counters              │   │   drop:{id}:{tier}:rem     │
│ pack_commitments        │   │   drop:{id}:lottery (ZSET) │
│ fairness_audit_results  │   │   rl:{scope}:{key} (ZSET)  │
│ security_events         │   │   econ:alert:dedup:{...}   │
│ auction_flags           │   │                            │
└─────────────────────────┘   └────────────────────────────┘
       ▲
       │  Write order: Postgres commit → Redis cache mirror → Socket.io fanout
       │
┌──────┴──────────────────────────────────────────────────────────────────────┐
│                  Background Jobs  (same Node process, server.ts)             │
│                                                                              │
│  Price Scheduler + Price Worker     due-card polling, coalesced emits,       │
│                                     triggers AutoRebalanceCoordinator on     │
│                                     drift > 500 bps (debounced 120 s,        │
│                                     30 min cooldown).                        │
│  Drop Scheduler                     activates drops, pins generation         │
│                                     version, reveals server seeds on        │
│                                     drop completion.                         │
│  Drop Lottery Closer                at activated_at + 10.5 s sets           │
│                                     lottery_closed = 1, computes cohort.    │
│  Auction Closer                     FOR UPDATE SKIP LOCKED scan, atomic    │
│                                     settlement + balance-hold capture.     │
│  Fairness Auditor                   nightly 7d window, χ² goodness-of-fit  │
│                                     + Monte Carlo bootstrap for sparse     │
│                                     buckets, writes fairness_audit_results.│
└─────────────────────────────────────────────────────────────────────────────┘
```

**Trust boundary.** The client independently verifies every pack in the browser using Web Crypto HMAC-SHA256 against the canonical algorithm in `src/lib/fairness/spec.md`, with no server round-trip beyond fetching the already-revealed seed. The server cannot forge a valid proof without finding a SHA-256 pre-image.

---

## 1. How does the pack drop handle concurrent purchases?

Four defenses stacked, authoritative state in Postgres.

1. **Redis advisory fast-fail.** Before the transaction, check `drop:{id}:{tier}:remaining`. If 0, return `SOLD_OUT` immediately. Redis is a hint — never a reservation. Drift-safe because Postgres is the source of truth.
2. **Row-locked user balance.** `SELECT balance FROM users WHERE id = $ FOR UPDATE` serialises every financial flow for this user (pack buy, trade, bid). `available = balance − SUM(active balance_holds)` computed under the same lock.
3. **Atomic conditional inventory decrement** (`src/server/services/drop.service.ts:322-373`):

   ```sql
   UPDATE drop_packs
      SET remaining_inventory = remaining_inventory - 1
    WHERE id = $drop_pack_id
      AND remaining_inventory > 0
   RETURNING remaining_inventory
   ```

   Postgres row-level locking serialises concurrent writers; the `WHERE > 0` guard is what makes the decrement atomic. Zero rows returned → `SOLD_OUT`.
4. **DB check constraint as last defense.** `CHECK (remaining_inventory >= 0)` — any remaining path that tries to oversell is rejected at the storage layer.

All six steps — balance lock, tier-limit check, inventory decrement, balance debit, pack insert, deterministic card generation, revenue ledger — run in one `withTransaction`. Fairness artefacts (server-seed decrypt, nonce allocation, pack commitment, HMAC-SHA256 card generation) execute inside the same transaction. Any failure rolls back everything — no "money taken without pack."

**Waiting-room lottery (B2)** sits on top: the first 10 s after a drop goes active admit users via a Redis ZSET scored by `HMAC(SERVER_LOTTERY_KEY, drop_id ‖ user_id ‖ entry_id ‖ time_bucket_100ms)`. An atomic Lua script picks the cohort. Lottery is admission control only — the same Postgres decrement above is still the authoritative inventory gate.

**Tested:** `scripts/test-n1-concurrency-smoke.ts` races 4 users for 2 packs — asserts exactly 2 successes, 2 `SOLD_OUT`, inventory lands at 0.

---

## 2. How does the auction maintain consistency?

One lock order across bid and close flows: **`auctions → users → balance_holds`**. The bid path acquires the auction row first (`FOR UPDATE`), then the bidder's user row, then writes holds. The auction closer uses `FOR UPDATE SKIP LOCKED` so a bid in flight doesn't block closing — the closer simply skips and retries. Same-direction ordering guarantees no deadlock cycles.

A single SQL `UPDATE` writes the new bid AND the anti-snipe extension atomically (`src/server/services/auction.service.ts:946-961`):

```sql
UPDATE auctions
   SET current_bid = $2, current_bidder_id = $3,
       ends_at = CASE
         WHEN ends_at <= now() + make_interval(secs => 30)
           THEN now() + make_interval(secs => 30 + floor(random()*60)::int)
         ELSE ends_at
       END
 WHERE id = $1
 RETURNING ends_at
```

The randomised 30–90 s extension is computed in Postgres, not in the app, so the decision is atomic with the bid commit. The `ends_at` returned is the value broadcast over the `auction:{id}` Socket.io room.

Balance holds use a partial unique index `balance_holds(auction_id) WHERE status='active'`, guaranteeing one live hold per auction. On outbid: the old hold flips to `released`, the new one is inserted — if both somehow became active, the index rejects the insert and the transaction fails. Belt and suspenders.

**Part B3 hardening** layered on top without changing the state machine: a final-window confirm gate (bids in the last 10% of duration require `confirmFinalWindowBid=true` plus a 1/10s rate limit), fat-finger band `max(currentBid×5, marketValue×3, $10)` with a hard ceiling of 2× that, self-bid and already-highest-bidder rejection, and three read-only wash-trade heuristics (repeat buyer/seller pair, lone-bidder below 40% of market, rapid flip within 24 h) that surface flags for admin review instead of auto-cancelling.

---

## 3. Caching strategy

Rules:
- **Postgres is written first; Redis is updated after commit.** If Redis write fails, the cache is stale but the system is correct — the next read misses and repopulates.
- **Redis is a hint, not authority.** Every path has a Postgres fallback.
- **State-transition-driven cache sync, not tick-based rewrites.**

| Domain | Key | TTL | Update trigger |
|---|---|---|---|
| Card prices | `price:{pokemon_card_id}` | 600 s | After price-worker commit → set cache → Redis pub/sub → WebSocket emit |
| Drop inventory | `drop:{id}:{tier}:remaining` | none | On purchase commit, drop activation, drop completion (`SET` to DB-confirmed value, never `DECR`) |
| Rate limiter state | `rl:{key}` (sorted set) | per window | Atomic `MULTI` (ZREMRANGEBYSCORE + ZADD + ZCARD + PEXPIRE) — sliding-window log |
| Lottery entries | `drop:{id}:lottery` | until close | Atomic Lua `EVAL` scores entries, picks cohort |
| Socket.io adapter | internal | — | Redis adapter for cross-instance fanout (single instance today; multi-instance ready) |

**WebSocket push pipeline.** Price worker commits → writes Redis → publishes to `price_updates` channel → socket server fans out to `portfolio:{user_id}` rooms, filtered to cards the user owns, coalesced in a 2-second window. Auctions-list fanout (`auctions` room) uses the same coalescer pattern behind `AUCTIONS_LIST_COALESCING_ENABLED`. Bid-critical detail events (`new_bid`, `time_extended`, `auction_ended`) are never coalesced.

---

## 4. What breaks first at 10 000 users?

Ranked by order of failure, each with its mitigation in place or flagged.

1. **Pack drop thundering herd on the last row.** `N` users racing the last `M` packs queue on one `drop_packs` row's `FOR UPDATE` lock. *Mitigation shipped:* Redis fast-fail drops `N−M` late arrivals before they touch Postgres; the 10-s lottery flattens the critical window; atomic conditional `UPDATE … WHERE remaining > 0` keeps correctness even if `N` is enormous.
2. **WebSocket fan-out on hot auctions.** A popular auction with 10 000 watchers: every bid emits 10 000 frames. *Mitigation shipped:* Socket.io with Redis adapter; list-room coalescing with feature flag. *Next step at scale:* shard the socket service and route via broker.
3. **Postgres connection exhaustion.** 10 000 simultaneous requests exceed the pool. *Mitigation shipped:* Supabase pgBouncer transaction pooling fronts the DB; fast-fail drops the pack-drop hot path off the pool; blanket per-IP/per-user rate limit (`GLOBAL_API_RATE_LIMIT_*`) caps general-API pressure.
4. **Price-update storm.** Scheduler enqueues bursts when many `next_price_refresh_at` timestamps align. *Mitigation shipped:* durable Postgres job queue with `FOR UPDATE SKIP LOCKED`, 50-card chunks, per-liquidity-tier cadences, 2 s WebSocket coalescer, delta-only emits.
5. **Auction closer backlog.** 1 000 auctions ending in the same 5 s window. *Mitigation shipped:* closer uses `SKIP LOCKED` to parallelise and never blocks on active bids; each resolution is independent. *Next step at scale:* move to dedicated worker consuming a Redis sorted set keyed on `ends_at`.
6. **Fairness auditor cost.** 100 k Monte Carlo on every audit would time out a Next.js route. *Mitigation shipped:* nightly job writes `fairness_audit_results`; on-demand route reads the latest row and runs a fast 10 k MC sanity check only.

Nothing on this list invalidates correctness — all failure modes are latency or availability, never double-spend / oversell / tampered packs.

---

## 5. Pack EV math and parameter choices

The solver is a two-stage bounded optimisation (`src/server/economics/weight-solver.ts`). Per tier `t` with pack price `P_t` and slot set `S_t`:

- For slot `s`, let `w_{s,r}` = probability of rarity `r`; `μ_r` = mean price of eligible cards in rarity `r` sampled from the pinned pool.
- `EV_slot(s) = Σ_r (w_{s,r} · μ_r)`; `EV_t = Σ_{s ∈ S_t} EV_slot(s)`; `edge_t = 1 − EV_t / P_t`.

**Stage 1 (feasibility):** clamp weights into `[floor, cap]` bounds per rarity per tier, redistribute residual mass so each slot sums to 1. Emits explicit failure codes (`EMPTY_RARITY_POOL`, `EMPTY_SLOT_AFTER_FILTER`, etc.) if unsatisfiable.
**Stage 2 (optimisation):** greedy weight moves from high-μ to low-μ rarities (step 0.005) until `currentEv ≤ targetEv` or no feasible move remains.
**Monte Carlo (10 000 rolls):** measures empirical `meanEV`, `stdDev`, `winRate`, `p10/p50/p90`. Rejects the solve if `winRate < floor`.

**Parameters chosen from the live catalog (`docs/business-designv2.md`)** — averaged current market prices per rarity tier:

| Rarity | μ (avg price) |
|---|---:|
| Common | $4.24 |
| Uncommon | $4.70 |
| Rare | $45.61 |
| Holo rare | $240.52 |
| Ultra rare | $165.04 |
| Chase | $63.55 |

The labels don't form a clean ladder (holo > ultra > chase in current data), so the production pack design avoids depending on the upper buckets for value:

| Tier | Price | Cards | Slots | EV | House edge |
|---|---:|---:|---|---:|---:|
| Standard | $24.99 | 3 | C · C · [U 90% / R 10%] | $17.27 | 30.9% |
| Premium | $89.99 | 4 | C · U · U · [R 90% / UR 10%] | $71.19 | 20.9% |
| Elite | $189.99 | 5 | C · U · R · R · [R 90% / UR 10%] | $157.71 | 17.0% |

Higher tiers intentionally have lower percentage edge but higher absolute margin per pack ($7.72 / $18.80 / $32.28). That's the commitment-reward curve: heavier buy, better odds to win, still positive expected margin.

**Why this set:** the win-rate floor plus the target edge pins a narrow feasible band. Pricing round commercial numbers ($24.99, $89.99, $189.99) lands within 2 % of the mathematically exact prices (`$23.65`, `$86.66`, `$186.82`). The feature slot never reaches chase — those cards are only accessible through trades/auctions, keeping the secondary market alive.

**Auto-rebalance (`src/server/economics/auto-rebalance-coordinator.ts`):** price-worker ticks sample drift. When weighted drift exceeds 500 bps, a 120 s debounce fires, a 30 min cooldown gates re-runs, and `rebalanceEconomics()` writes a new `pack_generation_versions` row. Existing drops keep their pinned version — only future activations pick up the new weights. So rebalancing is safe mid-flight: every pack ever sold remains reproducible from its pinned weights, seed, client seed, and nonce.
