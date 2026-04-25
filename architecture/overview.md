# Overview

## Project name

**gittorrent** (CLI binaries: `pear-git`, `git-remote-pear`)

## Description

gittorrent replaces the coordination and availability layer of a centralised git forge (GitHub, GitLab) with a Pear-based P2P swarm. Every clone is already a complete copy of history — git handles that. What forges actually provide is *discovery*, *availability*, and *mutable ref consensus* (knowing what `main` points to right now). gittorrent delivers those three things without any server: peers discover each other via HyperDHT, objects replicate across the swarm through a shared Hyperbee content-addressed store, and mutable refs are linearised across multiple concurrent writers using Autobase's causal-DAG consensus — no leader election, no single host to lose. Users interact through standard `git` commands (`git clone pear://…`, `git push`, `git pull`); the `git-remote-pear` helper handles the P2P layer transparently.

## Who it's for

Small developer teams (2–10 people) who want a serverless, offline-first, host-death-resilient git forge. If you can reach one peer who has the repo, you can clone. If you're offline, you can still commit and push — your changes propagate when you reconnect. Killing the original creator's machine does not kill the repo.

## Core design insight

Git objects (blobs, trees, commits) are immutable and content-addressed — any peer can replicate them with zero conflict risk. The hard problem is mutable refs (`main`, tags): two peers pushing concurrently is a classic distributed-systems conflict. gittorrent solves this by treating the two halves differently:

- **Objects** → shared Hyperbee keyed by SHA. Any peer writes; no conflicts possible.
- **Refs** → Autobase lineariser over per-writer Hypercores. Deterministic ordering, no leader, offline-first appends.

## What this is not

- A replacement for GitHub's issues, PRs, CI, or web UI (out of scope).
- Byzantine-fault-tolerant. The writer set is an explicit ACL of cooperating humans.
- A solution to git garbage collection across the swarm (objects accumulate; acceptable for v1).
