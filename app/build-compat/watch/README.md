# DCloud build watcher compatibility

This package adapts the specific watcher calls used by the pinned DCloud build tooling. It is not a drop-in implementation of the complete Chokidar 3 API or glob language.

It uses the unmodified official `chokidar@4.0.3` runtime, installed under the distinct `chokidar-runtime` dependency name, to watch literal directories. `picomatch@2.3.2` selects emitted files using the same matcher generation as the original Chokidar/anymatch stack. No brace expansion library or replacement brace parser is included. The fast-glob compatibility compiler is deliberately separate because its preprocessing has different semantics.

Supported calls are `watch(paths, options)`, `new FSWatcher(options).add(paths)`, `.add()`, `.unwatch()`, `.close()`, and the `add`, `change`, `unlink`, directory, `all`, `ready`, `raw`, and `error` events used by these consumers. `options.cwd`, `closed`, and a selected-path `getWatched()` view are available. Events use paths relative to an explicitly supplied cwd; otherwise they use absolute paths. The implementation forwards runtime options such as polling intervals, persistence, symlink following, atomic writes, write stabilization, depth, and permission-error handling.

Globs require an explicit cwd and must remain inside that cwd. Each glob watches its literal cwd directory and filters events against the complete pattern. This intentionally trades additional watching inside the input tree for correct future creation of an initially missing glob root. Literal directories, including absent ones and easycom's `disableGlobbing` inputs, are delegated directly. User-specified ignored paths prune the runtime traversal. Unwatching removes delivery eligibility, including existing descendant file handles, while retaining backend roots shared by overlapping selectors.

The supported glob subset covers DCloud's ordinary `*`, `**`, bracket-escaped literal paths, and one non-nested brace alternative group such as `*.{vue,uvue}`. Inputs are rejected before matcher generation when they contain brace ranges, extglobs, multiple/nested brace groups, empty brace alternatives, over 32 brace alternatives, more than one wildcard token in a path segment, more than two globstars, or over 4096 characters. These bounds are intentional; unsupported syntax must not silently acquire different meaning or allow repeated ambiguous regex groups. Literal paths passed with `disableGlobbing` bypass glob syntax checks.

Intentional differences from observed baseline defects:

- An initially missing glob root is discovered when created.
- Unwatching a directory suppresses edits to already watched children.
- Ready is emitted once.
- Literal brace/bracket cwd names are supported, including relative ignored patterns under that cwd.

Full filesystem state for `getWatched()` under `ignoreInitial`, Windows behavior, arbitrary globs without cwd, and complete Chokidar 3 event-order equivalence are outside this package's verified contract. Native watching requires a host that permits filesystem watchers; tests in the execution sandbox returned `EMFILE` even for standalone `fs.watch`, so native evidence must come from the separately authorized host-level harness.

After dependencies are installed, run the portable regression suite from the app directory with `node --test build-compat/watch/watcher.test.cjs`. It uses polling and temporary real files, without environment-specific paths or dependency substitution.
