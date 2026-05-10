# Memory mirror

Mirror of Cowork chat-Claude's persistent memory layer. Cowork local at `<user>\AppData\Roaming\Claude\local-agent-mode-sessions\...\spaces\...\memory\` is source-of-truth; this directory is backup + team reference.

## Why

- **Cross-device backup** — Cowork session reset / device migration shouldn't drop memory
- **Team visibility** — Kenny / Zach can read the workflow agreements + project state Eric and chat-Claude have locked in (3-actor model, red-line zones, push-proxy identity policy, sprint-form decision rules, etc.)
- **Faster cross-session handoff** — new chat sessions can be pointed here if Cowork local is empty (e.g. brand-new device)

## Sync convention

Cowork local is source-of-truth. When chat-Claude updates memory (add / edit / delete), it writes the same change here in the same message. Eric / Kenny commit + push.

**Conflict resolution**: Cowork local wins; this mirror gets force-overwritten on next sync.

## Don't

- Don't edit files in this directory directly — Cowork local won't know, and the next sync will overwrite your edit
- Don't `.gitignore` this directory — it's meant to be tracked
- Don't treat this as input for chat-Claude in next session — chat-Claude auto-loads from Cowork local; this mirror is for humans + backup only

## Index

See [`MEMORY.md`](./MEMORY.md) — kept in lockstep with Cowork local `MEMORY.md`.
