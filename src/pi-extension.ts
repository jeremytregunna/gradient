import { distill } from "./distill.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { writeArtifact } from "./storage.ts";
import type { GradientArtifact, GradientEvent } from "./types.ts";

export interface PiGradientRunInput {
  runId: string;
  events: GradientEvent[];
  unifiedDiff: string;
  base?: string;
  head?: string;
  cwd?: string;
}

export async function recordPiRun(input: PiGradientRunInput): Promise<{
  artifact: GradientArtifact;
  path: string;
}> {
  const artifact = distill(input.events, parseUnifiedDiff(input.unifiedDiff), {
    runId: input.runId,
    base: input.base,
    head: input.head
  });
  const path = await writeArtifact(artifact, input.cwd);
  return { artifact, path };
}

