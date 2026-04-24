# Architecture Document — Part B Addendum

Deep dive into the three Part B algorithms and the parameters chosen for each. Complements the main architecture document's five-question summary.

---

## 1. Pack Economics Algorithm

### 1.1 The math contract

For a tier `t` with pack price `P_t` and slot set `S_t`:

- For each slot `s` ∈ `S_t`, let `w_{s,r}` be the probability of rarity bucket `r` in that slot, with `Σ_r w_{s,r} = 1`.
- Let `μ_r` be the mean current market price of eligible cards in rarity `r`, filtered to the pinned catalog for this tier.
- **Slot expected value:** `EV_slot(s) = Σ_r (w_{s,r} × μ_r)`.
- **Tier expected value:** `EV_t = Σ_{s ∈ S_t} EV_slot(s)`.
- **Expected house edge:** `edge_t = 1 − (EV_t / P_t)`.

The solver's job is to find `{w_{s,r}}` that satisfy three constraints simultaneously:

1. `edge_t ≥ target_edge_t` (house stays profitable on this tier);
2. empirical `win_rate_t ≥ win_rate_floor_t`, measured via Monte Carlo (user wins often enough to stay engaged);
3. every weight stays in its bounds `[w_min_r, w_max_r]` (no degenerate "99% commons" or "50% chase").

### 1.2 Two-stage solver

**Stage 1 — feasibility.** Clamp every existing weight into its `[floor, cap]` bounds, redistribute residual probability mass greedily so each slot sums to 1. Emits an explicit typed failure on impossibility: `EMPTY_RARITY_POOL` (a rarity referenced by the slot has no eligible cards), `EMPTY_SLOT_AFTER_FILTER` (feature-slot outlier filter removed every candidate), `INFEASIBLE_WITHIN_BOUNDS` (the mean-EV achievable under bounds cannot reach target).

**Stage 2 — optimisation.** Greedy move-picking: each iteration finds the (slot, from-rarity, to-rarity) triple that shifts tier EV toward the target by one `optimization_step` without violating bounds; repeat until `currentEv ≤ targetEv` or no feasible move remains. Capped at 20 000 iterations.

**Monte Carlo validation (10 000 rolls).** After the optimisation terminates, simulate 10 000 packs with the solved weights. Record `meanEV`, `stdDev`, `winRate`, `p10/p50/p90`. Reject the solve if `winRate < floor` — the solver then re-enters Stage 1 with tighter bounds, or returns `INFEASIBLE_WITHIN_BOUNDS` for that tier.

### 1.3 Version pinning (the safety-at-scale invariant)

Every `pack_generation_versions` row is immutable. Rebalance inserts a new row — it never mutates an existing one. A pack stamps its `generation_version_id` inside the purchase transaction, tying that pack's outcome forever to weights that existed at purchase time. Drops stamp an `active_generation_version_id` at activation.

Consequences:

- Any pack ever sold remains reproducible from `(seed, clientSeed, nonce, generation_version_id)` — the fairness verifier works against historical packs even if weights have since changed three times.
- A rebalance can never affect an active drop's pricing. It only takes effect at the next drop activation.
- Manual and auto-rebalance share the same invariant — guaranteed by reusing the same `rebalanceEconomics()` function.

### 1.4 Auto-rebalance coordinator

After every successful price-worker job commit, the coordinator samples up to 500 eligible cards, computes a weighted drift in bps vs the pinned anchor snapshot, and decides:

- **`drift_below_threshold`** → skip (drift < 500 bps).
- **`cooldown`** → skip (< 30 min since last successful rebalance).
- **otherwise** → start a 120 s debounce timer; when it fires, call `rebalanceEconomics({ lockMode: 'try' })` non-blocking.
- **`lock_contended`** → skip; manual rebalance wins.

All decisions emit typed `security_events` (`auto_rebalance_skipped{reason}` / `auto_rebalance_triggered`) for operational auditability.

### 1.5 Parameter choices

| Parameter | Value | Why this value |
|---|---|---|
| Target house edge (Standard) | **3090 bps** (30.9%) | Entry tier — absorbs the worst variance; generous commercial margin, derived against live catalog prices. |
| Target house edge (Premium) | **2089 bps** (20.9%) | Mid-tier — commitment reward. Lower % edge than Standard but higher absolute margin per pack. |
| Target house edge (Elite) | **1699 bps** (17.0%) | Top tier — pricing has to feel worth the 7× Standard cost; lowest percentage edge, highest absolute margin. |
| Monte Carlo samples | **10 000** | Part B1 spec mandate. Converges `meanEV` to within ~0.5% of analytical at this sample size. |
| Optimisation step | **0.005** (0.5% weight move per iteration) | Small enough to land on target within rounding; large enough to terminate in under 100 iterations for typical pools. |
| Optimisation max iterations | **20 000** | Hard cap against degenerate pool shapes. Normal runs terminate in under 200. |
| `rarityFloorByTier.common` | **0.02** | Prevents "99% chase" degenerate even if solver thinks it's optimal. Keeps sufficient filler so the common/uncommon slots always have something to draw from. |
| `rarityFloorByTier.uncommon` | **0.01** | Same rationale, weaker floor — uncommon is already rarely a feature-slot target. |
| `rarityCapByTier.ultra_rare` | **0.35** | Max 35% of a slot can be ultra_rare. Protects house edge against hot-pool ultra pricing. |
| `rarityCapByTier.chase` | **0.20** | Even tighter cap for chase; chase cards are asymmetrically expensive and drag house edge fast. |
| `featureOutlierPriceMultiplier` | **1.5** | Feature slots drop any card whose `current_price > P_t × 1.5`. Excludes pathological outliers (e.g., a $400 card in a $90 pack's rare slot) from the solver's EV calc. |
| Auto-rebalance drift threshold | **500 bps** | 5% weighted price movement. Below that, volatility is noise; above that, the pinned anchors are stale. |
| Auto-rebalance debounce | **120 s** | Time window for drift to stabilise before a rebalance fires. Prevents thrashing on a spike-and-recover. |
| Auto-rebalance cooldown | **30 min** | Minimum between two successful rebalances. Caps rebalance frequency at 48/day worst case. |
| Drift sample max cards | **500** | Hard cap on sampling cost per check. At 500 samples per tier, the drift estimate's standard error is <0.5% at typical catalog sizes. |

### 1.6 Simulation endpoint

`POST /api/admin/economics/simulate` runs the full solver + 10 000 MC rolls for all three tiers and returns per-tier distribution (`meanEV`, `stdDev`, `winRate`, `p10/p50/p90`), `achievedHouseEdgeBps`, and projected-margin-over-1000-packs. Used by the admin what-if simulator to preview parameter changes without committing a new generation version.

---

## 2. Rate Limiting Strategy

### 2.1 Four composable layers

Each layer protects a different failure mode. They compose without coordination — first rejection wins.

| Layer | Scope | Backend |
|---|---|---|
| **Per-endpoint, per-user / per-IP** | Specific hot paths (pack purchase, bid, listing buy) | Redis sliding-window log |
| **Global blanket** (feature-flagged) | Every `/api/*` route | Redis sliding-window log |
| **Waiting-room lottery** | First 10 s of a drop | Redis ZSET + Lua |
| **Per-user per-tier cap** | One user's aggregate packs in a drop | Postgres query inside purchase tx |

### 2.2 Sliding-window log (not fixed window, not token bucket)

Implemented in `redis/client.ts :: slidingWindowRateLimit`:

```
MULTI
  ZREMRANGEBYSCORE key 0 (now - windowMs)
  ZADD key now "now:rand"
  ZCARD key
  PEXPIRE key windowMs
  ZRANGE key 0 0 WITHSCORES
EXEC
```

Single atomic transaction — two concurrent callers can never disagree on `currentCount`. `resetMs` computed from the oldest remaining request's score, so the client gets an accurate `Retry-After`.

### 2.3 Waiting-room lottery

For the first 10 s of a drop being active, requests are admitted via a Redis ZSET scored by

```
HMAC-SHA256(
  SERVER_LOTTERY_KEY,
  drop_id ‖ user_id ‖ entry_id ‖ floor(now_ms / 100)
)
```

Keys of the design:

- **Per-user uniqueness.** The `user_id` in the HMAC input means each user's score distribution is independent. Bots can't spam to improve odds — retries with the same `entry_id` yield the same score (ZADD NX preserves the original).
- **100 ms time buckets.** A bot that retries within the same 100 ms window gets an identical score. Eliminates the millisecond-precision advantage.
- **Atomic cohort selection** (`claim_lottery.lua`). Single `EVAL`: ZADD entry → if closed, ZRANGEBYSCORE top `cohort_size` → check membership → return winner/loser.
- **Admission only.** Winning the lottery gives a short-lived priority, not a reservation. Inventory is still decremented authoritatively by the Postgres transaction — over-admission is safe because Postgres gates the final write.
- **Cohort sizing.** `remaining_inventory + min(5, 0.2 × remaining_inventory)` — a small buffer for losers-who-claim-and-time-out. Postgres will reject the late ones.

### 2.4 Failure-mode rule

If Redis is unavailable:

- Per-endpoint rate limits fail **open** (requests continue). `security_events` logs a `rate_limit_unavailable`.
- Global rate limit fails **open** (requests continue).
- Lottery fails **open** (route degrades to FCFS; `security_events` logs `lottery_unavailable`).

This is deliberate: inventory correctness is enforced by Postgres. Losing Redis reduces fairness, never correctness. The system never oversells just because Redis dropped.

### 2.5 Parameter choices

| Parameter | Value | Why |
|---|---|---|
| `RATE_LIMITS.packPurchasePerUser` | **5 req / 10 s** | Human click patterns stay well under this. Bots that DDoS a single user slot immediately trip. |
| `RATE_LIMITS.packPurchasePerIp` | **5 req / 10 s** | IP-level cap stops shared-IP botnets. Applied in parallel with per-user (both must pass). |
| `RATE_LIMITS.placeBid` | **10 req / 10 s** per user | Bidding is an engagement-heavy action; 10 bids / 10 s absorbs an excited human without letting bots micro-bid. |
| `RATE_LIMITS.placeBidPerAuctionPerUser` | **3 req / 10 s** | On a specific auction, stops rapid-fire bid-incrementing — especially in the final window. |
| `RATE_LIMITS.buyListing` | **5 req / 10 s** | Parity with pack purchase; same human click pattern applies. |
| `PER_USER_TIER_LIMIT_PER_DROP` | **2 packs** | Prevents one user (or their alts) from clearing a tier's inventory in a single drop. Intentionally low — would be higher in production, trial-conservative here. |
| `GLOBAL_API_RATE_LIMIT_PER_IP` | **300 req / 60 s** | Default off; when on, absorbs a single browser session's realistic peak (multiple users behind a shared NAT). |
| `GLOBAL_API_RATE_LIMIT_PER_USER` | **600 req / 60 s** | Roughly 2× the per-IP cap — authenticated users typically make more ambient calls (SWR revalidation, socket refreshes). |
| `GLOBAL_API_RATE_LIMIT_EXEMPT_PATHS` | `/api/auth/refresh`, `/socket.io` | Refresh must never be throttled (would deadlock the session); socket handshake runs its own pacing. |
| Lottery window | **10 s** after activation | Flattens the fastest-client advantage for a human-perceivable window without making the drop feel slow. |
| Lottery time bucket | **100 ms** | Bots can't meaningfully race this — within a single bucket, identical score is produced. |
| Lottery cohort buffer | **min(5, 20% of remaining)** | Small over-admission absorbs timeouts without bloating the race. |

---

## 3. Provably Fair Scheme

### 3.1 Scheme shape

Standard commit-reveal with a twist for key safety:

- **Commit time (drop activation):** server generates `raw_seed = randomBytes(32)`; publishes `seed_hash = SHA-256(raw_seed)` as the public commitment; encrypts `raw_seed` with AES-256-GCM using a key derived from env secret `PACK_FAIRNESS_SECRET`; stores `(seed_hash, ciphertext, iv, auth_tag)` in `server_seeds`.
- **Purchase time (per pack):** under a row lock on the active `server_seeds` row, allocate a monotonic `nonce` from `server_seed_nonce_counters`, generate a random `client_seed = randomBytes(16).hex()`, insert into `pack_commitments`, decrypt the server seed in memory, run deterministic card generation, insert cards.
- **Reveal time (drop completion):** `server_seeds.revealed_at = now()`. Ciphertext stays; reveal only authorises the API to return plaintext.
- **Verify time (browser):** fetch `(generation_version, commitment, revealed_seed_value, cards)`; SHA-256(revealed) must equal committed hash; re-run the deterministic HMAC algorithm locally; compare generated cards to stored cards.

### 3.2 Deterministic draw algorithm

For each slot:

1. **Rarity draw.** Let `N` = number of rarity buckets in this slot's distribution. Compute `digest = HMAC-SHA256(serverSeed, clientSeed || nonce_LE || drawCounter_LE)` as a 32-byte value. Interpret as a big-endian uint256. If `digest < floor(2^256 / N) * N`, accept — `rarity_index = digest mod N`. Otherwise, increment `drawCounter` and retry (rejection sampling to avoid modulo bias).
2. **Card draw.** Same HMAC construction with the current `drawCounter`, modulus `M = |eligible_card_ids_for_rarity|`. Accept or reject with the same rejection-sampling rule.
3. `drawCounter` increments on every draw — accepted or rejected — giving an unambiguous transcript of the entire pack generation.
4. If 256 consecutive rejections occur, throw `RNG_EXHAUSTED` — theoretically bounded but astronomically unlikely with valid `N`, `M`.

### 3.3 Byte-level Node ↔ browser parity

The algorithm lives in `src/lib/fairness/hmac-draws.ts`, a pure function injected with an `hmacSha256(key, message)` implementation — Node uses `crypto.createHmac`, browser uses `crypto.subtle.sign("HMAC", ...)`. The canonical encoding is bytes-only:

- `serverSeedBytes` (32 bytes) as the HMAC key.
- `clientSeedBytes (16) ‖ nonce as uint64 little-endian (8) ‖ drawCounter as uint64 little-endian (8)` as the HMAC message. Exactly 32 bytes.
- Digest interpreted as big-endian uint256.

**The canonical test vector** is committed as the first deliverable . A fixture with known inputs and expected per-slot outputs runs identically in Node and JSDOM and a real headless browser before any downstream code compiles. This is what makes cross-runtime parity a contract rather than an aspiration.

### 3.4 Why AES-256-GCM for seed storage

- **Confidentiality.** A Postgres dump alone does not reveal seeds — the AES key is in `PACK_FAIRNESS_SECRET` env, not the DB.
- **Authenticity.** GCM's auth tag detects tampering. Silently editing `seed_value_ciphertext` in the DB will fail `decipher.final()`, which the API returns as `SEED_DECRYPTION_FAILED`.
- **Post-decryption hash check.** Even if tampering passed AES-GCM (it can't, but defense-in-depth), SHA-256 of the decrypted seed must match `seed_hash`. If any attacker rotates both ciphertext and seed_hash together, the pre-existing commitment (which a user could have recorded at drop time) stops matching — tamper detectable by anyone.

### 3.5 Nonce allocation

The nonce counter lives in its own per-seed row in `server_seed_nonce_counters`. Purchase transaction does:

```sql
SELECT next_nonce FROM server_seed_nonce_counters WHERE server_seed_id = $1 FOR UPDATE;
UPDATE server_seed_nonce_counters SET next_nonce = next_nonce + 1 WHERE server_seed_id = $1;
```

`FOR UPDATE` serialises concurrent purchases. The `pack_commitments(server_seed_id, nonce) UNIQUE` index is a belt-and-braces backstop against any racy allocation slipping through — double-allocation fails on INSERT.

### 3.6 Browser verifier

`src/components/fairness/verify-pack-panel.tsx` loads the canonical test vector on mount, runs it locally, and displays "canonical OK" before touching pack data. It then fetches the pack payload, re-runs `generateWeightedPack` with the revealed seed + commitment + pinned generation version, and compares slot-by-slot. Green if everything matches; red if any byte diverges.

### 3.7 Parameter choices

| Parameter | Value | Why |
|---|---|---|
| Server seed size | **32 bytes** (256 bits) | Standard for HMAC-SHA256 keys; 256-bit entropy is the ceiling of Birthday Paradox collision resistance for SHA-256. |
| Client seed size | **16 bytes** (128 bits) | Per-pack additional entropy; doesn't need to match server seed since it's per-pack, not per-drop. |
| IV size | **12 bytes** (96 bits) | NIST recommendation for AES-GCM. |
| HMAC / hash | **HMAC-SHA256** / **SHA-256** | Standard primitives; widely audited; Web Crypto + Node both support natively. |
| Symmetric encryption | **AES-256-GCM** | Authenticated encryption; no custom crypto. |
| Rejection sampling retry cap | **256** | Probability of exhaustion under valid inputs ≈ `2^-256` — astronomically safe. Throws `RNG_EXHAUSTED` on hit to signal algorithmic regression. |
| Draw counter | **single monotonic uint64** per pack | Unambiguous transcript — one counter means replay is linear. Multiple counters (separate rarity/card) would create two failure surfaces that could disagree. |
| Nonce allocation | **per-seed counter row + UNIQUE index** | Counter serialises concurrent purchases within a single drop; unique index catches any slipthrough. |
| Seed reveal trigger | **drop completion** (`status → completed`) | Users see the seed only after all packs in the drop have been determined — the server cannot selectively reveal to manipulate individual packs. |
| Public audit window | **7 d rolling** | Enough packs for the χ² test to have meaningful power across all six rarity buckets. |
| Public audit rate limit | **30 req / 60 s per IP** | Read-only endpoint; prevents casual scraping while allowing legitimate polling. |
| Public audit cache TTL | **300 s** | Audit results change nightly; 5-min edge cache cuts origin load on link-storms. |

---

## 4. Cross-cutting parameter philosophy

Three principles behind every number above:

1. **Conservative defaults, flag-scoped risk.** Every new mechanism ships behind a boolean env flag with a conservative default. `AUTO_REBALANCE_ENABLED`, `GLOBAL_API_RATE_LIMIT_ENABLED`, `ECONOMICS_ALERTS_ENABLED` — each can be toggled without a redeploy. Risky defaults start off; safety defaults start on.
2. **Thresholds are observable, not tuned once.** Every threshold emits a `security_events` row when it fires (margin alert, auto-rebalance triggered, rate-limit hit, final-window bid, fairness verification run). Operators tune thresholds in response to observed traffic rather than guessing.
3. **Failure is open, not closed — except for inventory and fairness commitments.** Lottery down → FCFS. Rate limiter down → requests flow. Price worker down → stale prices, no writes. The only things that never fail open are the Postgres inventory decrement and the fairness commit-reveal contract — both stay correct even if every other layer dies.
