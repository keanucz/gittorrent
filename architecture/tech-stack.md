# Tech Stack

| Layer | Technology | Rationale |
|---|---|---|
| **Mutable ref consensus** | [Autobase](https://github.com/holepunchto/autobase) | Multi-writer linearisation via causal DAG. Each writer appends to their own Hypercore; Autobase produces a deterministic, replayable ordering. No leader election, no split-brain, offline-first appends. This is the central architectural choice — see `architecture/data-models.md` for the apply function design. |
| **Object store** | [Hyperbee](https://github.com/holepunchto/hyperbee) on Hypercore | Sorted KV store keyed by git SHA. Content-addressing means concurrent writes from multiple peers are always conflict-free. Sparse replication means peers only fetch the blocks they need. |
| **Peer discovery + connections** | [Hyperswarm](https://github.com/holepunchto/hyperswarm) + [HyperDHT](https://github.com/holepunchto/hyperdht) | Topic-based DHT discovery with no rendezvous server. Direct encrypted connections between peers. Falls back to LAN mDNS when DHT is unreachable. |
| **Core management** | [Corestore](https://github.com/holepunchto/corestore) | Factory for many named Hypercores per repo (writer inputs, view, objects). Handles storage, naming, and replication sessions cleanly. |
| **Optional FS mirroring** | [Hyperdrive](https://github.com/holepunchto/hyperdrive) | Not used in the primary design. Available as a fallback (Option A) or for opaque packfile blob storage if loose-object storage becomes a bottleneck. |
| **Runtime** | [Bare](https://github.com/nicolo-ribaudo/bare) (Holepunch) | Lightweight JS runtime purpose-built for Pear binaries and CLI tools. Same ecosystem as all Hypercore libraries; better binary packaging than Node for this use case. Dev workflow runs under Node; production binaries are bundled with Bare. |
| **Git integration** | git-remote-helper protocol (stdin/stdout) | Standard git extension point for custom URL schemes. Installing `git-remote-pear` on `$PATH` makes `git clone pear://…` work with any vanilla git. No git patches, no forks. See `architecture/protocols.md`. |
| **Identity + signing** | ed25519 via [sodium-native](https://github.com/sodium-friends/sodium-native) | One keypair per user, stored locally. Every ref-update op is signed; signature verified in the Autobase `apply` function before any view mutation. sodium-native is the Pear ecosystem standard; native code required for security-grade crypto. |
| **Op serialisation** | [compact-encoding](https://github.com/nicolo-ribaudo/compact-encoding) | Canonical binary codec for ops appended to Hypercores. Deterministic encoding is required because Autobase replays the apply function on reorder. |
| **Logging** | [pino](https://github.com/pinojs/pino) | Structured JSON logging. Fast, minimal, works in Bare. Critical constraint: `git-remote-pear` must log to stderr only — stdout is the git protocol. See `architecture/logging.md`. |
| **Build / bundling** | [bare-bundle](https://github.com/holepunchto/bare-bundle) | Bundles JS + native addons into standalone Bare binaries for distribution. Dev workflow needs no build step (`node bin/pear-git` works). See `architecture/build.md`. |

## Explicitly rejected alternatives

| Alternative | Why rejected |
|---|---|
| **Option A — Hyperdrive-as-bare-repo** | Single writer only. Does not satisfy multi-writer + offline-first push requirements. Kept as a documented fallback if Autobase integration stalls. |
| **Option B — Elected single leader** | Leader election is hard distributed systems. Naive heuristics split-brain under partition. Contradicts offline-first push. Autobase makes it unnecessary. |
| **Homegrown consensus** | Weeks of work. Autobase is tested, documented, and purpose-built for this exact problem. |
| **msgpack for op encoding** | compact-encoding is the Pear ecosystem standard; better Hypercore integration. |
| **Pure-JS crypto (tweetnacl)** | sodium-native is required; pure-JS is not security-grade for signing. |
