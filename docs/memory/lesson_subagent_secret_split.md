---
name: Lesson — sub-agent secret-gen prompts must split plaintext from safe-share output
description: Prompts that delegate secret generation (tokens / hashes / keys) to OpenCode or any sub-agent MUST visually + structurally separate plaintext from safe-to-share output, else user's copy-paste reflex leaks plaintext to upstream chat
type: feedback
originSessionId: b953b797-5c97-4889-9ddc-e30f716e29b0
---
When writing a prompt for a sub-agent (OpenCode / Claude Code / other) that generates a secret (admin token, API key, password, signed URL, webhook secret, etc.) AND a derivable non-secret artifact (hash, public key, SQL with hash baked in, etc.), the prompt MUST:

1. **Visually separate plaintext from non-secret output**. Use distinct banners like `=== PRIVATE — DO NOT SHARE ===` above plaintext and `=== SAFE TO SHARE WITH CHAT-CLAUDE ===` above the hash / SQL block.
2. **Place plaintext in its own block at the top**, never mixed in the same block as artifacts the user is likely to copy whole to chat.
3. **Explicitly instruct the sub-agent** with a constraint line like: "do not include PLAINTEXT_TOKEN in any output the user might paste to chat-Claude / Cowork / upstream conversation."

**Why:** 2026-05-12 incident. Chat-Claude wrote an OpenCode prompt to generate Eric's admin bearer token + SHA-256 hash for `admin_tokens` INSERT. The prompt printed plaintext and hash in the same stdout block under similar-looking `PLAINTEXT_TOKEN: ...` / `TOKEN_HASH: ...` labels. Eric (post-wipe, several hours into session, fatigued) copied the entire OpenCode output back to chat to share the hash + SQL for review. Plaintext leaked into Cowork session transcript + Anthropic upstream logs. We had to discard the token, regenerate with a revised prompt that put plaintext under a private banner and only printed hash + SQL under a safe-share banner, then re-INSERT.

**Root cause:** the prompt did not anticipate the user's copy-paste reflex. When a sub-agent's output looks like a single homogeneous artifact, users default to "select all → paste". If the artifact intermixes secret with non-secret content, the reflex exfiltrates the secret.

**How to apply:** before sending any prompt that asks a sub-agent to generate `secret + (hash | sql | id)` pairs, re-read the prompt as a fatigued user would: if they select-all the entire stdout, does it leak the plaintext? If yes, rewrite to separate into two blocks with explicit banners and a sub-agent constraint forbidding plaintext in the safe-share block.

**Related memories**:
- `actors_three_role_model.md` — Chat-Claude writes specs / prompts, OpenCode executes; this lesson is about a Chat-Claude failure mode in prompt-writing
- `communication_bilingual_direct.md` — "push back during fatigue"; this incident was a fatigue-window slip on both sides
