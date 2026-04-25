# Task 02: Tests for codec.js

- **Agent:** `tdd-test-writer`
- **Depends on:** Task 01
- **Architecture files:** `architecture/data-models.md`, `architecture/tech-stack.md`

## Description

Write failing unit tests for `lib/codec.js` before the module exists. These tests define the exact encoding contract that the codec implementation (Task 03) must satisfy. Because Autobase replays the `apply()` function on causal reorder, codec encoding must be deterministic and round-trip lossless — the tests must enforce this rigorously.

## Files to create

- `test/codec.test.js`

## What codec.js will export

`codec.js` will export one `compact-encoding`-compatible codec object per op type, plus a top-level discriminated union codec. Likely shape:

```js
// Named exports — one codec per op type
export const refUpdateCodec         // encodes/decodes ref-update ops
export const addWriterCodec         // encodes/decodes add-writer ops
export const removeWriterCodec      // encodes/decodes remove-writer ops
export const objectsAvailableCodec  // encodes/decodes objects-available ops
export const secretsKeyEnvelopeCodec
export const secretsKeyRotateCodec

// Top-level union codec: reads the 'op' discriminant and dispatches
export const opCodec                // encodes/decodes any op
```

Each codec must implement the `compact-encoding` interface:
- `codec.encode(value, state)` — writes into `state.buffer` at `state.start`, advances `state.start`
- `codec.decode(state)` — reads from `state.buffer` at `state.start`, advances `state.start`, returns the decoded value
- `codec.encodingLength(value)` — returns the byte count without writing

## Acceptance Criteria

- [ ] `test/codec.test.js` exists and fails with `MODULE_NOT_FOUND` or similar when `lib/codec.js` does not exist.
- [ ] Tests cover all 6 op types: `ref-update`, `add-writer`, `remove-writer`, `objects-available`, `secrets-key-envelope`, `secrets-key-rotate`.
- [ ] Each op type has a round-trip test: encode then decode produces a value deep-equal to the original input.
- [ ] `ref-update` round-trip covers: `oldSha: null` (new branch), `force: true`, `force: false`, `signature` as a 64-byte Buffer.
- [ ] `add-writer` round-trip covers: `indexer: true` and `indexer: false`.
- [ ] `objects-available` round-trip covers: empty array, single SHA, 256 SHAs (maximum).
- [ ] `secrets-key-envelope` round-trip covers: `encryptedKey` as an 80-byte Buffer, `keyVersion` as a uint32.
- [ ] `secrets-key-rotate` round-trip covers: `newKeyVersion` as a uint32.
- [ ] Tests verify that encoding is deterministic: encoding the same value twice produces byte-for-byte identical output.
- [ ] Tests verify that `encodingLength` matches the actual number of bytes written.
- [ ] Tests use `opCodec` to encode/decode each op type, verifying the discriminant field is preserved.
- [ ] All tests use `node:test` and `node:assert/strict`. No third-party test libraries.

## Testing requirements

Use `compact-encoding`'s `encode` / `decode` helper utilities from the `compact-encoding` package to allocate state buffers properly, e.g.:

```js
import c from 'compact-encoding'

// To encode:
const state = c.state()
codec.preencode(state, value)
state.buffer = Buffer.allocUnsafe(state.end)
codec.encode(state, value)

// To decode:
const decodeState = c.state()
decodeState.buffer = state.buffer
const decoded = codec.decode(decodeState)
```

Alternatively use `c.encode(codec, value)` / `c.decode(codec, buffer)` if the codec is a proper `compact-encoding` codec (which it should be).

Each op type fixture must include all required fields with valid values matching the field constraints in `architecture/data-models.md`:
- SHAs: 40-char lowercase hex strings
- Pubkeys: 32-byte Buffers
- Signatures: 64-byte Buffers
- Timestamps: positive integers
