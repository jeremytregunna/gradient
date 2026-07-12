import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { commandEvent, commandFromToolCall, eventFromToolCall, workingTreeDiff } from "../src/pi-capture.ts";

test("converts Pi read/write/search/tool events into Gradient events", () => {
  const cwd = "/repo";
  assert.deepEqual(eventFromToolCall({ toolName: "read", input: { path: "/repo/src/a.ts" } }, "run", cwd, "t"), [
    { type: "file.read", runId: "run", time: "t", path: "src/a.ts" }
  ]);

  assert.deepEqual(
    eventFromToolCall({ toolName: "edit", input: { path: "src/a.ts", startLine: 2, endLine: 4 } }, "run", cwd, "t"),
    [{ type: "file.write", runId: "run", time: "t", path: "src/a.ts", range: { start: 2, end: 4 } }]
  );

  assert.equal(commandFromToolCall({ toolName: "bash", input: { command: "npm test" } }), "npm test");
  assert.deepEqual(commandEvent("npm test", { toolName: "bash", isError: true }, "run", "t"), {
    type: "command.run",
    runId: "run",
    time: "t",
    cmd: "npm test",
    exitCode: 1
  });
});

test("workingTreeDiff includes untracked files", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-pi-capture-"));
  assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
  await writeFile(join(cwd, "a.ts"), "export const a = 1;\n", "utf8");

  const diff = workingTreeDiff(cwd);

  assert.match(diff, /diff --git/);
  assert.match(diff, /\+export const a = 1;/);
});
