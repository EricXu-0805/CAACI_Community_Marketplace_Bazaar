# Scoped glob compatibility

This module replaces the callable asynchronous and `.sync` file-selection operations used by the reviewed DCloud and unimport consumers. It is a deliberately bounded project package, **not a general implementation of the fast-glob API**. Its implementation does not load `fast-glob`, `micromatch`, or `braces`.

```js
const glob = require('./build-compat/glob'); // from the app directory
const files = await glob('**/*.{ts,js}', { cwd, absolute: true });
const directories = glob.sync('*/utssdk', { cwd, onlyDirectories: true });
```

Runtime dependencies are the official packages pinned to `fdir@6.5.0`, `glob-parent@5.1.2`, `picomatch@2.3.2`, and `fill-range@7.1.1`. The project manifest and lockfile control installation. File crawling uses fdir; regular expressions come from picomatch's `makeRe`, avoiding its callable matcher's exact-string shortcut. Ranges use bounded fill-range enumeration and escaped alternatives, preserving negative-number padding. There is no vendored brace parser.

## Supported contract

Input is a string or array of nonempty strings. An empty array returns no files. Positive patterns must all use one coordinate system: relative to `cwd`, or absolute. Negative patterns beginning with `!` and the `ignore` array are supported. A pattern beginning with `!(` is an extglob and is rejected.

Options are `cwd`, `absolute`, `onlyFiles`, `onlyDirectories`, `followSymbolicLinks`, `ignore`, `unique`, and `dot`. Boolean options require boolean values; `cwd` requires a string and `ignore` requires an array of nonempty strings. Defaults follow the reviewed callers: files only, hidden entries excluded, symlinks followed, results deduplicated. `onlyDirectories:true` overrides `onlyFiles`. `unique:false` and unknown options fail explicitly. Directory names have no trailing slash. Absolute positive patterns produce absolute output even without `absolute:true`.

The exercised pattern contract includes ordinary `*`/`?`, whole-segment `**`, bracket classes, escaped literal metacharacters, extension brace lists, nested extension lists, signed/padded/stepped/reversed numeric ranges, and single-character ranges that do not cross glob syntax. Outer quoted braces retain fast-glob's observed two-stage interpretation. A literal brace path should use escapes or DCloud's bracket-class escaping.

Each call reads the filesystem again. Added/deleted files and changes beneath symlink targets are reflected on the next call. A dangling symlink or disappearing path is skipped without discarding unrelated results. Other filesystem errors, including `EACCES` and `ENOTDIR`, propagate. Symlink entries are excluded when following is disabled and only files/directories are requested.

Patterns without a whole-segment `**` have a finite crawl depth derived from their traversal root. Shallow patterns such as `*.json` and literal filenames do not enter unrelated child directories. Patterns grouped under one root use the maximum required depth; brace alternatives containing slashes conservatively use the full remaining slash count.

## Explicit limits

The following contracts are intentionally rejected rather than counted as compatibility successes:

- Mixed absolute and relative positive patterns.
- Quotes inside a brace group, unbalanced quotes/braces, and plus-signed range endpoints such as `{+1..+3}`.
- Empty brace alternatives such as `{bar,}` or `{,a}`. Optional directory segments require post-expansion slash normalization that this bounded module does not implement; the rejection also covers otherwise harmless empty filename alternatives.
- Alphabetic ranges crossing glob metacharacters, such as `{A..a}`.
- Unescaped parenthesized groups/extglobs; escaped literal parentheses remain valid.
- More than one ordinary `*` per path segment, unless the segment is exactly `**`; more than two `**` segments in one pattern.
- Patterns longer than 10,000 characters, nesting deeper than 16, ranges exceeding 1,000 values, or a conservative product of alternatives exceeding 1,000. The product guard can reject nested alternatives whose expanded output would be smaller.
- Windows traversal; verification currently covers POSIX paths.

The limits apply to positive and negative patterns. They bound known expansion and backtracking cases; they are not a claim that the underlying regular-expression engine has linear complexity for arbitrary syntax. Result ordering is not promised: the compatibility evidence compares selected names, and unimport applies its own ordering.

`glob.compilePatterns(patterns, options)` is an internal helper returning `matches(fullPath, isDirectory)`, `isIgnored`, `isPruned`, traversal roots, and path-coordinate metadata. It implements this module's glob semantics and should not be substituted for watcher matching without verifying that watcher's separate contract.

## Verification

Run the portable regression tests from the application directory:

```sh
node --test build-compat/glob/compat.test.cjs
```

These tests use temporary synthetic files and require no legacy glob dependency. They cover previously wrong literal/Unicode matches, padded ranges, absolute CSS ignores, directory output, negative-depth filtering, hidden files, broken symlinks, create/delete changes, filesystem errors, explicit rejections, and resource limits.

The separate implementation evidence runner accepts a candidate module path and compares against the archived, unchanged fast-glob baseline. On Node 22.23.3 it records 114 matching supported invocations, 14 explicitly unsupported invocations, four matching filesystem-error results, and six immediate resource-limit rejections. Unsupported invocations remain listed as failures of the broader baseline contract, not passes. This is bounded consumer compatibility evidence, not universal fast-glob equivalence.
