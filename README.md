# Gradient

Gradient projects factual agent trace events onto Git diff hunks so reviewers know where to spend attention.

A machine-authored diff has no **attention gradient**. Every line looks equally plausible, equally smooth, equally unmarked. Gradient fixes this by attaching trace-attested facts to each hunk:

> `src/auth/session.ts:42-49 · model-initiated · blind edit · unchecked`

This tells a reviewer: the model changed this on its own, without reading the file first, and didn't test afterward. That's exactly where to look.

**Evidence, not testimony.** Gradient surfaces only facts the capture layer *observed*. Nothing the model could have written to make itself look good.

## Quick start

```sh
git clone git@github.com:jeremytregunna/gradient.git
cd gradient
npm install
npm run build
npm link
gradient --help
```

Or during development:

```sh
npm run demo
```

## Core workflow

1. **Capture** — an extension or hook records agent events (reads, writes, searches, test runs)
2. **Distill** — `gradient distill` projects those events onto the diff hunks
3. **Transport** — notes are written as Git notes (`refs/notes/gradient`) so they travel with the repo
4. **Review** — `gradient log` shows the attention gradient on recent commits

```text
trace events + diff → distill → git notes → gradient log
```

## Commands

```
gradient distill           Distill events + diff into an artifact
gradient show <commit>     Display an artifact for a commit
gradient annotate-diff     Annotate a diff with Gradient facts
gradient log               Show Gradient notes for recent commits
gradient install-hooks     Install Git hooks (auto-write + auto-push)
gradient notes-write       Write artifact as a Git note on HEAD
gradient notes-read        Read and display a Git note
gradient notes-push        Push notes ref to a remote
gradient notes-fetch       Fetch notes ref from a remote
gradient find <commit>     Find the artifact source for a commit
gradient index             Show the artifact index as JSON
gradient demo              Run a self-contained demo
```

Use `gradient <command> --help` for details.

### Log filters

```sh
gradient log --fact blind-edit       # only hunks with blind-edit
gradient log --no-fact blind-edit    # exclude hunks with blind-edit
gradient log --path src/cli.ts       # only hunks in that file
gradient log --run pi-mridf8u2       # only that run's artifacts
gradient log --since 2026-07-01      # commits after this date
gradient log --author John           # commits by this author
gradient log --json                  # output as JSON
gradient log --oneline               # one line per commit
```

## Git hooks

Install hooks for automatic notes management:

```sh
gradient install-hooks
```

- `post-commit` — writes the latest artifact as a Git note
- `pre-push` — pushes the notes ref to the remote

Hooks chain to any existing hooks in the same directory.

## CI workflow

Copy `examples/ci-github-actions.yml` to `.github/workflows/gradient.yml`. The workflow reads notes from the PR head branch and posts a summary comment on the PR.

## Pi extension

```sh
pi -e /path/to/gradient/src/gradient-pi.ts
```

The extension captures Pi `tool_call`, `tool_execution_end`, `input`, and `agent_end` events. On agent end, it distills the current working tree diff into a Gradient artifact automatically.

Commands:
- `/gradient-status` — show captured event counts
- `/gradient-distill` — manual distillation

## Facts

| Fact | Meaning |
| --- | --- |
| `requested` | Explicitly mentioned in the user's request |
| `model-initiated` | Model decided to change this on its own |
| `mechanical` | Lockfile, import, formatting, generated code |
| `file-read-before-edit` | File was read before editing |
| `blind-edit` | File was edited without being read first |
| `new-file` | Newly created file |
| `searched-before-edit` | Searched for callers/symbols before editing |
| `tested-after-edit` | Test/check command passed after edits |
| `unchecked-after-edit` | No test/check command after edits |
| `rewritten` | Hunk was rewritten 3+ times |