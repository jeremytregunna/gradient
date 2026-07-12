# Gradient — Product Requirements Document

**Working title.** The name comes from the diagnosis: machine-authored diffs arrive with no *attention gradient*, and the product's job is to restore one.

**Actual title:** Gradient
**Status:** Draft for discussion
**Owner:** TBD
**One-liner:** Project verifiable facts from an agent's execution trace onto the hunks of its pull request, so reviewers know where to look.

---

## 1. Problem

The complaint about AI-generated PRs is usually stated as "they're too large." That's a symptom. The real defect is that **a machine-authored diff has no attention gradient.**

A human's 2,000-line PR still has shape. Commit boundaries mark units of intent. The description says what the author thought they were doing. There is a person to ping. There are comments where they were unsure, hedges in the PR body, a `TODO` where they gave up. A reviewer reads that texture and allocates attention accordingly — and review, past a certain diff size, *is* an attention-allocation problem, not a reading problem.

An agent's diff is uniformly confident everywhere. The scaffolding hunk it emitted without thinking looks exactly like the concurrency fix it agonized over. Every line is equally smooth, equally plausible, equally unmarked. The reviewer has no gradient to descend, so they do one of two things: read everything with equal care (does not scale, does not happen), or skim and approve (happens constantly).

Meanwhile the information that *would* produce the gradient was generated — and then thrown away. The agent knows which files it changed without reading. It knows which hunk it rewrote six times. It knows which edits nobody asked for. All of that is in the trace, and none of it is in the diff.

**The diff is a fixed point.** It is the state that survived; everything that made the process legible has been annihilated in reaching it. That destruction is the product opportunity.

---

## 2. Core principle: evidence, not testimony

The obvious version of this product is "attach the model's reasoning to the code." That version is worse than nothing, and the distinction is the spine of the whole design.

Consider what `git blame` actually gives you: **who** and **when**. Not *why*. It is trustworthy *because* it is a mechanical record rather than a justification. The commit it points at may have a lying message, but blame itself cannot lie.

Model-stated reasoning is not a mechanical record. It is a plausible post-hoc story, and it is the most fluent post-hoc story ever generated. Attach it to a hunk and it *anchors* the reviewer:

> *"This null check handles the hydration path."*

...gets accepted, and the question that should have been asked — *why is `undefined` reaching here at all?* — never gets asked. You have laundered accidental code into intentional code, at scale, in a persuasive voice. Then, when the annotation starts gating merges, agents get tuned to emit reassuring narratives, and the signal is fully captured.

So:

> **Gradient surfaces only facts the capture layer *observed*, never claims the model *authored*.**
> Evidence, not testimony. Anything the model could have written to make itself look good is out of scope by construction.

The model's narrative has exactly one safe use, and it is adversarial: **as a hypothesis to falsify.** If the stated intent for a hunk doesn't match what the hunk does, *that divergence* is a defect signal. Intent is a thing we check against, never a thing we present as explanation.

---

## 3. The signals

Four signals, ranked by expected value per unit of reviewer attention.

| Signal | What it means | Source | Independently recomputable? | May gate a merge? |
| --- | --- | --- | --- | --- |
| **Provenance class** | Was this hunk explicitly requested, model-initiated, or mechanical (imports, formatting, codegen)? | Trace-attested | No | No |
| **Test evidence** | Which test or check commands did the agent run after the relevant edits, and did they pass? | Trace-attested | Partially | No |
| **Blind edits** | Files modified without being read. Symbols whose signature changed without any search for callers. | Trace-attested | No | No |
| **Thrash** | Hunks rewritten N times, or reverted and reapplied, before settling. | Trace-attested | No | No |

Two of these deserve elaboration.

**Provenance class** may justify the product on its own. *Unrequested, non-mechanical* changes are where scope creep and defects concentrate — it is the agent doing something nobody asked for, which is precisely the category a human reviewer is least primed to catch, because it isn't what they came to review.

**Thrash** is the closest thing to the model *admitting it was confused* — and it admits it involuntarily, which is exactly why it can be trusted. Code churn is already an established defect predictor in human code; there is good reason to expect the effect to be sharper for agents, where thrash is unmediated by ego, fatigue, or lunch. It is testimony the model cannot help giving.

**Note the asymmetry in the table.** Test evidence, provenance, thrash, and blind edits are facts about the agent's run. They are useful because the trace saw them happen, but that also means they are not independently authoritative enough to block a merge. CI may separately recompute stronger verification facts — including coverage when a project has usable coverage tooling — but coverage is not the product's core metric and should not be treated as the default proxy for correctness.

---

## 4. Non-goals

Explicit, because each of these is a plausible thing to build and each would sink the product.

- **Not a trace viewer.** The trace is larger than the diff. "Too much to read" is not solved by attaching more to read. **In the successful product, nobody ever opens the trace.** It is an input to a compiler, not a document.
- **Not an explanation layer.** See §2. We do not render model reasoning as authoritative commentary on code.
- **Not a code-quality bot.** We do not opine on whether the code is *good*. We say where the *uncertainty* is. Static analysis, linters, and review agents already occupy the "is this correct" niche; competing there means competing on model quality, and the market is crowded and undifferentiated.
- **Not a replacement for review.** Gradient makes review cheaper to aim. A reviewer who reads nothing still learns nothing.

---

## 5. Architecture

Five stages. Only one of them is *forced* to live where it lives.

```
  CAPTURE          DISTILL            TRANSPORT         RENDER            GATE
  (event layer)    (independent)      (git/artifact)    (diff tools)      (CI)
  ─────────        ───────────        ───────────       ────────          ────
  emit spans   →   project spans  →   attach to git →   inline with  →    block on
  honestly         onto hunks         as metadata        the diff          CI facts only
```

### 5.1 Capture — event-side, and this is information theory, not preference

Thrash, blind edits, test evidence, and provenance class live in intermediate states that **no longer exist by the time a diff exists.** No downstream tool can reconstruct them at any price. If the system that observes agent events does not log them, they are gone forever. This is the one non-negotiable dependency in the product.

Two constraints follow, and they constrain *agent design*, not just PR format:

- **Edits must be patch-shaped.** Full-file rewrites erase provenance. An agent that regenerates whole files cannot be made legible after the fact.
- **Line ranges must be threaded forward** through subsequent edits, rebase-style, or attribution decays to noise by the tenth turn.
- **Verification events must be separated from coverage claims.** "The agent ran `go test ./...` and it passed" is a trace fact. "These changed lines were exercised" is a coverage fact, and only exists when the project emits coverage data that can be mapped back onto the diff.

Do **not** invent a wire format. OpenTelemetry already has GenAI span conventions. The capture layer's entire job is *log honestly, in a standard shape.*

The first capture implementation does not need to be universal. A Gradient extension for the Pi harness is a natural starting point because Pi already exposes an event-driven model to extensions: reads, writes, commands, test runs, and turn boundaries can be observed where they happen. A skill can also work as a lower-friction adapter when the host exposes enough telemetry, especially for Phase 0, but a skill should compile observed events rather than rely on the model's memory of what it did.

Capture should happen in two passes:

- **During the turn:** record mechanical events as they occur: reads, writes, searches, commands, test/check runs, and file-range mutations.
- **At the end of the turn:** distill those events into Gradient facts attached to the final diff.

### 5.2 Distill — independent, and this is the wedge

Projecting spans onto hunks is where all the hard logic lives: threading line ranges through edit chains, classifying provenance, computing churn, diffing stated intent against actual change. It is the piece every harness would otherwise reimplement badly and incompatibly.

It is also the natural seam for a party who owns **neither a harness nor a platform** — which is the strategic point. There are N harnesses and M review surfaces; N×M is the classic shape that should produce a protocol rather than a matrix of integrations. LSP is the model to imitate.

If the harness owns presentation, the predictable outcome is: every vendor ships a proprietary "explain my PR" panel, the trace becomes a lock-in surface, and a reviewer working across three repos sees three incompatible UIs. **Harnesses must be prevented — by the existence of a good open alternative — from owning the view.**

### 5.3 Transport — put the facts where diff tools can find them

Git should be a first-class transport, not just GitHub. The projected facts need to travel with the commits closely enough that any diff renderer can discover them: a GitHub bot, a local CLI, a review UI, or a difftastic-like structural diff viewer.

There are several plausible Git-adjacent carriers, with different tradeoffs:

| Carrier | Good for | Problem |
| --- | --- | --- |
| **Git notes** | Attaching structured metadata to commits without changing commit hashes | Notes are not fetched/pushed by default and are unfamiliar to many teams |
| **In-repo artifact** | Portable, reviewable, works everywhere Git works | Adds files to the tree unless carefully scoped |
| **CI/check artifact** | No repository clutter, natural for hosted PRs | Weak local/offline story |
| **Local hook-managed cache** | Local diff tools can discover metadata automatically; no commit pollution | Needs install/setup and a sync story for hosted review |

The likely shape is a small Git-addressed artifact: facts are keyed by commit object, file path, and stable patch identity rather than by GitHub PR comment IDs. A renderer then joins that artifact with whatever diff it is showing.

Example, deliberately schematic:

```json
{
  "gradient_version": "0.1",
  "base": "7f3c...",
  "head": "b91a...",
  "hunks": [
    {
      "commit": "b91a...",
      "path": "src/auth/session.ts",
      "identity": {
        "patch_id": "sha256:...",
        "content_hash": "sha256:...",
        "location_hash": "sha256:...",
        "context_hash": "sha256:..."
      },
      "facts": ["model-initiated", "tested-after-edit", "rewritten-3x"]
    }
  ]
}
```

The exact carrier can vary by workflow, but the addressing model should not. Gradient metadata should be renderable by local tools without requiring GitHub, and renderable by GitHub without requiring a local tool.

Commit trailers are a poor fit for the real artifact. They are commit-scoped, human-facing, and too small for hunk-level facts. They may be tolerable as a throwaway Phase 0 breadcrumb, but they should not shape the design.

A more promising local path is hook-managed metadata:

- a `post-commit` or `post-rewrite` hook records which Gradient artifact corresponds to the new commit;
- a `pre-push` hook can upload or bundle artifacts for hosted review;
- a local `gradient diff` or difftastic-style renderer can read from `.git`-scoped metadata without adding files to the repository tree;
- CI can accept the same artifact as an uploaded build/check artifact.

That keeps the evidence close to Git while avoiding commit-message abuse.

### 5.4 Render — use the reviewer's existing attention primitive

The instinct is to build a new review surface. Resist it. GitHub already has an attention mechanism that reviewers are trained on: **inline review comments and the checks API.**

A bot that reads the artifact and drops

> `model-initiated · untested · rewritten 4×`

...as an inline comment **on the exact hunk** is using the platform's native primitive, degrades gracefully when the artifact is missing, and requires the reviewer to learn nothing.

Long-term this belongs *in* the platform — provenance is a PR-level concept and GitHub could make it universal by fiat. But platforms move slowly and will not adopt a spec with zero users. Worth pricing in: **GitHub ships Copilot.** "Highlight the untested model-initiated hunks" is a feature that makes their own agent look worse before it makes it trustworthy. Do not build a roadmap that depends on them shipping it soon.

A local renderer is just as important. A difftastic-like tool should be able to read Gradient metadata and present structural diffs with risk markers attached to the relevant changed region:

> `model-initiated · untested · rewritten 4×`

That makes Gradient usable before a PR exists, during local review, in terminal workflows, and on platforms that never adopt native support.

### 5.5 Reviewer — dumb pipe, smart client

Thresholds and filters stay client-side. *"Hide formatting hunks; always show me anything under `auth/`; I don't care about thrash below 3×"* is personal, team-specific, and evolving. Any single baked-in view will be wrong for everyone. Ship defaults; make them cheap to override.

---

## 6. The gating rule

> **Only signals that can be independently recomputed may block a merge.
> Trace-attested signals may route attention and nothing more.**

Trace-attested signals may not gate. This includes test evidence: an agent running tests is useful review context, but it is still a fact reported by the same execution path that produced the code.

CI-recomputed checks may gate: test suites, linters, typechecks, security scanners, and changed-line coverage when a repo has reliable coverage instrumentation. Coverage reports are not standardized across languages or tools, and coverage is not correctness anyway, so Gradient should treat coverage as one possible CI fact rather than the privileged metric.

Provenance, thrash, and blind edits are visible only to the event layer that observed the run, and nobody can fully check its work after the fact.

Let those gate, and the system that *produces* the code also produces the *evidence used to judge it*, with a binary pass/fail to optimize against. That is a training signal for agents that write reassuring traces. It is the §2 failure mode wearing a lanyard.

This rule is a constraint on the product, not a limitation of the current version. It does not relax as the signals improve.

---

## 7. Sequencing

### Phase 0 — Answer the killer question first, with no new infrastructure

The largest risk is not technical. It is that **reviewers ignore the annotations**, exactly as they ignore linter noise. If that's true, everything downstream is wasted. It is testable this month, with zero protocol work:

- Have the agent **commit at every coherent step**, with real messages. `git blame` then already points at step-level intent, for free.
- Store projected facts in a local Git-scoped Gradient artifact, optionally managed by hooks.
- Record **test/check commands from the trace**, including whether they passed.
- When a repo already has usable coverage output, optionally map changed lines to that coverage report.
- Put all of it in inline comments on ~50 real PRs across 3–5 teams.

**Measure:** do reviewers' comments cluster on flagged hunks? Does time-to-first-comment on a flagged hunk drop? Do they say the flags helped, one week later, unprompted?

**Kill criterion:** if annotated hunks attract no more reviewer attention than unannotated ones, the thesis is wrong and no amount of protocol work will save it. Stop here.

### Phase 1 — The distiller and the artifact

Only if Phase 0 clears. Formalize span → hunk projection. Publish the artifact schema. Ship the GitHub bot. One harness integration, done properly, in the open.

### Phase 2 — The protocol

Second and third harness integrations; that's when the spec earns the name. Push for native platform rendering once there are users to point at.

---

## 8. Risks

| Risk | Why it's real | Mitigation |
| --- | --- | --- |
| **Annotation blindness** | Every previous attempt to decorate diffs (linters, coverage bots, security scanners) ended as wallpaper. | Phase 0 tests this before we build anything. Ruthless precision over recall — a flag on 40% of hunks is wallpaper; a flag on 5% is a signal. |
| **Gaming** | Anything that gates a merge gets optimized for. | The §6 rule. Prefer signals the model cannot author. |
| **Capture dishonesty** | A harness or adapter could under-report blind edits to look good. | Publish honesty as a spec conformance property. Independent parties can spot-check provenance against `git` history for the subset that's checkable. |
| **Provenance decay** | Long agent sessions with many rewrites degrade line attribution toward noise. | Patch-shaped edits; rebase-style forward threading; report attribution confidence and drop low-confidence flags rather than showing them. |
| **We're solving a problem that PR size limits solve better** | "Just make the agent open smaller PRs" is a real alternative. | Partly true, and worth saying out loud. But provenance and thrash are useful *within* a small PR too, and small PRs don't tell you which of the 200 lines nobody asked for. |

---

## 9. Open questions

1. **Is provenance class actually cleanly separable?** "Explicitly requested" is fuzzy when the request was *"fix the flaky test"* and the agent decided that meant refactoring the scheduler. Where's the boundary between following an instruction and inventing scope?
2. **What's the right thrash threshold?** Needs calibration against real defect data before it's a flag rather than a hunch.
3. **Which CI facts are worth rendering?** Test/check execution from the trace is cheap and universal. Changed-line coverage is stronger when available, but coverage formats are not standard and coverage is not the same as correctness.
4. **Do we handle the multi-agent case?** Provenance across a planner + N workers is a harder attribution problem and may need a different model entirely.

---

## 10. Success metrics

- **Primary:** defect escape rate on agent-authored PRs, versus a control that ships the same code with no annotations. This is the only metric that matters and the only one that's hard to fake.
- **Secondary:** reviewer comment density on flagged vs. unflagged hunks — the direct test of whether the gradient works.
- **Secondary:** review time per KLOC on agent PRs, which should *fall* as attention is aimed rather than spread.
- **Guardrail:** flag rate per PR. If it climbs above ~10% of hunks, the product is degenerating into wallpaper and precision must be tightened even at the cost of recall.
