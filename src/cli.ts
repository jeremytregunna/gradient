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
import type { GradientEvent } from "./types.ts";

export async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv;

  switch (command) {
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    case "distill":
      await distillCommand(args);
      return;
    case "show":
      await showCommand(args);
      return;
    case "annotate-diff":
      await annotateDiffCommand(args);
      return;
    case "index":
      await indexCommand();
      return;
    case "find":
      await findCommand(args);
      return;
    case "install-hooks":
      await installHooks(process.cwd(), new URL(import.meta.url).pathname);
      return;
    case "log":
      await logCommand(args);
      return;
    case "notes-write":
      await notesWriteCommand(args);
      return;
    case "notes-read":
      await notesReadCommand(args);
      return;
    case "notes-push":
      await notesPushCommand(args);
      return;
    case "notes-fetch":
      await notesFetchCommand(args);
      return;
    case "hook":
      await handleHook(args[0], process.cwd(), args.slice(1));
      return;
    case "demo":
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

  const events = JSON.parse(await readFile(eventsPath, "utf8")) as GradientEvent[];
  const diff = parseUnifiedDiff(await readFile(diffPath, "utf8"));
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

  const { readNote } = await import("./notes.ts");
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

  let artifact;
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

  // Get list of commits.
  const logResult = spawnSync(
    "git",
    ["log", `--max-count=${maxCount}`, "--format=%H"],
    { encoding: "utf8" }
  );
  if (logResult.status !== 0) throw new Error("failed to read git log");

  const commits = logResult.stdout.trim().split("\n").filter(Boolean);
  if (commits.length === 0) {
    console.log("no commits");
    return;
  }

  const entries: Array<{ commit: string; artifact: any }> = [];

  for (const commit of commits) {
    const artifact = readNote(commit, process.cwd());
    if (!artifact) continue;
    entries.push({ commit: commit.slice(0, 7), artifact });
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
  const { renderArtifact } = await import("./render.ts");
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
  gradient log [--oneline] [--max N]
  gradient install-hooks
  gradient notes-write [--commit sha]
  gradient notes-read [commit]
  gradient notes-push [--remote name]
  gradient notes-fetch [--remote name]
  gradient demo
`);
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
