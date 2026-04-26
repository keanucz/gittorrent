# gittorrent

Decentralised git collaboration. Push, pull, and clone repos peer-to-peer — no GitHub, no central server. Secrets management built in so you never have to WhatsApp `.env` files again.

Built on [Hyperswarm](https://github.com/holepunchto/hyperswarm) + [Autobase](https://github.com/holepunchto/autobase).

## How it works

```
Developer A                          Developer B
    │                                    │
    │  git push origin master            │
    │  ──────► Autobase (local) ◄────────┤  git clone gittorrent://...
    │          │                         │
    │          ▼                         │
    │     Hyperswarm DHT                 │
    │     (peer discovery)               │
    │          │                         │
    └──────────┼─────────────────────────┘
               │
         Direct P2P connection
         (UDP hole punching)
```

- Repos are identified by `gittorrent://` URLs (base58-encoded public keys)
- Writers are authenticated via ed25519 identity keys
- Secrets are encrypted with sealed box crypto — only invited writers can decrypt

## Install

```bash
git clone https://github.com/keanucz/gittorrent.git
cd gittorrent
npm install
export PATH="$PWD/bin:$PATH"
```

## Quick start

### Create a repo

```bash
cd my-project
git init && git add . && git commit -m "init"
gittorrent init                    # → gittorrent://ABC123...
git push origin master
gittorrent seed -d                 # seed in background
```

### Clone it (another machine)

```bash
git clone gittorrent://ABC123...
```

### Give someone write access

```bash
# They run:
gittorrent whoami                  # → prints their pubkey

# You run:
gittorrent invite <their-pubkey>

# Now they can push
```

### Share secrets (no more WhatsApp .env files)

```bash
# Encrypt and store:
gittorrent secrets add .env
gittorrent secrets add prod.key --name keys/prod.key

# Collaborator retrieves:
gittorrent secrets get .env --output .env

# List stored secrets:
gittorrent secrets list

# After revoking someone, rotate the key:
gittorrent secrets rotate
```

## Commands

| Command | Description |
|---------|-------------|
| `gittorrent init` | Initialise a gittorrent repo |
| `gittorrent whoami` | Print your public key |
| `gittorrent invite <pubkey>` | Add a writer (optionally `--indexer`) |
| `gittorrent revoke <pubkey>` | Remove a writer |
| `gittorrent status` | Show repo info, peers, writers |
| `gittorrent seed [-d]` | Seed the repo (`-d` for daemon mode) |
| `gittorrent secrets add/get/list/rm/rotate` | Manage encrypted secrets |
| `gittorrent help` | Show help |

All commands support `--help`.

## How secrets work

1. First `secrets add` generates a random 256-bit symmetric key
2. The key is sealed (asymmetric crypto) for each writer's ed25519 public key
3. When you `invite` someone, the key is automatically sealed for their key too
4. Secret files are encrypted with the symmetric key and stored in a Hyperbee
5. `secrets rotate` generates a new key, re-encrypts everything, distributes to current writers
6. Revoked writers never get the new key

## Architecture

- **Autobase** — multi-writer append-only log with deterministic state machine
- **Hyperswarm** — DHT-based peer discovery with UDP hole punching
- **Corestore** — manages Hypercore storage and replication
- **Hyperbee** — sorted key-value store on top of Hypercore
- **sodium-native** — ed25519 signatures, X25519 key exchange, sealed boxes

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `GITTORRENT_DATA_DIR` | `~/.gittorrent` | Data directory |
| `GITTORRENT_LOG_LEVEL` | `warn` | `error\|warn\|info\|debug` |
| `GITTORRENT_BOOTSTRAP_NODES` | built-in relay | Custom DHT bootstrap nodes |
| `GITTORRENT_LINGER_MS` | `3000` | Post-push replication time (ms) |

## Development

```bash
npm test          # run all tests
npm run lint      # lint
```

## License

MIT
