# Project Structure

## Repository layout

```
gittorrent/
├── bin/
│   ├── git-remote-pear          # Entry point for the git remote helper
│   │                            # Installed to PATH; git invokes it for pear:// URLs
│   └── pear-git                 # Entry point for the user-facing CLI
│                                # Subcommands: init, invite, revoke, seed, status, secrets
│
├── lib/
│   ├── autobase-repo.js         # Autobase wrapper
│   │                            #   - Creates/opens the Autobase with Hyperbee view
│   │                            #   - Implements the deterministic apply() function
│   │                            #   - Exposes: getRef, updateRef, addWriter, removeWriter
│   │                            #   - Handles all op types incl. secrets-key-envelope,
│   │                            #     secrets-key-rotate (view-secrets-keys Hyperbee)
│   │
│   ├── object-store.js          # Content-addressed git object storage
│   │                            #   - Hyperbee keyed by 40-char hex SHA
│   │                            #   - Exposes: has(sha), get(sha), put(sha, buf)
│   │                            #   - Values: gzip-compressed canonical git object bytes
│   │
│   ├── secrets.js               # Encrypted secret file storage
│   │                            #   - deriveX25519Pub(ed25519Pub), deriveX25519Secret(ed25519Secret)
│   │                            #   - sealKey(secretsKey, recipientEd25519Pub) → envelope
│   │                            #   - openKey(envelope, myEd25519Pub, myEd25519Secret) → secretsKey
│   │                            #   - encryptFile(plaintext, secretsKey) → { nonce, ciphertext }
│   │                            #   - decryptFile(nonce, ciphertext, secretsKey) → plaintext | null
│   │                            #   - getMySecretsKey(autobaseView, identity) → secretsKey | null
│   │                            #   - See architecture/secrets.md for full design
│   │
│   ├── remote-helper.js         # stdin/stdout git remote helper protocol
│   │                            #   - Reads commands from stdin line-by-line
│   │                            #   - Dispatches: capabilities, list, fetch, push, option
│   │                            #   - ALL logging goes to stderr (stdout is protocol only)
│   │
│   ├── identity.js              # ed25519 keypair management
│   │                            #   - Loads from PEAR_GIT_DATA_DIR/identity (creates if absent)
│   │                            #   - Exposes: sign(data), verify(sig, data, pubkey), publicKey
│   │                            #   - secretKey never leaves this module
│   │
│   ├── swarm.js                 # Hyperswarm peer lifecycle
│   │                            #   - join(repoKey): announce + discover peers for a repo
│   │                            #   - leave(repoKey)
│   │                            #   - Wires Corestore replication sessions to peer connections
│   │
│   └── codec.js                 # compact-encoding schemas for all op types
│                                #   - Encodes/decodes: ref-update, add-writer,
│                                #     remove-writer, objects-available,
│                                #     secrets-key-envelope, secrets-key-rotate
│
├── test/
│   ├── autobase-repo.test.js    # Unit: apply() determinism, ref conflict handling,
│   │                            #        writer ACL enforcement, reorder behaviour,
│   │                            #        secrets-key-envelope apply logic
│   ├── object-store.test.js     # Unit: has/get/put, SHA validation, gzip round-trip
│   ├── remote-helper.test.js    # Unit: protocol line parsing, response formatting
│   ├── secrets.test.js          # Unit: key derivation, seal/open round-trip,
│   │                            #        encrypt/decrypt, key version mismatch,
│   │                            #        path validation, rotation flow
│   └── e2e/
│       └── clone-push-pull.test.js  # Integration: two in-process peers, init → clone
│                                    #   → push from each → disconnect peer A → pull from B
│                                    #   → secrets add/get across peers
│
├── scripts/
│   ├── build.sh                 # Compiles both binaries via bare-bundle
│   └── install.sh               # Copies binaries to $INSTALL_DIR (default ~/.local/bin)
│
├── .env.example                 # Documents all supported env vars (see env-vars.md)
├── package.json
└── architecture/
    ├── overview.md
    ├── tech-stack.md
    ├── project-structure.md     # (this file)
    ├── data-models.md
    ├── protocols.md
    ├── cli-interface.md
    ├── auth.md
    ├── security.md
    ├── secrets.md
    ├── logging.md
    ├── build.md
    ├── env-vars.md
    └── external-deps.md
```

## Runtime data layout (per peer's machine, not in repo)

Controlled by `PEAR_GIT_DATA_DIR` (default: `~/.pear-git`).

```
~/.pear-git/
│
├── identity                     # JSON: { publicKey, secretKey, createdAt }
│                                # Mode 0600. secretKey never logged or exported.
│
└── stores/
    └── <base58-repo-key>/       # One Corestore per repo the peer has joined
        │
        ├── autobase/
        │   ├── input-<this-peer-id>      # This peer's writer Hypercore (ref ops + secrets ops)
        │   ├── input-<peer-B-id>         # Replicated writer core from peer B
        │   ├── input-<peer-C-id>         # ... and so on for each writer
        │   ├── view-refs                 # Derived Hyperbee: refname → sha
        │   ├── view-secrets-keys         # Derived Hyperbee: secrets-key-version,
        │   │                             #   secrets-key/<writerPubKeyHex> → { encryptedKey, keyVersion }
        │   └── system                    # Autobase internal bookkeeping core
        │
        ├── objects/
        │   └── core                      # Shared Hyperbee: sha → gzip(object bytes)
        │                                 # Replicated to all peers via Hyperswarm
        │
        ├── secrets/
        │   └── core                      # Shared Hyperbee: path → keyVersion+nonce+ciphertext
        │                                 # Replicated to all peers — safe: all content encrypted
        │
        └── working-clone/
            └── .git/                     # Standard local git repo the user works in
                                          # Wrapper syncs between this and the Pear stores
```

## Key boundaries

| Boundary | Rule |
|---|---|
| `lib/identity.js` | Only module that ever holds `secretKey` in memory |
| `lib/secrets.js` | Only module that performs X25519 key derivation and secret encryption/decryption |
| `bin/git-remote-pear` stdout | Protocol bytes only — no logging, no debug output |
| `~/.pear-git/identity` | File mode `0600`; created by `identity.js` on first use |
| Autobase `apply()` in `autobase-repo.js` | Must be deterministic and side-effect-free w.r.t. external state — no clocks, no network, no random |
| `secrets/core` Hyperbee | Written by `lib/secrets.js` only, never by `apply()` |
