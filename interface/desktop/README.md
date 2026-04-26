# gittorrent-desktop

A local-first desktop client for gittorrent, built with Tauri and React.

## Features

- **Repository Dashboard**: Visual status of your decentralized repositories.
- **Writers & ACL**: Manage who can push to your repositories.
- **Encrypted Secrets**: Securely manage sensitive files within your git workflow.
- **Seeding Controls**: Explicitly control when your machine acts as a peer in the network.
- **Hardened Security**: Minimal IPC command surface and path traversal protection.

## Development

### Prerequisites

- [Node.js](https://nodejs.org/) (v20+)
- [Rust](https://www.rust-lang.org/)
- OS-specific Tauri dependencies (see [Tauri documentation](https://tauri.app/v1/guides/getting-started/prerequisites))

### Setup

```bash
npm install
```

### Run in Development

```bash
npm run dev
```

### Run Tests

```bash
# Frontend Unit Tests
npm test

# Rust Backend Tests
cd src-tauri
cargo test
```

## Build & Package

To build a production artifact for your current platform:

```bash
npm run build
```

The installer will be located in `src-tauri/target/release/bundle/`.

## Security Caveats

- **Decentralized Trust**: Always verify the public keys of writers you invite.
- **Local Secrets**: Secrets are decrypted in memory only. Do not export them to untrusted locations.
- **Hardening**: This app uses a strict command allowlist. If a command fails unexpectedly, verify it is enabled in `tauri.conf.json`.

## License

MIT
