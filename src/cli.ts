#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { distill } from "./distill.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { handleHook, installHooks } from "./hooks.ts";
import { renderAnnotatedUnifiedDiff, renderArtifact } from "./render.ts";
import { findArtifactForCommit, readArtifact, readArtifactIndex, writeArtifact } from "./storage.ts";
import { writeNote, readNote, pushNotes, fetchNotes } from "./notes.ts";
import type { GradientEvent, GradientFact, GradientArtifact, HunkProjection } from "./types.ts";

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    case "distill":
      if (args.includes("--help")) { printHelpFor("distill"); return; }
      await distillCommand(args);
      return;
    case "show":
      if (args.includes("--help")) { printHelpFor("show"); return; }
      await showCommand(args);
      return;
    case "annotate-diff":
      if (args.includes("--help")) { printHelpFor("annotate-diff"); return; }
      await annotateDiffCommand(args);
      return;
    case "index":
      if (args.includes("--help")) { printHelpFor("index"); return; }
      await indexCommand();
      return;
    case "find":
      if (args.includes("--help")) { printHelpFor("find"); return; }
      await findCommand(args);
      return;
    case "install-hooks":
      if (args.includes("--help")) { printHelpFor("install-hooks"); return; }
      await installHooks(process.cwd(), new URL(import.meta.url).pathname);
      return;
    case "log":
      if (args.includes("--help")) { printHelpFor("log"); return; }
      await logCommand(args);
      return;
    case "notes-write":
      if (args.includes("--help")) { printHelpFor("notes-write"); return; }
      await notesWriteCommand(args);
      return;
    case "notes-read":
      if (args.includes("--help")) { printHelpFor("notes-read"); return; }
      await notesReadCommand(args);
      return;
    case "notes-push":
      if (args.includes("--help")) { printHelpFor("notes-push"); return; }
      await notesPushCommand(args);
      return;
    case "notes-fetch":
      if (args.includes("--help")) { printHelpFor("notes-fetch"); return; }
      await notesFetchCommand(args);
      return;
    case "hook":
      if (args.includes("--help")) { printHelpFor("hook"); return; }
      await handleHook(args[0], process.cwd(), args.slice(1));
      return;
    case "demo":
      if (args.includes("--help")) { printHelpFor("demo"); return; }
      await demoCommand();
      return;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function distillCommand(args: string[]): Promise<void> {
  const eventsPath = valueAfter(args, "--events");
  const diffPath = valueAfter(args, "--diff");
  const runId = valueAfter(args, "--run-id") ?? `run-${Date.now()}`;
  const base = valueAfter(args, "--base");
  const head = valueAfter(args, "--head") ?? gitHead();

  if (!eventsPath || !diffPath) {
    throw new Error("distill requires --events <events.json> and --diff <diff.patch>");
  }

  let eventsText: string;
  try {
    eventsText = await readFile(eventsPath, "utf8");
  } catch (err) {
    throw new Error(`failed to read events file: ${eventsPath}${err instanceof Error ? ": " + err.message : ""}`);
  }
  let events: GradientEvent[];
  try {
    events = JSON.parse(eventsText);
  } catch (err) {
    throw new Error(`failed to parse events JSON: ${eventsPath}${err instanceof Error ? ": " + err.message : ""}`);
  }

  let diffText: string;
  try {
    diffText = await readFile(diffPath, "utf8");
  } catch (err) {
    throw new Error(`failed to read diff file: ${diffPath}${err instanceof Error ? ": " + err.message : ""}`);
  }
  const diff = parseUnifiedDiff(diffText);
  const artifact = distill(events, diff, { runId, base, head });
  const path = await writeArtifact(artifact);
  console.log(path);
}

async function showCommand(args: string[]): Promise<void> {
  const input = args[0];
  if (!input) throw new Error("show requires an artifact path or a commit");

  // If it looks like a file path, read it directly.
  if (input.endsWith(".json")) {
    console.log(renderArtifact(await readArtifact(input)));
    return;
  }

  // Otherwise treat it as a commit: check notes first, then local storage.
  const commit = resolveCommitish(input) ?? gitHead();
  if (!commit) throw new Error(`cannot resolve '${input}' as a commit`);

  let artifact = readNote(commit, process.cwd());
  if (!artifact) {
    const artifactPath = await findArtifactForCommit(commit);
    if (!artifactPath) throw new Error(`no Gradient artifact found for ${commit}`);
    artifact = await readArtifact(artifactPath);
  }
  console.log(renderArtifact(artifact));
}

async function annotateDiffCommand(args: string[]): Promise<void> {
  const artifactPath = valueAfter(args, "--artifact");
  const diffPath = valueAfter(args, "--diff");
  const commitArg = valueAfter(args, "--commit");

  let artifact: GradientArtifact | undefined;
  if (artifactPath) {
    artifact = await readArtifact(artifactPath);
  } else if (commitArg) {
    const commit = resolveCommitish(commitArg) ?? gitHead();
    if (!commit) throw new Error(`cannot resolve '${commitArg}' as a commit`);
    artifact = readNote(commit, process.cwd());
    if (!artifact) {
      const path = await findArtifactForCommit(commit);
      if (!path) throw new Error(`no Gradient artifact found for ${commit}`);
      artifact = await readArtifact(path);
    }
  } else {
    throw new Error("annotate-diff requires --artifact <artifact.json> or --commit <sha>");
  }

  if (!diffPath) throw new Error("annotate-diff requires --diff <diff.patch>");
  if (!artifact) throw new Error("annotate-diff: no artifact found (check --artifact or --commit)");
  const diff = await readFile(diffPath, "utf8");
  console.log(renderAnnotatedUnifiedDiff(diff, artifact));
}

async function indexCommand(): Promise<void> {
  console.log(JSON.stringify(await readArtifactIndex(), null, 2));
}

async function findCommand(args: string[]): Promise<void> {
  const commit = resolveCommitish(args[0]) ?? gitHead();
  if (!commit) throw new Error("find requires a commit or a Git HEAD");

  if (readNote(commit, process.cwd())) {
    console.log(`note:${commit}`);
    return;
  }

  const artifactPath = await findArtifactForCommit(commit);
  if (!artifactPath) throw new Error(`no Gradient artifact found for ${commit}`);
  console.log(artifactPath);
}

async function logCommand(args: string[]): Promise<void> {
  const oneline = args.includes("--oneline");
  const json = args.includes("--json");
  const maxCount = valueAfter(args, "--max") ?? "20";
  const factFilter: GradientFact | undefined = valueAfter(args, "--fact") as GradientFact | undefined;
  const noFact: GradientFact | undefined = valueAfter(args, "--no-fact") as GradientFact | undefined;
  const pathFilter = valueAfter(args, "--path");
  const runIdFilter = valueAfter(args, "--run");
  const sinceFilter = valueAfter(args, "--since");
  const authorFilter = valueAfter(args, "--author");

  // Get list of commits.
  const logArgs: string[] = ["log", `--max-count=${maxCount}`, "--format=%H"];
  if (sinceFilter) logArgs.push(`--since=${sinceFilter}`);
  if (authorFilter) logArgs.push(`--author=${authorFilter}`);
  const logResult = spawnSync("git", logArgs, { encoding: "utf8" });
  if (logResult.status !== 0) throw new Error("failed to read git log");

  const commits = logResult.stdout.trim().split("\n").filter(Boolean);
  if (commits.length === 0) {
    console.log("no commits");
    return;
  }

  const entries: Array<{ commit: string; artifact: GradientArtifact }> = [];

  for (const commit of commits) {
    const artifact = readNote(commit, process.cwd());
    if (!artifact) continue;

    // Filter hunks.
    let filteredHunks = artifact.hunks;
    if (factFilter) {
      filteredHunks = filteredHunks.filter(
        (h) => h.facts.includes(factFilter)
      );
    }
    if (noFact) {
      filteredHunks = filteredHunks.filter(
        (h) => !h.facts.includes(noFact)
      );
    }
    if (pathFilter) {
      filteredHunks = filteredHunks.filter(
        (h) => h.path === pathFilter || h.path.startsWith(pathFilter)
      );
    }
    if (runIdFilter && artifact.runId !== runIdFilter) continue;

    // Skip commits with no matching hunks.
    if (filteredHunks.length === 0) continue;

    entries.push({
      commit: commit.slice(0, 7),
      artifact: { ...artifact, hunks: filteredHunks },
    });
  }

  if (entries.length === 0) {
    console.log("no Gradient notes found for recent commits");
    return;
  }

  if (json) {
    console.log(JSON.stringify(entries, null, 2));
    return;
  }

  const lines: string[] = [];

  for (const { commit: commitShort, artifact } of entries) {
    const facts = artifact.hunks
      .map((h) => `${h.path}:${h.facts.join(",")}`)
      .join("; ");

    if (oneline) {
      lines.push(`${commitShort} gradient[${artifact.hunks.length} hunks] ${facts}`);
    } else {
      lines.push(`${commitShort} gradient · run ${artifact.runId} · ${artifact.hunks.length} hunks`);
      for (const hunk of artifact.hunks) {
        lines.push(`  ${hunk.path}:${hunk.newRange.start}-${hunk.newRange.end}  ${hunk.facts.join(" · ")}`);
      }
    }
  }

  if (lines.length === 0) {
    console.log("no Gradient notes found for recent commits");
    return;
  }

  console.log(lines.join("\n"));
}

async function notesWriteCommand(args: string[]): Promise<void> {
  const head = valueAfter(args, "--commit") ?? gitHead();
  if (!head) throw new Error("notes-write requires a commit (use --commit or be on a branch)");
  const artifactPath = await findArtifactForCommit(head);
  if (!artifactPath) {
    throw new Error(`no Gradient artifact found for ${head}. Run 'gradient distill' first.`);
  }
  const artifact = await readArtifact(artifactPath);
  if (writeNote(artifact, process.cwd())) {
    console.log(`Written Gradient note on ${head}`);
  } else {
    throw new Error(`failed to write note on ${head}`);
  }
}

async function notesReadCommand(args: string[]): Promise<void> {
  const commit = resolveCommitish(args[0]) ?? gitHead();
  if (!commit) throw new Error("notes-read requires a commit");
  const artifact = readNote(commit, process.cwd());
  if (!artifact) throw new Error(`no Gradient note found for ${commit}`);
  console.log(renderArtifact(artifact));
}

async function notesPushCommand(args: string[]): Promise<void> {
  const remote = valueAfter(args, "--remote");
  if (pushNotes(process.cwd(), remote)) {
    console.log(`Pushed Gradient notes${remote ? ` to ${remote}` : ""}`);
  } else {
    throw new Error(`failed to push Gradient notes`);
  }
}

async function notesFetchCommand(args: string[]): Promise<void> {
  const remote = valueAfter(args, "--remote") ?? "origin";
  if (fetchNotes(process.cwd(), remote)) {
    console.log(`Fetched Gradient notes from ${remote}`);
  } else {
    throw new Error(`failed to fetch Gradient notes from ${remote}`);
  }
}

async function demoCommand(): Promise<void> {
  const runId = "demo";
  const events: GradientEvent[] = [
    { type: "file.read", runId, time: "2026-07-12T18:00:00.000Z", path: "src/auth/session.ts" },
    { type: "file.write", runId, time: "2026-07-12T18:01:00.000Z", path: "src/auth/session.ts", range: { start: 42, end: 61 } },
    { type: "file.write", runId, time: "2026-07-12T18:02:00.000Z", path: "src/auth/session.ts", range: { start: 42, end: 61 } },
    { type: "file.write", runId, time: "2026-07-12T18:03:00.000Z", path: "src/auth/session.ts", range: { start: 42, end: 61 } },
    { type: "command.run", runId, time: "2026-07-12T18:04:00.000Z", cmd: "npm test -- session", exitCode: 0 }
  ];
  const patch = `diff --git a/src/auth/session.ts b/src/auth/session.ts
--- a/src/auth/session.ts
+++ b/src/auth/session.ts
@@ -42,3 +42,8 @@ export function sessionFor(user: User) {
-  return createSession(user.id);
+  if (!user.id) {
+    throw new Error("missing user id");
+  }
+
+  return createSession(user.id);
 }
`;

  const artifact = distill(events, parseUnifiedDiff(patch), { runId, base: "demo-base", head: "demo-head" });
  console.log(renderArtifact(artifact));
}

function printHelp(): void {
  console.log(`Gradient

Usage:
  gradient distill --events events.json --diff diff.patch [--run-id id] [--base sha] [--head sha]
  gradient show artifact.json
  gradient annotate-diff --artifact artifact.json --diff diff.patch
  gradient annotate-diff --commit sha --diff diff.patch
  gradient index
  gradient find [commit]
  gradient log [--oneline] [--json] [--max N] [--fact F] [--no-fact F] [--path P] [--run R]
  gradient install-hooks
  gradient notes-write [--commit sha]
  gradient notes-read [commit]
  gradient notes-push [--remote name]
  gradient notes-fetch [--remote name]
  gradient demo

Commands:
  distill            Distill agent trace events + a diff into a Gradient artifact
  show               Display an artifact or the artifact for a commit
  annotate-diff      Annotate a unified diff with Gradient facts from an artifact
  index              Show the artifact index as JSON
  find               Find the artifact (note or local) for a commit
  log                Show Gradient notes for recent commits
  install-hooks      Install Git hooks for automatic notes writing/pushing
  notes-write        Write the current artifact as a Git note on HEAD
  notes-read         Read and display a Git note for a commit
  notes-push         Push the Gradient notes ref to a remote
  notes-fetch        Fetch the Gradient notes ref from a remote
  demo               Run a self-contained demo

Use "gradient <command> --help" for details on a command.
`);
}

function printHelpFor(command: string): void {
  const help: Record<string, string> = {
    "distill": `Distill agent trace events and a unified diff into a Gradient artifact.

Usage:
  gradient distill --events events.json --diff diff.patch [--run-id id] [--base sha] [--head sha]

Options:
  --events   Path to a JSON file of GradientEvent objects
  --diff     Path to a unified diff (.patch)
  --run-id   Optional run identifier (default: run-<timestamp>)
  --base     Optional base commit SHA
  --head     Optional target commit SHA (default: HEAD)

Output:
  Path to the written artifact JSON file.`,
    "show": `Display a Gradient artifact in human-readable format.

Usage:
  gradient show <artifact.json | commit>

If given a .json path, reads the artifact directly.
If given a commit SHA, checks Git notes first, then local storage.

Output:
  Rendered artifact with hunks, facts, and evidence.`,
    "annotate-diff": `Annotate a unified diff with Gradient facts.

Usage:
  gradient annotate-diff --artifact artifact.json --diff diff.patch
  gradient annotate-diff --commit sha --diff diff.patch

Options:
  --artifact  Path to a Gradient artifact JSON file
  --commit    Commit SHA (reads artifact from Git notes or local storage)
  --diff      Path to a unified diff (.patch)

Output:
  Unified diff with inline @@ FACT: fact-list @@ annotations.`,
    "index": `Show the artifact index.

Output:
  JSON array of indexed artifacts with runId, head, and path.`,
    "find": `Find the artifact source for a commit.

Usage:
  gradient find [commit]

Defaults to HEAD. Outputs "note:<commit>" if backed by a Git note,
or the local file path if in storage.`,
    "log": `Show Gradient notes for recent commits.

Usage:
  gradient log [--oneline] [--json] [--max N] [--fact F] [--no-fact F] [--path P] [--run R] [--since D] [--author A]

Options:
  --oneline     One line per commit (file:fact pairs)
  --json        Output as JSON array of {commit, artifact}
  --max N       Show at most N commits (default: 20)
  --fact F      Only show hunks that have fact F
  --no-fact F   Exclude hunks that have fact F
  --path P      Only show hunks in files matching P
  --run R       Only show artifacts from run R
  --since D     Only show commits since date D (git-compatible)
  --author A    Only show commits by author A (git-compatible)

Output:
  Human-readable or JSON summary of Gradient facts on recent commits.`,
    "install-hooks": `Install Git hooks for automatic Gradient notes.

Hooks:
  post-commit  Writes the latest artifact as a Git note
  pre-push     Pushes the notes ref to the remote

The hooks chain to any existing hooks in the same directory.`,
    "notes-write": `Write the current artifact as a Git note.

Usage:
  gradient notes-write [--commit sha]

Options:
  --commit  Target commit (default: HEAD)

Requires an artifact in local storage for the given commit.`,
    "notes-read": `Read and display a Git note for a commit.

Usage:
  gradient notes-read [commit]

Defaults to HEAD.`,
    "notes-push": `Push the Gradient notes ref to a remote.

Usage:
  gradient notes-push [--remote name]

Options:
  --remote  Remote name (default: origin)`,
    "notes-fetch": `Fetch the Gradient notes ref from a remote.

Usage:
  gradient notes-fetch [--remote name]

Options:
  --remote  Remote name (default: origin)`,
      "hook": `Handle a Git hook event.

Usage:
  gradient hook <post-commit|post-rewrite|pre-push> [args...]

This is invoked by the installed Git hooks, not used directly.
  post-commit  Writes the latest artifact as a Git note.
  post-rewrite Rewrites notes for rewritten commits.
  pre-push     Pushes the notes ref to the remote.`,
    "demo": `Run a self-contained demo.

Produces a sample artifact from synthetic events and a diff,
then renders it to stdout.`,
  };

  const text = help[command];
  if (text) {
    console.log(`gradient ${command} --help\n\n${text}`);
  } else {
    console.log(`Unknown command: ${command}. Use "gradient --help" for all commands.`);
  }
}

function valueAfter(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
}

function gitHead(): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function resolveCommitish(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const result = spawnSync("git", ["rev-parse", "--verify", value], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : value;
}

function isMainModule(): boolean {
  return Boolean(process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href);
}

if (isMainModule()) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
