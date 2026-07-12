import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import { basename, dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import type { GradientArtifact } from "./types.ts";

export async function writeArtifact(artifact: GradientArtifact, cwd = process.cwd()): Promise<string> {
  const dir = await writableStorageDir(cwd);
  const head = artifact.head ?? "working-tree";
  const path = join(dir, "artifacts", `${head}-${artifact.runId}.json`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  await indexArtifact(cwd, dir, artifact, path);
  return path;
}

export async function readArtifact(path: string): Promise<GradientArtifact> {
  return JSON.parse(await readFile(path, "utf8")) as GradientArtifact;
}

export function storageDir(cwd = process.cwd()): string {
  const gitDir = gitPath(cwd);
  return gitDir ? join(gitDir, "gradient") : join(cwd, ".gradient");
}

export async function writableStorageDir(cwd = process.cwd()): Promise<string> {
  const preferred = storageDir(cwd);
  try {
    await mkdir(preferred, { recursive: true });
    await access(preferred, constants.W_OK);
    return preferred;
  } catch {
    const fallback = join(cwd, ".gradient");
    await mkdir(fallback, { recursive: true });
    return fallback;
  }
}

export interface ArtifactIndexEntry {
  runId: string;
  head?: string;
  base?: string;
  artifact: string;
  generatedAt: string;
}

export async function readArtifactIndex(cwd = process.cwd()): Promise<ArtifactIndexEntry[]> {
  for (const path of indexPaths(cwd)) {
    try {
      return JSON.parse(await readFile(path, "utf8")) as ArtifactIndexEntry[];
    } catch {
      // Try the next possible storage location.
    }
  }
  return [];
}

export async function findArtifactForCommit(commit: string, cwd = process.cwd()): Promise<string | undefined> {
  const entries = await readArtifactIndex(cwd);
  const match = entries.findLast((entry) => entry.head === commit);
  if (!match) return undefined;

  for (const dir of storageDirs(cwd)) {
    const path = join(dir, "artifacts", match.artifact);
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      // Try the next possible storage location.
    }
  }

  return undefined;
}

export async function findLatestArtifact(cwd = process.cwd()): Promise<string | undefined> {
  const entries = await readArtifactIndex(cwd);
  if (entries.length === 0) return undefined;
  const latest = entries[entries.length - 1];

  for (const dir of storageDirs(cwd)) {
    const path = join(dir, "artifacts", latest.artifact);
    try {
      await access(path, constants.R_OK);
      return path;
    } catch {
      // Try the next possible storage location.
    }
  }

  return undefined;
}

async function indexArtifact(cwd: string, dir: string, artifact: GradientArtifact, path: string): Promise<void> {
  const entries = await readArtifactIndex(cwd);
  entries.push({
    runId: artifact.runId,
    head: artifact.head,
    base: artifact.base,
    artifact: basename(path),
    generatedAt: artifact.generatedAt
  });
  const pathToIndex = join(dir, "index.json");
  await mkdir(dirname(pathToIndex), { recursive: true });
  await writeFile(pathToIndex, `${JSON.stringify(entries.slice(-200), null, 2)}\n`, "utf8");
}

function indexPath(cwd: string): string {
  return join(storageDir(cwd), "index.json");
}

function indexPaths(cwd: string): string[] {
  return storageDirs(cwd).map((dir) => join(dir, "index.json"));
}

export function storageDirs(cwd = process.cwd()): string[] {
  return [...new Set([storageDir(cwd), join(cwd, ".gradient")])];
}

function gitPath(cwd: string): string | undefined {
  const isWorkTree = spawnSync("git", ["rev-parse", "--is-inside-work-tree"], {
    cwd,
    encoding: "utf8"
  });
  if (isWorkTree.status !== 0 || isWorkTree.stdout.trim() !== "true") return undefined;

  const result = spawnSync("git", ["rev-parse", "--git-path", "."], {
    cwd,
    encoding: "utf8"
  });

  if (result.status !== 0) return undefined;
  const value = result.stdout.trim();
  return value.length > 0 ? value : undefined;
}
