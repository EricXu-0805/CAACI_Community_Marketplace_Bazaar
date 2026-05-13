---
name: GitHub PR creation — compare page does NOT auto-create PR
description: Both `git push` remote URL and `gh pr create` "Continue in browser" land on compare page; must click green "Create pull request" + re-paste body; prefer `gh pr create --body` flag or "Submit" prompt
type: reference
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
GitHub PR creation has TWO paths that land on a "Comparing changes" page (URL pattern `/compare/main...<branch>`) which does NOT auto-create the PR. The user must click the green "Create pull request" button on that page to actually create it.

**Path A — push then click remote URL**: After `git push -u origin <branch>`, the remote prints "Create a pull request for ... visiting `https://github.com/.../pull/new/<branch>`". Opening that URL → compare page → still need to click "Create pull request".

**Path B — `gh pr create` with "Continue in browser"**: Running `gh pr create --title "..."` and selecting "Continue in browser" at the "What's next?" prompt → gh CLI opens the same compare page → still need to click "Create pull request". Body buffer entered in gh CLI is NOT transferred to the browser; user must re-paste body.

**To skip the round-trip:**
- Pass `--body "..."` (or `--body-file <path>`) to `gh pr create` directly so PR is created at CLI without needing browser
- OR at the "What's next?" prompt, select **"Submit"** (not "Continue in browser")

**Eric burnt time on this twice (PR #5 N13/N14 + PR #6 N7-redux D3, 2026-05-09 to 05-10).** When writing push instructions, prefer giving `gh pr create --title --body` one-liner; if writing interactive flow, explicitly say "select Submit not Continue in browser at the prompt" so Eric doesn't loop through compare page.
