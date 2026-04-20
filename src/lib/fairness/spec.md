# Canonical Fairness Spec (Phase 1 B4)

This is the canonical encoding and draw contract for the Phase 1 test vector.

## Inputs

- `serverSeed`: hex string, 64 chars (32 bytes)
- `clientSeed`: hex string, 32 chars (16 bytes)
- `nonce`: uint64 little-endian, 8 bytes
- `drawCounter`: uint64 little-endian, 8 bytes (monotonic per pack; incremented on every roll)

## HMAC Contract

- HMAC input bytes: `concat(clientSeedBytes, nonceBytes, drawCounterBytes)`
- HMAC key bytes: `serverSeedBytes`
- HMAC algorithm: `HMAC-SHA256`
- Output: 32 bytes interpreted as big-endian uint256

## Rejection Sampling

Rarity bucket selection:

- `N = number of rarity buckets in this slot`
- `max_accept = floor(2^256 / N) * N`
- if `hmac_output < max_accept`: `index = hmac_output mod N`, accept
- else: increment drawCounter and retry
- retry cap: 256 (`RNG_EXHAUSTED`)

Card index selection within a rarity pool:

- `M = pool_length` (eligible card IDs for that rarity, sorted by `id ASC`)
- `max_accept = floor(2^256 / M) * M`
- if `hmac_output < max_accept`: `index = hmac_output mod M`, accept
- else: increment drawCounter and retry
- retry cap: 256 (`RNG_EXHAUSTED`)

## Ordering and Monotonicity

- Slot order is deterministic and processed sequentially.
- `drawCounter` is monotonic across all slots.
- Duplicate re-rolls consume additional draws and increment drawCounter exactly like rejection retries.
