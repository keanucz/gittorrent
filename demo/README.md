# HackUPC pear-git demo

Shell scripts that walk through the main features of `pear-git` in front of
judges. Each script:

- Prints every command before running it (`$ cmd`) so the audience sees what's
  happening.
- Pauses between logical steps so the presenter can narrate.
- Saves state to `./pear-demo.env` so later steps pick up the pear URL, pubkeys,
  and demo dir from earlier ones.

Disable the pauses with `PEAR_DEMO_NONINTERACTIVE=1` when rehearsing.

## Prerequisites on every machine

```bash
# from the gittorrent repo root
npm install
npm link          # puts pear-git + git-remote-pear on PATH
```

Verify with `pear-git --help`.

## Three roles

- **Machine A (Alice)** — owns the repo. Runs `a*` scripts.
- **Machine B (Bob)** — collaborator. Runs `b*` scripts.
- **Machine C (Eve)** — outsider / onlooker. Runs `c*` scripts.

Machine C can just be a third terminal on Machine A with `DEMO_DIR` set to a
different path — the demo stays convincing because clone-and-read works over
localhost as well as WAN.

## Flow

1. **Machine A** — `./demo/a1-init-and-push.sh`
   - Creates a fresh git repo, runs `pear-git init`, commits, pushes.
   - Auto-spawns a background seeder on exit.
   - Copy the `pear://...` URL from the output.

2. **Machine B** — `PEAR_URL=pear://... ./demo/b1-clone.sh`
   - Clones the repo. Prints Bob's pubkey to share with Alice.

3. **Machine B** — `./demo/b2-try-push-fail.sh`
   - Makes a commit and tries to push. **Push fails** because Bob is not a
     writer yet.

4. **Machine A** — `B_PUBKEY=... ./demo/a2-grant-write.sh`
   - Alice invites Bob as a writer (non-indexer).

5. **Machine B** — `./demo/b3-push-after-grant.sh`
   - Bob's push now succeeds.

6. **Machine A** — `./demo/a3-pull-bs-file.sh`
   - Alice pulls and shows Bob's new line in the file.

7. **Machine B** — `./demo/b4-try-add-secret-fail.sh`
   - Bob tries to add a secret. **Fails** because non-indexers cannot publish
     encrypted secrets.

8. **Machine A** — `B_PUBKEY=... ./demo/a4-grant-secret-access.sh`
   - Alice creates a bootstrap secret (which initialises the shared secrets
     key) and promotes Bob to indexer. An Autobase
     `secrets-key-envelope` op distributes the sealed key to Bob's pubkey.

9. **Machine B** — `./demo/b5-add-secret-after-grant.sh`
   - Bob now adds a secret file and pushes. The encrypted blob replicates via
     Autobase — no plaintext ever touches git.

10. **Machine A** — `./demo/a5-pull-b-secret.sh`
    - Alice decrypts and views Bob's secret.

11. **Machine C** — `./demo/c1-clone.sh pear://...`
    - An outsider clones. Source code is visible (pear-git doesn't hide git
      data); the encrypted secret blobs are in the swarm.

12. **Machine C** — `./demo/c2-cannot-read-secret.sh`
    - Eve tries to `pear-git secrets get bob-shared.env`. **Fails** — no key
      envelope was sealed for her pubkey.

13. **Machine A** — `./demo/a6-add-secret-as-indexer.sh`
    - Alice publishes her own secret (symmetric with step 9).

14. **Machine B** — `./demo/b6-pull-a-secret.sh`
    - Bob decrypts Alice's secret. Both indexers share the same secrets key.

## Resetting between runs

```bash
# on every machine
rm -f ./pear-demo.env
rm -rf ~/pear-demo-a ~/pear-demo-b ~/pear-demo-c
pkill -f "pear-git seed"
rm -rf ~/.pear-git/stores  # nuclear — drops all pear-git state
```

Then start again at step 1. Run `./demo/reset.sh` to do all of the above.

## Notes for the presenter

- Each script prints the next script to run at the bottom, so you don't need
  to memorise the order.
- `pear-git status` between any two steps is a good way to show the current
  writer/indexer set and the peer count.
- If the seeder crashes or is killed, any `pear-git` command auto-spawns a new
  one. You can always `ps aux | grep "pear-git seed"` to confirm it's running.
