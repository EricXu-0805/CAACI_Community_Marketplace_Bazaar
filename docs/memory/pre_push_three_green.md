---
name: Pre-push hook — three-green required (vue-tsc + H5 + mp-weixin)
description: Pre-push hook enforces vue-tsc + build:h5 + build:mp-weixin all green; mp-weixin deprioritized for V1.1 verify but build must still pass; H5 is primary launch target
type: feedback
---

Pre-push hook requires three-green: vue-tsc + build:h5 + build:mp-weixin must all pass. mp-weixin is currently deprioritized for V1.1 (集中修后批量 verify), but its build must still pass. H5 is the primary launch target.
