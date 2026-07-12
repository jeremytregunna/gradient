/**
 * Gradient — capture Pi tool events and project them onto Git diff hunks.
 *
 * Usage:
 *   pi -e /path/to/git-mms/src/gradient-pi.ts
 *
 * Commands:
 *   /gradient-status   Show captured event counts for this session
 *   /gradient-distill  Distill the current working tree diff now
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { distill } from "./distill.ts";
import { parseUnifiedDiff } from "./diff.ts";
import { renderArtifact } from "./render.ts";
import { writeArtifact } from "./storage.ts";
import {
  currentHead,
  commandEvent,
  commandFromToolCall,
  eventFromToolCall,
  workingTreeDiff
} from "./pi-capture.ts";
import type { GradientEvent } from "./types.ts";

export default function (pi: ExtensionAPI) {
  let ctxRef: any;
  let runId = makeRunId();
  let events: GradientEvent[] = [];
  let toolCounts: Record<string, number> = {};
  let pendingCommands: Map<string, string> = new Map();
  let writesSinceDistill = 0;
  let lastArtifactPath = "";

  async function distillNow(ctx: any, reason: string): Promise<string> {
    const diffText = workingTreeDiff(ctx.cwd);
    if (!diffText.trim()) {
      ctx.ui.notify("Gradient: no working tree diff to distill", "info");
      return "";
    }

    const artifact = distill(events, parseUnifiedDiff(diffText), {
      runId,
      head: currentHead(ctx.cwd)
    });
    lastArtifactPath = await writeArtifact(artifact, ctx.cwd);
    writesSinceDistill = 0;

    ctx.ui.notify(
      `Gradient ${reason}: ${artifact.hunks.length} hunks -> ${lastArtifactPath}`,
      artifact.hunks.length > 0 ? "success" : "info"
    );
    return lastArtifactPath;
  }

  pi.on("session_start", async (_event, ctx) => {
    ctxRef = ctx;
    runId = makeRunId();
    events = [];
    toolCounts = {};
    pendingCommands = new Map();
    writesSinceDistill = 0;
    lastArtifactPath = "";
    ctx.ui.setStatus("gradient", "Gradient capturing");
    ctx.ui.notify("Gradient loaded — capturing reads, writes, searches, and shell checks", "info");
  });

  pi.on("input", async (event: any) => {
    const text = typeof event?.input === "string" ? event.input : typeof event?.text === "string" ? event.text : "";
    if (text.trim()) {
      events.push({
        type: "user.request",
        runId,
        time: new Date().toISOString(),
        text
      });
    }
    return { action: "continue" as const };
  });

  pi.on("tool_call", async (event: any, ctx) => {
    const toolName = String(event.toolName ?? "unknown");
    toolCounts[toolName] = (toolCounts[toolName] ?? 0) + 1;

    const cmd = commandFromToolCall(event);
    if (cmd && event.toolCallId) {
      pendingCommands.set(event.toolCallId, cmd);
    }

    for (const gradientEvent of eventFromToolCall(event, runId, ctx.cwd)) {
      events.push(gradientEvent);
      if (gradientEvent.type === "file.write") writesSinceDistill++;
    }
    return { block: false };
  });

  pi.on("tool_execution_end", async (event: any) => {
    const cmd = event.toolCallId ? pendingCommands.get(event.toolCallId) : commandFromToolCall(event);
    if (cmd) {
      events.push(commandEvent(cmd, event, runId));
      if (event.toolCallId) pendingCommands.delete(event.toolCallId);
    }
  });

  pi.on("tool_result", async (event: any) => {
    const cmd = event.toolCallId ? pendingCommands.get(event.toolCallId) : commandFromToolCall(event);
    if (cmd) {
      events.push(commandEvent(cmd, event, runId));
      if (event.toolCallId) pendingCommands.delete(event.toolCallId);
    }
  });

  pi.on("agent_end", async (_event, ctx) => {
    if (writesSinceDistill === 0) return;
    try {
      await distillNow(ctx, "auto-distill");
    } catch (error) {
      ctx.ui.notify(`Gradient distill failed: ${error instanceof Error ? error.message : String(error)}`, "error");
    }
  });

  pi.registerCommand("gradient-status", {
    description: "Show Gradient capture status",
    handler: async (_args, ctx) => {
      ctxRef = ctx;
      const counts = countEvents(events);
      ctx.ui.notify(
        `Gradient run ${runId}\n` +
          `events: ${events.length}\n` +
          `reads: ${counts.reads}, writes: ${counts.writes}, searches: ${counts.searches}, commands: ${counts.commands}\n` +
          `tools: ${formatToolCounts(toolCounts)}\n` +
          `writes since distill: ${writesSinceDistill}\n` +
          `last artifact: ${lastArtifactPath || "none"}`,
        "info"
      );
    }
  });

  pi.registerCommand("gradient-distill", {
    description: "Distill the current working tree diff into a Gradient artifact",
    handler: async (_args, ctx) => {
      ctxRef = ctx;
      const path = await distillNow(ctx, "manual-distill");
      if (!path) return;
      ctx.ui.notify(renderArtifact(await importArtifact(path)), "info");
    }
  });

  pi.on("session_shutdown", async () => {
    if (!ctxRef || writesSinceDistill === 0) return;
    try {
      await distillNow(ctxRef, "shutdown-distill");
    } catch {
      // Shutdown should not fail the Pi process.
    }
  });
}

async function importArtifact(path: string) {
  const { readArtifact } = await import("./storage.ts");
  return readArtifact(path);
}

function makeRunId(): string {
  return `pi-${Date.now().toString(36)}`;
}

function countEvents(events: GradientEvent[]): { reads: number; writes: number; searches: number; commands: number } {
  return {
    reads: events.filter((event) => event.type === "file.read").length,
    writes: events.filter((event) => event.type === "file.write").length,
    searches: events.filter((event) => event.type === "search.run").length,
    commands: events.filter((event) => event.type === "command.run").length
  };
}

function formatToolCounts(counts: Record<string, number>): string {
  const entries = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
  return entries.length === 0 ? "none" : entries.map(([name, count]) => `${name}:${count}`).join(", ");
}
