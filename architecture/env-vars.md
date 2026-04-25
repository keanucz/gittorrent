# Environment Variables

All variables are optional unless marked Required. Defaults are designed to work out of the box for a single-user setup.

No variable carries secret/key material. The `secretKey` is read directly from the identity file at runtime — see `architecture/security.md`.

---

| Variable | Purpose | Example | Required | Default |
|---|---|---|---|---|
| `PEAR_GIT_DATA_DIR` | Root directory for the identity file and all per-repo Corestores | `/home/alice/.pear-git` | No | `~/.pear-git` |
| `PEAR_GIT_LOG_LEVEL` | pino log level for all binaries. `git-remote-pear` defaults to `warn` independently to avoid cluttering git's output. | `debug` | No | `info` (`warn` for `git-remote-pear`) |
| `PEAR_GIT_BOOTSTRAP_NODES` | Comma-separated `host:port` list to override HyperDHT's default public bootstrap nodes. Use this for fully private deployments. | `dht1.internal:49737,dht2.internal:49737` | No | Holepunch public DHT nodes |
| `PEAR_GIT_SEEDER_KEYS` | Comma-separated `pear://` URLs or raw base58 keys for repos the seeder should join on startup. Used when running `pear-git seed` as a daemon without interactive args. | `pear://gK3p...QzM2,pear://xY7a...` | No (required if running seeder as a daemon without CLI args) | — |
| `PEAR_GIT_CONNECT_TIMEOUT` | Milliseconds to wait for initial peer connection before reporting a network error | `15000` | No | `10000` |

---

## `.env.example`

```bash
# Root data directory (identity file + corestores)
# PEAR_GIT_DATA_DIR=~/.pear-git

# Log level: error | warn | info | debug | trace
# PEAR_GIT_LOG_LEVEL=info

# Override HyperDHT bootstrap nodes (for private deployments)
# PEAR_GIT_BOOTSTRAP_NODES=dht1.example.com:49737,dht2.example.com:49737

# Repos to seed on daemon startup (comma-separated pear:// URLs)
# PEAR_GIT_SEEDER_KEYS=pear://gK3p...QzM2

# Peer connection timeout in milliseconds
# PEAR_GIT_CONNECT_TIMEOUT=10000
```

Copy to `.env` and uncomment as needed. The binaries load `.env` from the current working directory if present (via a minimal dotenv loader — do not add `dotenv` as a dependency; parse it inline or not at all for production binaries).
