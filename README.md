# Gradient

Gradient projects factual agent trace events onto Git diff hunks so reviewers can see where to spend attention.

This repository is currently a TypeScript prototype. It has no runtime dependencies and can run on Node's built-in TypeScript type stripping:

```sh
npm run demo
```

Run CLI commands through npm:

```sh
npm run gradient -- --help
npm run gradient -- demo
```

Install local Git hooks for a repository:

```sh
npm run gradient -- install-hooks
```

Distill a trace and diff:

```sh
npm run gradient -- distill --events events.json --diff diff.patch
```

Render a stored artifact:

```sh
npm run gradient -- show .git/gradient/artifacts/<artifact>.json
```

Annotate a unified diff directly:

```sh
npm run gradient -- annotate-diff --artifact .git/gradient/artifacts/<artifact>.json --diff diff.patch
```

Inspect local metadata:

```sh
npm run gradient -- index
npm run gradient -- find HEAD
```

Core flow:

```text
trace events + unified diff
  -> distill projected hunk facts
  -> store as Git-scoped metadata
  -> render with a local diff tool or upload for hosted review
```

The Pi extension boundary is `src/pi-extension.ts`: feed it observed events plus the final unified diff, and it writes a Gradient artifact.

Current facts:

- `requested`
- `model-initiated`
- `mechanical`
- `file-read-before-edit`
- `blind-edit`
- `searched-before-edit`
- `tested-after-edit`
- `unchecked-after-edit`
- `rewritten`
