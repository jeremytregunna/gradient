import { spawnSync } from "node:child_process";
import type { GradientArtifact } from "./types.ts";

const NOTES_REF = "refs/notes/gradient";

const gitNoSignEnv = (base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
  ...base,
  GIT_CONFIG_COUNT: "1",
  GIT_CONFIG_KEY_0: "commit.gpgSign",
  GIT_CONFIG_VALUE_0: "0"
});

export function writeNote(artifact: GradientArtifact, cwd: string): boolean {
  if (!artifact.head) return false;

  const writeResult = spawnSync(
    "git",
    ["notes", "--ref", NOTES_REF, "add", "-f", "-m", JSON.stringify(artifact), artifact.head],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024, env: gitNoSignEnv() }
  );
  return writeResult.status === 0;
}

export function readNote(commit: string, cwd: string): GradientArtifact | undefined {
  const result = spawnSync(
    "git",
    ["notes", "--ref", NOTES_REF, "show", commit],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  if (result.status !== 0 || !result.stdout.trim()) return undefined;
  try {
    return JSON.parse(result.stdout.trim()) as GradientArtifact;
  } catch {
    return undefined;
  }
}

export function pushNotes(remote?: string, cwd: string): boolean {
  const args = ["push"];
  if (remote) {
    args.push(remote);
  }
  args.push(NOTES_REF);
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 });
  return result.status === 0;
}

export function fetchNotes(remote?: string, cwd: string): boolean {
  const remoteName = remote ?? "origin";
  const result = spawnSync(
    "git",
    ["fetch", remoteName, `${NOTES_REF}:${NOTES_REF}`],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  return result.status === 0;
}

export function hasNotesRef(cwd: string): boolean {
  const result = spawnSync(
    "git",
    ["show-ref", "--verify", NOTES_REF],
    { cwd, encoding: "utf8" }
  );
  return result.status === 0;
}
