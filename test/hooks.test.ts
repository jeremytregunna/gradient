import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { handleHook, installHooks } from "../src/hooks.ts";

test("installHooks installs repo-local hooks when global hooksPath is unusable", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-hooks-"));
  assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);

  // Make the default hooks path unusable so the fallback kicks in
  assert.equal(
    spawnSync("git", ["config", "--local", "core.hooksPath", "/nonexistent/gradient-hooks"], { cwd }).status,
    0
  );

  await installHooks(cwd, "/tmp/gradient-cli.ts");

  const hooksPath = spawnSync("git", ["config", "--local", "--get", "core.hooksPath"], {
    cwd,
    encoding: "utf8"
  }).stdout.trim();
  assert.match(hooksPath, /\.git\/hooks$/);

  for (const hook of ["post-commit", "post-rewrite", "pre-push"]) {
    const body = await readFile(join(cwd, ".git", "hooks", hook), "utf8");
    assert.match(body, /Installed by Gradient/);
    assert.match(body, /gradient-cli\.ts' hook/);
  }
});

test("installHooks chains existing hooks instead of overwriting them", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-hooks-existing-"));
  assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);
  const prePush = join(cwd, ".git", "hooks", "pre-push");
  await writeFile(prePush, "#!/bin/sh\necho existing\n", "utf8");

  await installHooks(cwd, "/tmp/gradient-cli.ts");

  const wrapper = await readFile(prePush, "utf8");
  const previous = await readFile(`${prePush}.gradient-prev`, "utf8");
  assert.match(wrapper, /Installed by Gradient/);
  assert.match(wrapper, /pre-push\.gradient-prev/);
  assert.equal(previous, "#!/bin/sh\necho existing\n");
});

test("handleHook fires non-blocking notes push on pre-push", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-hooks-push-"));
  assert.equal(spawnSync("git", ["init"], { cwd }).status, 0);

  await handleHook("pre-push", cwd, ["upstream"]);

  // The hook runs without blocking. The detached notes push spawns
  // a background process, so we just verify the hook completes.
  const logs = await readdir(join(cwd, ".git", "gradient", "hooks"));
  const hookLog = logs.find((name) => name.includes("pre-push"));
  assert.ok(hookLog);

  const body = await readFile(join(cwd, ".git", "gradient", "hooks", hookLog), "utf8");
  assert.equal(JSON.parse(body).hook, "pre-push");
});
