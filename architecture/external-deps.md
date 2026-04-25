# External Dependencies

---

## NPM packages

### Runtime dependencies

| Package | Purpose | Why this one |
|---|---|---|
| [`autobase`](https://github.com/holepunchto/autobase) | Multi-writer Hypercore lineariser — the core of mutable ref consensus | No viable alternative. This is the central architectural choice. Read `DESIGN.md` in the repo before writing the `apply()` function. |
| [`hyperbee`](https://github.com/holepunchto/hyperbee) | B-tree KV store on Hypercore — object store and Autobase ref view | Sorted, sparse-replication-friendly, built for this stack. No alternative considered. |
| [`hyperswarm`](https://github.com/holepunchto/hyperswarm) | Peer discovery and encrypted connections | Topic-based DHT; no rendezvous server; falls back to LAN mDNS. Standard in the Pear ecosystem. |
| [`hypercore`](https://github.com/holepunchto/hypercore) | Signed append-only log | Underlying primitive for Hyperbee and Autobase. Always present transitively; also used directly. |
| [`corestore`](https://github.com/holepunchto/corestore) | Multi-core manager and storage factory | Required by Autobase. Keeps per-repo core naming sane. |
| [`compact-encoding`](https://github.com/nicolo-ribaudo/compact-encoding) | Binary codec for op serialisation | Deterministic encoding required for Autobase replay. Pear ecosystem standard. |
| [`sodium-native`](https://github.com/sodium-friends/sodium-native) | ed25519 signing and verification | Native libsodium bindings. No pure-JS fallback — security-grade crypto requires native code. Has a `node-gyp` compile step on `npm install`. |
| [`pino`](https://github.com/pinojs/pino) | Structured JSON logging | Fast, minimal, Bare-compatible. See `architecture/logging.md`. |

### Dev dependencies

| Package | Purpose |
|---|---|
| [`bare-bundle`](https://github.com/holepunchto/bare-bundle) | Bundle JS + native addons into standalone Bare binaries for distribution |
| [`eslint`](https://github.com/eslint/eslint) | Linting |

---

## External services

| Service | Purpose | Fallback |
|---|---|---|
| **Holepunch public DHT bootstrap nodes** | Initial HyperDHT peer discovery. Used by Hyperswarm to find other peers for a given topic (repo key). | Run your own: `npx hyperdht --bootstrap --port 49737`. Set `PEAR_GIT_BOOTSTRAP_NODES` to point at it. LAN peers will also discover each other via mDNS without any DHT. |

No cloud APIs. No databases. No auth services. No payment services. The system is fully self-contained once peers can reach each other.

---

## Fallback strategies

| Scenario | Fallback |
|---|---|
| DHT unreachable (corporate firewall) | Peers on same LAN discover each other via Hyperswarm's mDNS fallback automatically |
| All remote peers offline | All previously-fetched objects and refs remain available locally. Push is queued and syncs on reconnect. |
| Autobase too complex (time pressure) | Fall back to Option A: Hyperdrive-as-bare-repo (single writer, read-only replication). Documented in `architecture.md` §4. |
| `bare-bundle` packaging issues | Ship as an npm package (`npm install -g gittorrent`) and run under Node instead of Bare |

---

## Prior art — read before implementing

These projects made design decisions you should know about before writing the equivalent code:

| Project | Lesson |
|---|---|
| [git-remote-ipfs](https://github.com/nicola/git-remote-ipfs) | Object storage patterns for content-addressed git objects over P2P |
| [git-remote-dat](https://github.com/nicola/git-remote-dat) | Git remote helper protocol implementation pitfalls |
| [Radicle Link](https://github.com/radicle-dev/radicle-link) | Multi-writer git design decisions — study their conflict resolution, and why they moved away from a single-writer model |
| [Autobase DESIGN.md](https://github.com/holepunchto/autobase/blob/main/DESIGN.md) | **Mandatory reading** before writing the `apply()` function. Covers reordering semantics, the system core, and indexer quorum. |
