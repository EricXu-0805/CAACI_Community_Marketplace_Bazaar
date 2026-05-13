---
name: Lesson — show full element block when patching Vue template bindings
description: When guiding template binding changes in chat (e.g. converting class= to :class= or adding directives), paste the FULL element block as the patch target. Showing only the changed attribute line invites accidental drop of sibling attributes
type: feedback
originSessionId: 8ed7d95e-d7be-4a14-ac48-2308079cb50d
---
When chat-Claude is showing Eric a Vue template binding change in a code block — e.g. converting `class="..."` to `:class="..."`, adding a `:key`, or splitting an attribute into static + binding — paste the FULL element block as the diff target, not just the changed line.

**Why:** Eric reads the diff literally and applies the change as shown. If chat shows only the new `:class=` line and the original element had a sibling `class="conv-row"`, Eric will replace the old line with the new line — dropping the static class. Vue's `class` and `:class` merging only works when BOTH are present.

**How to apply:** when patching templates, format like this:

```vue
<view
  v-for="conv in conversations"
  :key="conv.id"
  class="conv-row"
  :class="{ 'is-swiped': (swipeOffsets[conv.id] || 0) < -5 }"
  @touchstart="onTouchStart($event, conv.id)"
  ...
>
```

NOT like this:
```vue
:class="{ 'is-swiped': (swipeOffsets[conv.id] || 0) < -5 }"
```

The first version preserves the static `class` and the new `:class`. The second version, applied as a 1-line replacement, drops `class="conv-row"`.

**Concrete incident:** v3 P1 hotfix (2026-05-10). Eric replaced `class="{...}"` (broken — no `:` prefix) with `:class="{...}"` per chat-Claude's single-line guidance. Original `class="conv-row"` was on the same line being replaced, so Eric correctly per the diff dropped it. Result: `.conv-row` class missing on the element, `.conv-row.is-swiped .swipe-actions { visibility: visible }` never matched, swipe broken in production until hotfix PR.

**Same rule applies to:** `:style` patches (preserve static style attribute too), event listener changes (preserve other listeners), `v-model` additions (preserve other directives). Anytime a multi-attribute element needs one attribute changed, show the whole element.
