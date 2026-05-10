---
name: Windows cmd.exe — multi-line `-m` commit messages don't work
description: cmd.exe parses each line after the first inside `-m "..."` as a separate command; commit only gets title; use multiple `-m` flags or `-F filepath` for body, or keep single-line title
type: feedback
---

When writing `git commit -m "..."` (or `gh pr create -b "..."`) commands for Kenny's Windows machine, **do NOT put multi-line strings inside `-m` / `-b`**. cmd.exe doesn't preserve newlines inside double-quoted strings the way bash / zsh do — instead each line after the first gets parsed as a new shell command.

**Symptom:** terminal shows `'<first word of line 2>' is not recognized as an internal or external command`, and the actual commit only contains the first line as the title (body is silently dropped). Commit succeeds but with truncated message.

**Why:** cmd.exe quoting semantics differ from POSIX shells. PowerShell handles it differently again. Eric's Kenny machine uses cmd.exe by default (per terminal screenshots showing `C:\Users\kenny\source\repos\...>` prompt format).

**How to apply when writing commands for Kenny:**
- **Multiple `-m` flags** for paragraph body: `git commit -m "title" -m "para 1" -m "para 2"` — each `-m` becomes a separate paragraph
- OR `-F <filepath>` and write the message to a temp file first
- OR keep messages **single-line title only**, put detail elsewhere (PR body, README, etc.)
- For `gh pr create`, use **`--body-file <path>`** not `--body "multi\nline"`

Surfaced 2026-05-10 — memory-mirror push commit. Eric pasted multi-line `-m` body, cmd.exe parsed each line of body as a separate command (`'Mirror' is not recognized...`, `'Convention:' is not recognized...`, etc.). Commits succeeded with title only; body silently dropped. Not functionally broken (commits still applied, files committed), but commit message lost detail.

**Same root cause as `backlog_prepare_script_windows_incompat`** — Unix shell syntax assumed in tooling Eric runs through Kenny machine. Both are reminders that Kenny is Windows / cmd.exe, not bash.
