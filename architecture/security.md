# Security

---

## Threat model

### Git / P2P layer

| Threat | Mitigation | Status |
|---|---|---|
| Bytes altered in replication | Hypercore's built-in per-block ed25519 signatures. Any tampered block is detected and rejected. | Mitigated |
| Non-writer pushes a ref | Autobase writer ACL + ed25519 signature check inside `apply()` before any view mutation | Mitigated |
| Invalid signature on op | Verified in `apply()` before processing. Invalid → dropped + rejection log entry. | Mitigated |
| Concurrent pushes to same ref | Autobase linearises; losing writer surfaces as `non-fast-forward` rejection. Same resolution as GitHub: `git pull --rebase`. | Mitigated — UX handled |
| Rogue indexer removes all other writers | Last indexer cannot be removed (Autobase native invariant + guard in `apply()`). | Partially mitigated — final indexer is a trust root |
| Man-in-the-middle on swarm connections | Hyperswarm uses Noise protocol (encrypted + authenticated connections). | Mitigated |
| Malicious commit content pushed by a valid writer | Out of scope. Trust model: writers are cooperating humans. Same as GitHub with direct push access. | Accepted |
| Sybil attack on DHT | Writer set is an explicit ACL. Connecting to many peers does not grant write access. | Accepted |
| Force-push rewrites public history | Allowed if signed by a writer. Visible via `signedLength` rollback in `pear-git status`. | Accepted — surfaced to users |
| Object accumulation / no GC | Objects stored in Hyperbee forever. No `git gc` equivalent across swarm in v1. | Accepted — known debt |
| Stale-leader / split-brain | N/A — no leader. Autobase's causal DAG has no split-brain condition. | N/A |

### Secrets layer

| Threat | Mitigation | Status |
|---|---|---|
| Non-writer reads encrypted secrets | All content encrypted with a per-repo secrets key. Only writers possess a key envelope. A peer without an envelope sees only ciphertext. | Mitigated |
| Eavesdropper intercepts a key envelope in transit | Envelopes are Hypercore-signature-protected in transit and individually sealed-box encrypted — only the recipient's X25519 key can open them. | Mitigated |
| Revoked writer reads secrets encrypted before rotation | They retain their old key envelope. Forward secrecy requires running `pear-git secrets rotate` after revocation. `pear-git revoke` prints an explicit warning. | Accepted — documented, user action required |
| Forged key envelope (attacker substitutes their own) | Envelope ops must be signed by an indexer (verified in `apply()`). A non-indexer cannot issue valid envelopes. | Mitigated |
| Key rotation atomicity failure (partial re-encryption) | Each secret file stores its `keyVersion`. Readers detect mismatches and retry. Clients refuse to write new secrets at an old version once a rotate op has been seen. | Mitigated |
| Secret file path traversal | Paths validated against `/^[\w.\-\/]+$/`; `..` components explicitly rejected before write. | Mitigated |
| Accidental git commit of secret file | `pear-git init` writes a `.gitignore` covering `.env`, `.env.*`, `*.pem`, `*.key`, `secrets/`. | Mitigated by convention |
| Brute-force of encrypted secrets content | XSalsa20-Poly1305 with a random 32-byte key and random 24-byte nonce per file. No practical attack. | Mitigated |

---

## Input validation

Performed before appending any op to the input core (in `lib/autobase-repo.js` and `bin/pear-git`):

| Field | Validation |
|---|---|
| Ref name | Must match `/^refs\/[\w\/\-.]+$/` or equal `'HEAD'`. Reject anything else. |
| SHA values (`oldSha`, `newSha`) | Must match `/^[0-9a-f]{40}$/` exactly. Null allowed for `oldSha` only. |
| Op signatures | 64-byte Buffer. Verified via `sodium-native` `crypto_sign_verify_detached` before any view mutation. |
| `objects-available` SHAs | Each must match SHA regex. Array capped at 256 entries. |
| Writer pubkeys | Must be 32-byte Buffer (64-char hex). Validated before `add-writer` / `remove-writer` ops. |
| `pear-git invite` pubkey arg | Must be 64-char hex string. Reject with exit code 2 and clear error if not. |
| Secret file path | Must match `/^[\w.\-\/]+$/`. No `..` components. Max 255 chars. |
| `secrets-key-envelope` key version | Must equal current `secrets-key-version` in view (or 1 if version is 0). |
| `secrets-key-rotate` new version | Must equal `currentKeyVersion + 1`. |

---

## Secrets management (credentials and keys)

| Secret | Location | Access |
|---|---|---|
| User's `secretKey` | `~/.pear-git/identity` (mode `0600`) | Loaded once by `lib/identity.js`; held in memory only; never passed to other modules raw |
| Autobase keypair | Managed internally by Autobase / Corestore | Never exposed to application code |
| Per-repo symmetric secrets key | Never stored in plaintext. Each writer holds an encrypted envelope in the Autobase view. Decrypted in memory by `lib/secrets.js` only. | Only accessible to current writers |

Rules:
- `secretKey` is **never** logged. See `architecture/logging.md` for pino redaction setup — also covers `encryptedKey`.
- `secretKey` is **never** passed via environment variables or command-line arguments.
- `secretKey` is **never** present in any op payload or network message.
- The decrypted `secretsKey` (symmetric) is held in memory only for the duration of a single encrypt/decrypt call in `lib/secrets.js`.
- Only `publicKey` is ever included in log output or user-facing messages.

---

## Known env vars with no secret material

See `architecture/env-vars.md`. No variable carries a private key or credential.

---

## CORS, rate limiting, HTTP

N/A — there is no HTTP server. The attack surface is:

- **Hyperswarm connections**: authenticated via Noise protocol. Applications cannot forge another peer's identity without their keypair.
- **Op ACL**: enforced at apply-time, not at network ingress. Even if a malicious peer floods the swarm with connections, they cannot append to our input cores or forge ops.
- **DHT bootstrap**: uses Holepunch public nodes by default. Override with `PEAR_GIT_BOOTSTRAP_NODES` to use private infrastructure.

---

## Known accepted risks and future work

| Risk | Notes |
|---|---|
| No object GC | Objects accumulate in the Hyperbee forever. For large repos this will bloat disk. Plan: add a `pack-on-receive` pass post-v1. |
| No pack file dedup | Loose objects only. Delta compression across the swarm is not implemented. |
| Quorum stalls with few indexers | `signedLength` only advances when a majority of indexers have acknowledged. With 1 indexer on flaky wifi, stable history stalls. Mitigate: always have ≥2 indexers on reliable hosts. |
| Autobase op reordering | Autobase may reorder ops in the unsigned tail. Mitigate: expose only `signedLength`-stable state to git by default. |
| Revoked writer retains secret access until rotation | Run `pear-git secrets rotate` immediately after every revocation. `pear-git revoke` prints a warning. |
| No per-file secret ACLs | All writers share one secrets key. Granular access control is not supported in v1. |
| Secret rotation is not atomic across the network | Peers may temporarily see a mix of old/new key versions during propagation. The `keyVersion` field in each file enables correct client-side handling. |
