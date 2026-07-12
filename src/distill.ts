import type {
  CommandRunEvent,
  FileReadEvent,
  FileWriteEvent,
  GradientArtifact,
  GradientEvent,
  GradientFact,
  HunkProjection,
  LineRange,
  SearchEvent,
  UnifiedDiff
} from "./types.ts";

export interface DistillOptions {
  runId: string;
  base?: string;
  head?: string;
}

export function distill(events: GradientEvent[], diff: UnifiedDiff, options: DistillOptions): GradientArtifact {
  const reads = events.filter((event): event is FileReadEvent => event.type === "file.read");
  const writes = events.filter((event): event is FileWriteEvent => event.type === "file.write");
  const searches = events.filter((event): event is SearchEvent => event.type === "search.run");
  const commands = events.filter((event): event is CommandRunEvent => event.type === "command.run");
  const requestText = events
    .filter((event) => event.type === "user.request")
    .map((event) => event.text)
    .join("\n");

  const hunks: HunkProjection[] = [];

  for (const file of diff.files) {
    const path = file.newPath;
    const fileWrites = writes.filter((event) => event.path === path);
    const fileReads = reads.filter((event) => event.path === path);
    const fileSearches = searches.filter((event) => !event.paths || event.paths.includes(path));

    for (const hunk of file.hunks) {
      const isNewFile = file.oldPath === "/dev/null";
      const newRange = { start: hunk.newStart, end: hunk.newStart + Math.max(hunk.newLines - 1, 0) };
      const overlappingWrites = fileWrites.filter((event) => !event.range || rangesOverlap(event.range, newRange));
      const firstEditAt = minTime(overlappingWrites.map((event) => event.time));
      const lastEditAt = maxTime(overlappingWrites.map((event) => event.time));
      const readBeforeEdit = Boolean(firstEditAt && fileReads.some((event) => event.time <= firstEditAt));
      const searchBeforeEdit = Boolean(firstEditAt && fileSearches.some((event) => event.time <= firstEditAt));
      const testsAfterEdit = lastEditAt
        ? commands.filter((event) => event.exitCode === 0 && event.time >= lastEditAt && looksLikeCheck(event.cmd)).map((event) => event.cmd)
        : [];
      const provenance = inferProvenance(path, hunk.lines, requestText);

      const facts = factsFor({
        readBeforeEdit,
        searchBeforeEdit,
        testsAfterEdit,
        editCount: overlappingWrites.length,
        provenance,
        isNewFile
      });

      hunks.push({
        commit: options.head,
        path,
        hunkHeader: hunk.header,
        identity: hunk.identity,
        newRange,
        facts,
        evidence: {
          readBeforeEdit,
          searchBeforeEdit,
          testsAfterEdit,
          editCount: overlappingWrites.length,
          provenance,
          firstEditAt,
          lastEditAt
        }
      });
    }
  }

  return {
    gradientVersion: "0.1",
    runId: options.runId,
    base: options.base,
    head: options.head,
    generatedAt: new Date().toISOString(),
    hunks
  };
}

function factsFor(input: {
  readBeforeEdit: boolean;
  searchBeforeEdit: boolean;
  testsAfterEdit: string[];
  editCount: number;
  provenance: "requested" | "model-initiated" | "mechanical";
  isNewFile: boolean;
}): GradientFact[] {
  const facts: GradientFact[] = [input.provenance];

  if (input.isNewFile) {
    facts.push("new-file");
  } else {
    facts.push(input.readBeforeEdit ? "file-read-before-edit" : "blind-edit");
  }
  if (input.searchBeforeEdit) facts.push("searched-before-edit");
  facts.push(input.testsAfterEdit.length > 0 ? "tested-after-edit" : "unchecked-after-edit");

  if (input.editCount >= 3) facts.push("rewritten");

  return [...new Set(facts)];
}

function rangesOverlap(a: LineRange, b: LineRange): boolean {
  return a.start <= b.end && b.start <= a.end;
}

function looksLikeCheck(cmd: string): boolean {
  return /\b(test|spec|check|typecheck|lint|verify|pytest|cargo test|go test|npm test|pnpm test|yarn test)\b/i.test(cmd);
}

function inferProvenance(
  path: string,
  hunkLines: string[],
  requestText: string
): "requested" | "model-initiated" | "mechanical" {
  if (looksMechanical(path, hunkLines)) return "mechanical";
  if (requestMentionsPath(requestText, path)) return "requested";
  return "model-initiated";
}

function looksMechanical(path: string, hunkLines: string[]): boolean {
  if (/\.(lock|snap)$/.test(path)) return true;
  if (/(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|Cargo\.lock|go\.sum)$/.test(path)) return true;

  const changed = hunkLines.filter((line) => line.startsWith("+") || line.startsWith("-"));
  if (changed.length === 0) return false;

  return changed.every((line) => {
    const value = line.slice(1).trim();
    return (
      value === "" ||
      value === "{" ||
      value === "}" ||
      value === ");" ||
      /^import\b/.test(value) ||
      /^export\b.*from\b/.test(value) ||
      /^\/\/ generated\b/i.test(value)
    );
  });
}

function requestMentionsPath(requestText: string, path: string): boolean {
  if (!requestText.trim()) return false;
  const lower = requestText.toLowerCase();
  const normalizedPath = path.toLowerCase();
  const basename = normalizedPath.split("/").at(-1);
  return lower.includes(normalizedPath) || Boolean(basename && lower.includes(basename));
}

function minTime(values: string[]): string | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => (a < b ? a : b));
}

function maxTime(values: string[]): string | undefined {
  return values.length === 0 ? undefined : values.reduce((a, b) => (a > b ? a : b));
}
