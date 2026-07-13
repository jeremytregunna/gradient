import { access, chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { findArtifactForCommit, readArtifact, readArtifactIndex, storageDir, storageDirs } from "./storage.ts";
import { writeNote } from "./notes.ts";

const HOOKS = ["post-commit", "post-rewrite", "pre-push"] as const;

export async function installHooks(cwd: string, cliPath: string): Promise<void> {
  const hooksDir = await installableHooksDir(cwd);
  if (!hooksDir) throw new Error("not inside a Git repository");

  await mkdir(hooksDir, { recursive: true });

  for (const hook of HOOKS) {
    const path = join(hooksDir, hook);
    await writeHook(path, cliPath, hook);
    await chmod(path, 0o755);
  }

  console.log(`Installed Gradient hooks in ${hooksDir}`);
}

export async function handleHook(hook: string | undefined, cwd: string, hookArgs: string[] = []): Promise<void> {
  if (!hook || !HOOKS.includes(hook as (typeof HOOKS)[number])) {
    throw new Error("hook requires one of: post-commit, post-rewrite, pre-push");
  }

  const dir = storageDir(cwd);
  const gradientDir = dir.startsWith("/") ? dir : join(cwd, dir);
  await mkdir(join(gradientDir, "hooks"), { recursive: true });

  const head = gitHead(cwd) ?? "unknown-head";
  let artifact = await findArtifactForCommit(head, cwd);

  // post-commit: if no artifact for the new HEAD, fall back to the most recent one.
  // The artifact was distilled before the commit, so its head is the previous HEAD.
  if (!artifact) {
    const entries = await readArtifactIndex(cwd);
    const latest = entries.at(-1);
    if (latest) {
      for (const dir of storageDirs(cwd)) {
        const path = join(dir, "artifacts", latest.artifact);
        try {
          await access(path, constants.R_OK);
          artifact = path;
          break;
        } catch {
          // Try the next possible storage location.
        }
      }
    }
  }

  const event = {
    hook,
    head,
    artifact,
    time: new Date().toISOString()
  };

  const path = join(gradientDir, "hooks", `${Date.now()}-${hook}.json`);
  await writeFile(path, `${JSON.stringify(event, null, 2)}\n`, "utf8");

  // post-commit: write the artifact as a git note (for local/offline review)
  if (hook === "post-commit" && artifact) {
    let art = await readArtifact(artifact);
    // Write the note on the new HEAD, not the pre-commit HEAD stored in the artifact.
    if (art.head !== head) {
      art = { ...art, head };
    }
    writeNote(art, cwd);
  }

  // pre-push: push notes ref so CI can read them
  if (hook === "pre-push") {
    const remote = hookArgs[0] ?? "origin";
    pushNotesWithTimeout(remote, cwd);
  }
}

function pushNotesWithTimeout(remote: string, cwd: string): void {
  // Non-blocking notes push — if this hangs (e.g. SSH auth, GitHub receive-pack
  // stall on notes ref), the timeout in the shell wrapper kills it after 5s.
  // We don't wait for the result; the hook must not block the main push.
  spawn("sh", ["-c", `timeout 5 git push "$1" refs/notes/gradient 2>&1 || true`, "sh", remote], {
    cwd,
    detached: true,
    stdio: "ignore",
  }).unref();
}

function gitHooksDir(cwd: string): string | undefined {
  const isWorkTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8"
  });
  if (isWorkTree.status !== 0 || isWorkTree.stdout.trim() !== "true") return undefined;

  const result = spawnSync("git", ["rev-parse", "--git-path", "hooks"], {
    cwd,
    encoding: "utf8"
  });
  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value.startsWith("/") ? value : join(cwd, value);
}

async function installableHooksDir(cwd: string): Promise<string | undefined> {
  const active = gitHooksDir(cwd);
  if (!active) return undefined;
  if (await canWriteDir(active)) return active;

  const local = localHooksDir(cwd);
  if (!local) {
    throw new Error(`configured hooks path is not writable: ${active}`);
  }
  await mkdir(local, { recursive: true });
  if (!(await canWriteDir(local))) {
    throw new Error(
      `configured hooks path is not writable: ${active}\n` +
        `repo-local hooks path is not writable either: ${local}`
    );
  }

  const configured = spawnSync("git", ["config", "--local", "core.hooksPath", local], {
    cwd,
    encoding: "utf8"
  });
  if (configured.status !== 0) {
    throw new Error(
      `configured hooks path is not writable: ${active}\n` +
        `also failed to set local core.hooksPath to ${local}: ${configured.stderr.trim()}`
    );
  }

  return local;
}

function localHooksDir(cwd: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "--absolute-git-dir"], {
    cwd,
    encoding: "utf8"
  });
  if (result.status !== 0) return undefined;
  return join(result.stdout.trim(), "hooks");
}

async function canWriteDir(path: string): Promise<boolean> {
  try {
    await mkdir(path, { recursive: true });
    const probe = join(path, `.gradient-write-test-${process.pid}`);
    await writeFile(probe, "", "utf8");
    await rm(probe);
    return true;
  } catch {
    return false;
  }
}

async function writeHook(path: string, cliPath: string, hook: string): Promise<void> {
  const body = hookBody(cliPath, hook);
  try {
    const existing = await readFile(path, "utf8");
    if (existing.includes("Installed by Gradient")) {
      await writeFile(path, body, "utf8");
      return;
    }

    const previous = `${path}.gradient-prev`;
    await rename(path, previous);
    await writeFile(path, hookBody(cliPath, hook, previous), "utf8");
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      await writeFile(path, body, "utf8");
      return;
    }
    throw error;
  }
}

function hookBody(cliPath: string, hook: string, previous?: string): string {
  const previousBlock = previous
    ? `if [ -x ${shellQuote(previous)} ]; then
  ${shellQuote(previous)} "$@" || exit $?
fi
`
    : "";

  return `#!/bin/sh
# Installed by Gradient. Keep this hook small; all logic lives in the TypeScript CLI.
${previousBlock}node --experimental-strip-types ${shellQuote(cliPath)} hook ${hook} "$@" || true
`;
}

function gitHead(cwd: string): string | undefined {
  const result = spawnSync("git", ["rev-parse", "HEAD"], {
    cwd,
    encoding: "utf8"
  });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}
