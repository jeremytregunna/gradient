import { spawnSync } from "node:child_process";
import { existsSync, statSync } from "node:fs";
import { relative } from "node:path";
import type { CommandRunEvent, FileReadEvent, FileWriteEvent, GradientEvent, SearchEvent } from "./types.ts";

export interface PiToolEvent {
  toolCallId?: string;
  toolName?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
  result?: unknown;
  output?: unknown;
  error?: unknown;
  exitCode?: number;
}

export function eventFromToolCall(event: PiToolEvent, runId: string, cwd: string, time = new Date().toISOString()): GradientEvent[] {
  const tool = normalizeToolName(event.toolName);
  const input = event.input ?? {};

  if (tool === "read") {
    const path = stringValue(input.path);
    return path ? [fileRead(runId, cwd, path, time)] : [];
  }

  if (tool === "write" || tool === "edit") {
    const path = stringValue(input.path);
    return path ? [fileWrite(runId, cwd, path, input, time)] : [];
  }

  if (tool === "grep" || tool === "find" || tool === "ls") {
    const query = stringValue(input.pattern) ?? stringValue(input.query) ?? tool;
    const path = stringValue(input.path);
    const search: SearchEvent = {
      type: "search.run",
      runId,
      time,
      query,
      paths: path ? [repoPath(cwd, path)] : undefined
    };
    return [search];
  }

  return [];
}

export function commandFromToolCall(event: PiToolEvent): string | undefined {
  const tool = normalizeToolName(event.toolName);
  if (tool !== "bash" && tool !== "shell") return undefined;
  const input = event.input ?? event.args ?? {};
  return stringValue(input.command) ?? stringValue(input.cmd);
}

export function commandEvent(cmd: string, event: PiToolEvent, runId: string, time = new Date().toISOString()): CommandRunEvent {
  return {
    type: "command.run",
    runId,
    time,
    cmd,
    exitCode: exitCodeFromEvent(event)
  };
}

export function workingTreeDiff(cwd: string): string {
  const tracked = git(["diff", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--binary", "--unified=3", "HEAD", "--"], cwd, true);
  const staged = git(["diff", "--cached", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/", "--binary", "--unified=3", "HEAD", "--"], cwd, true);
  const untracked = git(["ls-files", "--others", "--exclude-standard"], cwd, true)
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((path) => diffUntrackedFile(cwd, path))
    .filter(Boolean)
    .join("\n");

  return [tracked, staged, untracked].filter((part) => part.trim()).join("\n");
}

export function currentHead(cwd: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function diffUntrackedFile(cwd: string, path: string): string {
  const fullPath = `${cwd}/${path}`;
  if (!existsSync(fullPath) || statSync(fullPath).isDirectory()) return "";
  const result = spawnSync("git", ["diff", "--no-ext-diff", "--no-index", "--src-prefix=a/", "--dst-prefix=b/", "--binary", "--unified=3", "--", "/dev/null", path], {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: gitEnv()
  });
  return result.stdout.replaceAll("a/dev/null", "/dev/null").replaceAll(`b/${path}`, `b/${path}`);
}

function fileRead(runId: string, cwd: string, path: string, time: string): FileReadEvent {
  return {
    type: "file.read",
    runId,
    time,
    path: repoPath(cwd, path)
  };
}

function fileWrite(runId: string, cwd: string, path: string, input: Record<string, unknown>, time: string): FileWriteEvent {
  return {
    type: "file.write",
    runId,
    time,
    path: repoPath(cwd, path),
    range: rangeFromInput(input)
  };
}

function rangeFromInput(input: Record<string, unknown>): { start: number; end: number } | undefined {
  const start = numberValue(input.startLine) ?? numberValue(input.start_line) ?? numberValue(input.line);
  const end = numberValue(input.endLine) ?? numberValue(input.end_line) ?? start;
  return start && end ? { start, end } : undefined;
}

function repoPath(cwd: string, path: string): string {
  if (!path.startsWith("/")) return path;
  const rel = relative(cwd, path);
  return rel.startsWith("..") ? path : rel;
}

function exitCodeFromEvent(event: PiToolEvent): number {
  if (typeof event.exitCode === "number") return event.exitCode;
  const result = event.result as Record<string, unknown> | undefined;
  if (result && typeof result.exitCode === "number") return result.exitCode;
  if ("isError" in event && event.isError) return 1;
  if (event.error) return 1;
  return 0;
}

function normalizeToolName(name: unknown): string {
  return String(name ?? "").toLowerCase().replace(/^.*[./]/, "");
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function git(args: string[], cwd: string, allowFailure = false): string {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 10 * 1024 * 1024,
    env: gitEnv()
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(result.stderr.trim() || `git ${args.join(" ")} failed`);
  }
  return result.stdout;
}

function gitEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env.GIT_EXTERNAL_DIFF;
  delete env.GIT_DIFF_OPTS;
  return {
    ...env,
    GIT_CONFIG_COUNT: "2",
    GIT_CONFIG_KEY_0: "diff.external",
    GIT_CONFIG_VALUE_0: "",
    GIT_CONFIG_KEY_1: "core.pager",
    GIT_CONFIG_VALUE_1: "cat"
  };
}
