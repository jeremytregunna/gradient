import assert from "node:assert/strict";
import test from "node:test";
import { distill } from "../src/distill.ts";
import { parseUnifiedDiff } from "../src/diff.ts";
import type { GradientEvent } from "../src/types.ts";

test("distills trace events onto changed hunks", () => {
  const runId = "test-run";
  const events: GradientEvent[] = [
    { type: "user.request", runId, time: "2026-07-12T17:59:00.000Z", text: "Update src/a.ts" },
    { type: "file.read", runId, time: "2026-07-12T18:00:00.000Z", path: "src/a.ts" },
    { type: "search.run", runId, time: "2026-07-12T18:00:10.000Z", query: "callers", paths: ["src/a.ts"] },
    { type: "file.write", runId, time: "2026-07-12T18:01:00.000Z", path: "src/a.ts", range: { start: 1, end: 3 } },
    { type: "command.run", runId, time: "2026-07-12T18:02:00.000Z", cmd: "npm test", exitCode: 0 }
  ];
  const diff = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
`);

  const artifact = distill(events, diff, { runId, head: "abc" });

  assert.equal(artifact.hunks.length, 1);
  assert.deepEqual(artifact.hunks[0]?.facts, [
    "requested",
    "file-read-before-edit",
    "searched-before-edit",
    "tested-after-edit"
  ]);
  assert.match(artifact.hunks[0]?.identity.patchId ?? "", /^sha256:/);
});

test("marks blind unchecked edits", () => {
  const runId = "test-run";
  const events: GradientEvent[] = [
    { type: "file.write", runId, time: "2026-07-12T18:01:00.000Z", path: "src/a.ts", range: { start: 1, end: 3 } }
  ];
  const diff = parseUnifiedDiff(`diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
`);

  const artifact = distill(events, diff, { runId });

  assert.ok(artifact.hunks[0]?.facts.includes("blind-edit"));
  assert.ok(artifact.hunks[0]?.facts.includes("unchecked-after-edit"));
});

test("marks lockfile hunks as mechanical", () => {
  const runId = "test-run";
  const events: GradientEvent[] = [
    { type: "file.write", runId, time: "2026-07-12T18:01:00.000Z", path: "package-lock.json", range: { start: 1, end: 3 } }
  ];
  const diff = parseUnifiedDiff(`diff --git a/package-lock.json b/package-lock.json
--- a/package-lock.json
+++ b/package-lock.json
@@ -1,1 +1,1 @@
-{"lockfileVersion": 2}
+{"lockfileVersion": 3}
`);

  const artifact = distill(events, diff, { runId });

  assert.ok(artifact.hunks[0]?.facts.includes("mechanical"));
});
