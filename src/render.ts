import type { GradientArtifact, GradientFact } from "./types.ts";
import { parseUnifiedDiff } from "./diff.ts";

const LABELS: Record<GradientFact, string> = {
  "file-read-before-edit": "read before edit",
  "blind-edit": "blind edit",
  "tested-after-edit": "tested after edit",
  "unchecked-after-edit": "unchecked",
  "searched-before-edit": "searched",
  "rewritten": "rewritten",
  "model-initiated": "model-initiated",
  "requested": "requested",
  "mechanical": "mechanical"
};

export function renderArtifact(artifact: GradientArtifact): string {
  const lines: string[] = [];
  lines.push(`Gradient ${artifact.gradientVersion} · run ${artifact.runId}`);
  if (artifact.base || artifact.head) lines.push(`range ${artifact.base ?? "?"}..${artifact.head ?? "?"}`);
  lines.push("");

  for (const hunk of artifact.hunks) {
    lines.push(`${hunk.path}:${hunk.newRange.start}-${hunk.newRange.end}`);
    lines.push(`  ${hunk.facts.map((fact) => LABELS[fact]).join(" · ")}`);
    lines.push(`  id ${hunk.identity.patchId}`);
    lines.push(`  ${hunk.hunkHeader}`);
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}

export function renderAnnotatedUnifiedDiff(diffText: string, artifact: GradientArtifact): string {
  const diff = parseUnifiedDiff(diffText);
  const lines = diffText.split(/\r?\n/);
  const annotations = new Map<string, string>();

  for (const hunk of artifact.hunks) {
    annotations.set(hunk.identity.patchId, hunk.facts.map((fact) => LABELS[fact]).join(" · "));
  }

  const hunkIds: string[] = [];
  for (const file of diff.files) {
    for (const hunk of file.hunks) {
      hunkIds.push(hunk.identity.patchId);
    }
  }

  let hunkIndex = 0;
  const output: string[] = [];
  for (const line of lines) {
    output.push(line);
    if (line.startsWith("@@ ")) {
      const id = hunkIds[hunkIndex++];
      const annotation = id ? annotations.get(id) : undefined;
      if (annotation) output.push(`# gradient: ${annotation}`);
    }
  }

  return output.join("\n");
}
