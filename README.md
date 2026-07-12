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
npm run gradient -- annotate-diff --commit HEAD --diff diff.patch
```

Inspect local metadata:

```sh
npm run gradient -- index
npm run gradient -- find HEAD
```

### Git notes (pushed with your commits)

After distilling, write the artifact as a git note so it travels with the repo:

```sh
npm run gradient -- notes-write          # write note on current HEAD
npm run gradient -- notes-read HEAD      # read note from a commit
npm run gradient -- notes-push           # push notes to origin
npm run gradient -- notes-fetch          # fetch notes from origin
npm run gradient -- log --oneline        # show Gradient facts in git log
```

With hooks installed, `post-commit` auto-writes notes and `pre-push` auto-pushes them.

Receivers fetch with `git fetch origin refs/notes/gradient:refs/notes/gradient`.

### CI workflow

Copy `examples/ci-github-actions.yml` to `.github/workflows/gradient.yml`.
The workflow reads notes from the PR head branch and posts inline comments
like `model-initiated · blind edit · unchecked` on each flagged hunk.

Core flow:

```text
trace events + unified diff
  -> distill projected hunk facts
  -> store as Git-scoped metadata
  -> render with a local diff tool or upload for hosted review
```

The Pi extension boundary is `src/pi-extension.ts`: feed it observed events plus the final unified diff, and it writes a Gradient artifact.

Pi extension usage:

```sh
pi -e /home/jtregunna/Projects/git-mms/src/gradient-pi.ts
```

Inside Pi:

```text
/gradient-status
/gradient-distill
```

The extension captures Pi `tool_call`, `tool_execution_end`, `input`, and `agent_end` events. On agent end, if writes happened, it distills the current working tree diff into a Gradient artifact automatically. Manual distillation is available with `/gradient-distill`.

Current facts:

- `requested`
- `model-initiated`
- `mechanical`
- `file-read-before-edit`
- `blind-edit`
- `new-file`
- `searched-before-edit`
- `tested-after-edit`
- `unchecked-after-edit`
- `rewritten`
