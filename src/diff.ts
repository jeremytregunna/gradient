import { createHash } from "node:crypto";
import type { DiffFile, DiffHunk, HunkIdentity, UnifiedDiff } from "./types.ts";

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

export function parseUnifiedDiff(input: string): UnifiedDiff {
  const lines = input.split(/\r?\n/);
  const files: DiffFile[] = [];
  let currentFile: DiffFile | undefined;
  let currentHunk: DiffHunk | undefined;

  for (const line of lines) {
    if (line.startsWith("diff --git ")) {
      currentHunk = undefined;
      const match = /^diff --git a\/(.+) b\/(.+)$/.exec(line);
      currentFile = {
        oldPath: match?.[1] ?? "",
        newPath: match?.[2] ?? "",
        hunks: []
      };
      files.push(currentFile);
      continue;
    }

    if (line.startsWith("--- ") && currentFile) {
      currentFile.oldPath = cleanDiffPath(line.slice(4));
      continue;
    }

    if (line.startsWith("+++ ") && currentFile) {
      currentFile.newPath = cleanDiffPath(line.slice(4));
      continue;
    }

    const hunkMatch = HUNK_RE.exec(line);
    if (hunkMatch && currentFile) {
      currentHunk = {
        header: line,
        oldStart: Number(hunkMatch[1]),
        oldLines: Number(hunkMatch[2] ?? "1"),
        newStart: Number(hunkMatch[3]),
        newLines: Number(hunkMatch[4] ?? "1"),
        lines: [],
        identity: emptyIdentity()
      };
      currentFile.hunks.push(currentHunk);
      continue;
    }

    if (currentHunk && (/^[ +-]/.test(line) || line.startsWith("\\ No newline"))) {
      currentHunk.lines.push(line);
    }
  }

  for (const file of files) {
    for (const hunk of file.hunks) {
      hunk.identity = stableHunkIdentity(file.newPath, hunk);
    }
  }

  return { files: files.filter((file) => file.hunks.length > 0) };
}

export function stableHunkIdentity(path: string, hunk: DiffHunk): HunkIdentity {
  const changedLines = hunk.lines
    .filter((line) => line.startsWith("+") || line.startsWith("-"))
    .join("\n");
  const contextLines = hunk.lines.filter((line) => line.startsWith(" ")).join("\n");
  const location = `${path}:${hunk.oldStart},${hunk.oldLines}:${hunk.newStart},${hunk.newLines}`;
  const contentHash = sha256(changedLines);
  const locationHash = sha256(location);
  const contextHash = sha256(contextLines);

  return {
    patchId: sha256([path, location, contentHash, contextHash].join("\n")),
    contentHash,
    locationHash,
    contextHash
  };
}

function cleanDiffPath(path: string): string {
  if (path === "/dev/null") return path;
  return path.replace(/^[ab]\//, "");
}

function emptyIdentity(): HunkIdentity {
  return {
    patchId: "",
    contentHash: "",
    locationHash: "",
    contextHash: ""
  };
}

function sha256(value: string): string {
  return `sha256:${createHash("sha256").update(value).digest("hex")}`;
}
