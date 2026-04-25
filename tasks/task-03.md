# Task 03: codec.js — compact-encoding schemas for all 6 op types

- **Agent:** `backend-dev`
- **Depends on:** Task 02
- **Architecture files:** `architecture/data-models.md`, `architecture/tech-stack.md`

## Description

Implement `lib/codec.js` so all tests in `test/codec.test.js` pass. This module is the canonical binary serialisation layer for every op that Autobase writers append to their input Hypercores. Correct, deterministic encoding is critical: Autobase replays the `apply()` function on causal reorder, so the same bytes must decode to the same value every time.

## Files to create/modify

- `lib/codec.js` — the only file to create in this task

## Op types to encode

All 6 op types defined in `architecture/data-models.md`:

### `ref-update`
```
Fields: op(string), ref(string), oldSha(string|null), newSha(string),
        force(boolean), signature(Buffer 64 bytes), timestamp(number)
```

### `add-writer`
```
Fields: op(string), key(Buffer 32 bytes), indexer(boolean), signature(Buffer 64 bytes)
```

### `remove-writer`
```
Fields: op(string), key(Buffer 32 bytes), signature(Buffer 64 bytes)
```

### `objects-available`
```
Fields: op(string), shas(string[] max 256 entries, each 40-char hex)
```

### `secrets-key-envelope`
```
Fields: op(string), recipientKey(Buffer 32 bytes), encryptedKey(Buffer ~80 bytes),
        keyVersion(uint32), signature(Buffer 64 bytes)
```

### `secrets-key-rotate`
```
Fields: op(string), newKeyVersion(uint32), signature(Buffer 64 bytes)
```

## Acceptance Criteria

- [ ] `npm test -- --test-name-pattern codec` passes all tests in `test/codec.test.js`.
- [ ] All 6 op types round-trip losslessly through encode/decode.
- [ ] `encodingLength` is accurate for all op types and inputs.
- [ ] `opCodec` correctly dispatches encode and decode based on the `op` string discriminant.
- [ ] Encoding is deterministic: calling encode twice with the same input produces identical bytes.
- [ ] `lib/codec.js` uses named ESM exports (no default export).
- [ ] No runtime dependencies beyond `compact-encoding`.
- [ ] Linter clean.

## Key implementation notes

- Import `compact-encoding` as `import c from 'compact-encoding'`. Use its built-in primitive codecs (`c.string`, `c.bool`, `c.uint32`, `c.buffer`, `c.fixed(n)`) to compose struct codecs.
- Use `c.fixed(64)` for signature fields (always exactly 64 bytes).
- Use `c.fixed(32)` for pubkey fields (always exactly 32 bytes).
- Use `c.fixed(40)` or `c.string` for SHA fields — fixed(40) is more efficient since SHAs are always 40 chars, but either is acceptable.
- For `encryptedKey` in `secrets-key-envelope`: use a length-prefixed buffer (`c.buffer`) since the size is nominally ~80 bytes but could vary slightly with different libsodium constants.
- For `oldSha` (nullable string): use an optional/nullable codec. One approach: encode a boolean flag first, then the string if present.
- For `shas` array in `objects-available`: use `c.array(shaCodec)` with a uint16 length prefix — the array can hold up to 256 items.
- The `op` discriminant string should be encoded first in every struct, so the top-level `opCodec` can peek at it to decide which sub-codec to use.
- `opCodec` decode: read the full buffer, peek the `op` field, then decode with the appropriate codec. One clean approach is to encode `op` as the first field of every struct and use `c.string` for it.
- Keep the file under 200 lines. If it grows beyond that, the codecs are too verbose — use `c.struct` or helper functions.
