import { chmod, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { findArtifactForCommit, storageDir } from "./storage.ts";

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

export async function handleHook(hook: string | undefined, cwd: string): Promise<void> {
  if (!hook || !HOOKS.includes(hook as (typeof HOOKS)[number])) {
    throw new Error("hook requires one of: post-commit, post-rewrite, pre-push");
  }

  const dir = storageDir(cwd);
  await mkdir(join(dir, "hooks"), { recursive: true });

  const head = gitHead(cwd) ?? "unknown-head";
  const artifact = await findArtifactForCommit(head, cwd);
  const event = {
    hook,
    head,
    artifact,
    time: new Date().toISOString()
  };

  const path = join(dir, "hooks", `${Date.now()}-${hook}.json`);
  await writeFile(path, `${JSON.stringify(event, null, 2)}\n`, "utf8");
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
${previousBlock}node --experimental-strip-types ${shellQuote(cliPath)} hook ${hook} "$@"
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
