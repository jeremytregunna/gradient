#!/usr/bin/env -S node --experimental-strip-types
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";
import { distill } from "./distill.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { handleHook, installHooks } from "./hooks.ts";
import { renderAnnotatedUnifiedDiff, renderArtifact } from "./render.ts";
import { findArtifactForCommit, readArtifact, readArtifactIndex, writeArtifact } from "./storage.ts";
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
    case "hook":
      await handleHook(args[0], process.cwd());
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
  const artifactPath = args[0];
  if (!artifactPath) throw new Error("show requires an artifact path");
  console.log(renderArtifact(await readArtifact(artifactPath)));
}

async function annotateDiffCommand(args: string[]): Promise<void> {
  const artifactPath = valueAfter(args, "--artifact");
  const diffPath = valueAfter(args, "--diff");
  if (!artifactPath || !diffPath) {
    throw new Error("annotate-diff requires --artifact <artifact.json> and --diff <diff.patch>");
  }
  const artifact = await readArtifact(artifactPath);
  const diff = await readFile(diffPath, "utf8");
  console.log(renderAnnotatedUnifiedDiff(diff, artifact));
}

async function indexCommand(): Promise<void> {
  console.log(JSON.stringify(await readArtifactIndex(), null, 2));
}

async function findCommand(args: string[]): Promise<void> {
  const commit = resolveCommitish(args[0]) ?? gitHead();
  if (!commit) throw new Error("find requires a commit or a Git HEAD");
  const artifact = await findArtifactForCommit(commit);
  if (!artifact) throw new Error(`no Gradient artifact found for ${commit}`);
  console.log(artifact);
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
  gradient index
  gradient find [commit]
  gradient install-hooks
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
