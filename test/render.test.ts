import assert from "node:assert/strict";
import test from "node:test";
import { distill } from "../src/distill.ts";
import { parseUnifiedDiff } from "../src/diff.ts";
import { renderAnnotatedUnifiedDiff } from "../src/render.ts";
import type { GradientEvent } from "../src/types.ts";

test("annotates matching unified diff hunks", () => {
  const runId = "render-test";
  const diff = `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
`;
  const events: GradientEvent[] = [
    { type: "file.write", runId, time: "2026-07-12T18:00:00.000Z", path: "src/a.ts", range: { start: 1, end: 1 } }
  ];
  const artifact = distill(events, parseUnifiedDiff(diff), { runId });

  assert.match(renderAnnotatedUnifiedDiff(diff, artifact), /# gradient: model-initiated · blind edit · unchecked/);
});
