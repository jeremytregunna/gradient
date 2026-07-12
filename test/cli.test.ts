import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { main } from "../src/cli.ts";

test("cli distill, show, annotate-diff, index, and find work together", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-"));
  const eventsPath = join(cwd, "events.json");
  const diffPath = join(cwd, "diff.patch");

  await writeFile(
    eventsPath,
    JSON.stringify([
      {
        type: "user.request",
        runId: "cli-smoke",
        time: "2026-07-12T18:00:00.000Z",
        text: "change src/a.ts"
      },
      {
        type: "file.read",
        runId: "cli-smoke",
        time: "2026-07-12T18:00:01.000Z",
        path: "src/a.ts"
      },
      {
        type: "file.write",
        runId: "cli-smoke",
        time: "2026-07-12T18:00:02.000Z",
        path: "src/a.ts",
        range: { start: 1, end: 1 }
      },
      {
        type: "command.run",
        runId: "cli-smoke",
        time: "2026-07-12T18:00:03.000Z",
        cmd: "npm test",
        exitCode: 0
      }
    ]),
    "utf8"
  );
  await writeFile(
    diffPath,
    `diff --git a/src/a.ts b/src/a.ts
--- a/src/a.ts
+++ b/src/a.ts
@@ -1,1 +1,1 @@
-old
+new
`,
    "utf8"
  );

  const distill = await runCli(["distill", "--events", eventsPath, "--diff", diffPath, "--run-id", "cli-smoke", "--head", "cli-head"], cwd);
  const artifactPath = distill.trim();
  assert.match(artifactPath, /\.gradient\/artifacts\/cli-head-cli-smoke\.json$/);

  const show = await runCli(["show", artifactPath], cwd);
  assert.match(show, /requested · read before edit · tested after edit/);

  const annotate = await runCli(["annotate-diff", "--artifact", artifactPath, "--diff", diffPath], cwd);
  assert.match(annotate, /# gradient: requested · read before edit · tested after edit/);

  const index = await runCli(["index"], cwd);
  assert.equal(JSON.parse(index)[0].head, "cli-head");

  const find = await runCli(["find", "cli-head"], cwd);
  assert.equal(find.trim(), artifactPath);

  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.equal(artifact.hunks[0].path, "src/a.ts");
});

async function runCli(args: string[], cwd: string): Promise<string> {
  const previousCwd = process.cwd();
  const previousLog = console.log;
  const output: string[] = [];
  console.log = (message?: unknown, ...optional: unknown[]) => {
    output.push([message, ...optional].map(String).join(" "));
  };

  try {
    process.chdir(cwd);
    await main(args);
    return output.join("\n");
  } finally {
    process.chdir(previousCwd);
    console.log = previousLog;
  }
}
