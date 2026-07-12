import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeNote } from "../src/notes.ts";

const cli = resolve(join(dirname(new URL(import.meta.url).pathname), "..", "src", "cli.ts"));

function runCli(args: string[], cwd: string): { stdout: string; stderr: string; status: number } {
  const result = spawnSync(
    "node",
    ["--experimental-strip-types", cli, ...args],
    { cwd, encoding: "utf8", maxBuffer: 10 * 1024 * 1024 }
  );
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "", status: result.status ?? 1 };
}

function initRepo(cwd: string): void {
  assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.email", "test@test.com"], { cwd }).status, 0);
  assert.equal(spawnSync("git", ["config", "user.name", "Test"], { cwd }).status, 0);
  assert.equal(spawnSync("git", ["config", "commit.gpgSign", "false"], { cwd }).status, 0);
}

function git(cwd: string, args: string[]): void {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function gitOut(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

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

  const distill = runCli(["distill", "--events", eventsPath, "--diff", diffPath, "--run-id", "cli-smoke", "--head", "cli-head"], cwd);
  assert.equal(distill.status, 0);
  const artifactPath = distill.stdout.trim();
  assert.match(artifactPath, /\.gradient\/artifacts\/cli-head-cli-smoke\.json$/);

  const show = runCli(["show", artifactPath], cwd);
  assert.equal(show.status, 0);
  assert.match(show.stdout, /requested · read before edit · tested after edit/);

  const annotate = runCli(["annotate-diff", "--artifact", artifactPath, "--diff", diffPath], cwd);
  assert.equal(annotate.status, 0);
  assert.match(annotate.stdout, /# gradient: requested · read before edit · tested after edit/);

  const index = runCli(["index"], cwd);
  assert.equal(index.status, 0);
  assert.equal(JSON.parse(index.stdout)[0].head, "cli-head");

  const find = runCli(["find", "cli-head"], cwd);
  assert.equal(find.status, 0);
  assert.equal(find.stdout.trim(), artifactPath);

  const artifact = JSON.parse(await readFile(artifactPath, "utf8"));
  assert.equal(artifact.hunks[0].path, "src/a.ts");
});

test("find reports note-backed artifacts consistently", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-note-"));
  initRepo(cwd);
  await writeFile(join(cwd, "a.txt"), "hello\n", "utf8");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "initial"]);
  const head = gitOut(cwd, ["rev-parse", "HEAD"]).trim();

  assert.ok(
    writeNote(
      {
        gradientVersion: "0.1",
        runId: "note-find",
        head,
        generatedAt: new Date().toISOString(),
        hunks: []
      },
      cwd
    )
  );

  const found = runCli(["find", "HEAD"], cwd);
  assert.equal(found.status, 0);
  assert.equal(found.stdout.trim(), `note:${head}`);
});

test("show, annotate-diff, notes-write, notes-read, and log work with commits", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-commands-"));
  initRepo(cwd);
  await writeFile(join(cwd, "a.ts"), "old\n", "utf8");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "initial"]);

  await writeFile(join(cwd, "a.ts"), "new\n", "utf8");
  const diffPath = join(cwd, "diff.patch");
  await writeFile(diffPath, gitOut(cwd, ["diff", "--no-ext-diff", "--src-prefix=a/", "--dst-prefix=b/"]), "utf8");
  const eventsPath = join(cwd, "events.json");
  await writeFile(
    eventsPath,
    JSON.stringify([
      { type: "user.request", runId: "cli-commands", time: "2026-07-12T18:00:00.000Z", text: "change a.ts" },
      { type: "file.read", runId: "cli-commands", time: "2026-07-12T18:00:01.000Z", path: "a.ts" },
      { type: "file.write", runId: "cli-commands", time: "2026-07-12T18:00:02.000Z", path: "a.ts", range: { start: 1, end: 1 } },
      { type: "command.run", runId: "cli-commands", time: "2026-07-12T18:00:03.000Z", cmd: "npm test", exitCode: 0 }
    ]),
    "utf8"
  );

  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "change a"]);
  const head = gitOut(cwd, ["rev-parse", "HEAD"]).trim();
  const artifactPath = runCli(["distill", "--events", eventsPath, "--diff", diffPath, "--run-id", "cli-commands", "--head", head], cwd);
  assert.equal(artifactPath.status, 0);

  assert.match(runCli(["notes-write", "--commit", head], cwd).stdout, /Written Gradient note/);
  assert.match(runCli(["notes-read", "HEAD"], cwd).stdout, /Gradient 0.1 · run cli-commands/);
  assert.match(runCli(["show", "HEAD"], cwd).stdout, /read before edit/);
  assert.match(runCli(["annotate-diff", "--commit", "HEAD", "--diff", diffPath], cwd).stdout, /# gradient: requested · read before edit · tested after edit/);
  assert.match(runCli(["log", "--oneline", "--max", "1"], cwd).stdout, /gradient\[1 hunks\]/);
  assert.equal(runCli(["find", head], cwd).stdout.trim(), `note:${head}`);
  assert.match(artifactPath.stdout.trim(), /cli-commands\.json$/);
});

test("install-hooks installs hooks through the CLI", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-hooks-"));
  initRepo(cwd);

  const result = runCli(["install-hooks"], cwd);
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Installed Gradient hooks/);

  const postCommit = await readFile(join(cwd, ".git", "hooks", "post-commit"), "utf8");
  assert.match(postCommit, /Installed by Gradient/);
  assert.match(postCommit, / hook post-commit "\$@"/);
});

test("notes-push and notes-fetch move Gradient notes through a remote", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-notes-"));
  const remote = await mkdtemp(join(tmpdir(), "gradient-cli-notes-remote-"));
  initRepo(cwd);
  git(remote, ["init", "--bare"]);
  git(cwd, ["remote", "add", "origin", remote]);

  await writeFile(join(cwd, "a.txt"), "hello\n", "utf8");
  git(cwd, ["add", "."]);
  git(cwd, ["commit", "-m", "initial"]);
  const head = gitOut(cwd, ["rev-parse", "HEAD"]).trim();

  assert.ok(
    writeNote(
      {
        gradientVersion: "0.1",
        runId: "notes-transport",
        head,
        generatedAt: new Date().toISOString(),
        hunks: []
      },
      cwd
    )
  );

  assert.match(runCli(["notes-push"], cwd).stdout, /Pushed Gradient notes/);
  git(cwd, ["update-ref", "-d", "refs/notes/gradient"]);
  assert.match(runCli(["notes-fetch"], cwd).stdout, /Fetched Gradient notes from origin/);
  assert.match(runCli(["notes-read", "HEAD"], cwd).stdout, /Gradient 0.1 · run notes-transport/);
});

test("demo and help commands render", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-cli-demo-"));
  assert.match(runCli(["--help"], cwd).stdout, /gradient distill/);
  assert.match(runCli(["demo"], cwd).stdout, /Gradient 0.1 · run demo/);
});