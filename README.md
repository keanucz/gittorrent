# gittorrent

Decentralised git collaboration. Push, pull, and clone repos peer-to-peer — no GitHub, no central server. Secrets management built in so you never have to WhatsApp `.env` files again.

Built on [Hyperswarm](https://github.com/holepunchto/hyperswarm) + [Autobase](https://github.com/holepunchto/autobase).

## How it works

```
Developer A                          Developer B
    │                                    │
    │  git push origin master            │
    │  ──────► Autobase (local) ◄────────┤  git clone pear://...
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

- Repos are identified by `pear://` URLs (base58-encoded public keys)
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
pear-git init                    # → pear://ABC123...
git push origin master
pear-git seed -d                 # seed in background
```

### Clone it (another machine)

```bash
git clone pear://ABC123...
```

### Give someone write access

```bash
# They run:
pear-git whoami                  # → prints their pubkey

# You run:
pear-git invite <their-pubkey>

# Now they can push
```

### Share secrets (no more WhatsApp .env files)

```bash
# Encrypt and store:
pear-git secrets add .env
pear-git secrets add prod.key --name keys/prod.key

# Collaborator retrieves:
pear-git secrets get .env --output .env

# List stored secrets:
pear-git secrets list

# After revoking someone, rotate the key:
pear-git secrets rotate
```

## Commands

| Command | Description |
|---------|-------------|
| `pear-git init` | Initialise a pear-git repo |
| `pear-git whoami` | Print your public key |
| `pear-git invite <pubkey>` | Add a writer (optionally `--indexer`) |
| `pear-git revoke <pubkey>` | Remove a writer |
| `pear-git status` | Show repo info, peers, writers |
| `pear-git seed [-d]` | Seed the repo (`-d` for daemon mode) |
| `pear-git secrets add/get/list/rm/rotate` | Manage encrypted secrets |
| `pear-git help` | Show help |

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
| `PEAR_GIT_DATA_DIR` | `~/.pear-git` | Data directory |
| `PEAR_GIT_LOG_LEVEL` | `warn` | `error\|warn\|info\|debug` |
| `PEAR_GIT_BOOTSTRAP_NODES` | built-in relay | Custom DHT bootstrap nodes |
| `PEAR_GIT_LINGER_MS` | `3000` | Post-push replication time (ms) |

## Development

```bash
npm test          # run all tests
npm run lint      # lint
```

## License

MIT
