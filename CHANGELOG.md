# Changelog

## [0.1.0] — 2026-07-12

Initial release.

**Core**
- Distill agent trace events + unified diff into Gradient artifacts
- Project trace-attested facts onto each hunk: provenance, blind edits, test evidence, thrash
- Store artifacts in `.git/gradient` or `.gradient` (local fallback)
- Render artifacts in human-readable format or as annotated unified diffs

**Transport**
- Git notes on `refs/notes/gradient` — artifacts travel with commits
- `post-commit` hook auto-writes notes; `pre-push` hook auto-pushes them
- `gradient log` with filters: `--fact`, `--no-fact`, `--path`, `--run`, `--since`, `--author`

**CLI**
- `gradient distill`, `show`, `annotate-diff`, `index`, `find`, `log`
- `gradient notes-write`, `notes-read`, `notes-push`, `notes-fetch`
- `gradient install-hooks`, `demo`, `--help` per command

**Pi extension**
- Captures `read`, `write`, `search`, `bash` tool events
- Auto-distills on `agent_end` if writes occurred
- Manual distill via `/gradient-distill`

**CI**
- GitHub Actions workflow template (`examples/ci-github-actions.yml`)
- Posts Gradient review summary as PR comment