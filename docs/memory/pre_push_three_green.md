---
name: Pre-push hook — three-green required (vue-tsc + H5 + mp-weixin)
description: Pre-push hook enforces vue-tsc + build:h5 + build:mp-weixin all green; mp-weixin deprioritized for V1.1 verify but build must still pass; H5 is primary launch target
type: feedback
originSessionId: 9852fdfb-dfb7-46b2-9864-95942d5727dd
---
Pre-push hook requires three-green: vue-tsc + build:h5 + build:mp-weixin must all pass. mp-weixin is currently deprioritized for V1.1 (集中修后批量 verify), but its build must still pass. H5 is the primary launch target.
