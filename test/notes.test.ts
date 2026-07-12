import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { writeNote, readNote, hasNotesRef } from "../src/notes.ts";
import type { GradientArtifact } from "../src/types.ts";

test("writeNote and readNote roundtrip", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-notes-"));
  spawnSync("git", ["init"], { cwd });
  spawnSync("git", ["config", "user.email", "test@test.com"], { cwd });
  spawnSync("git", ["config", "user.name", "Test"], { cwd });
  spawnSync("git", ["config", "commit.gpgSign", "false"], { cwd });

  // Create a commit to attach the note to.
  await writeFile(join(cwd, "a.txt"), "hello\n", "utf8");
  spawnSync("git", ["add", "."], { cwd });
  spawnSync("git", ["commit", "-m", "initial"], { cwd });

  const head = spawnSync("git", ["rev-parse", "HEAD"], { cwd, encoding: "utf8" }).stdout.trim();

  const artifact: GradientArtifact = {
    gradientVersion: "0.1",
    runId: "notes-test",
    head,
    base: undefined,
    generatedAt: new Date().toISOString(),
    hunks: [
      {
        path: "a.txt",
        hunkHeader: "@@ -1 +1 @@",
        identity: { patchId: "sha256:abc", contentHash: "sha256:abc", locationHash: "sha256:def", contextHash: "sha256:def" },
        newRange: { start: 1, end: 1 },
        facts: ["model-initiated", "blind-edit"],
        evidence: {
          readBeforeEdit: false,
          searchBeforeEdit: false,
          testsAfterEdit: [],
          editCount: 1,
          provenance: "model-initiated"
        }
      }
    ]
  };

  assert.ok(writeNote(artifact, cwd));
  assert.ok(hasNotesRef(cwd));

  const read = readNote(head, cwd);
  assert.equal(read?.gradientVersion, artifact.gradientVersion);
  assert.equal(read?.runId, artifact.runId);
  assert.equal(read?.head, artifact.head);
  assert.deepEqual(read?.hunks, artifact.hunks);

  const updated = { ...artifact, runId: "notes-test-updated" };
  assert.ok(writeNote(updated, cwd));
  assert.equal(readNote(head, cwd)?.runId, "notes-test-updated");
});

test("readNote returns undefined when no note exists", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "gradient-notes-empty-"));
  spawnSync("git", ["init"], { cwd });

  const read = readNote("nonexistent", cwd);
  assert.equal(read, undefined);
});
