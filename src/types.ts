export type GradientEvent =
  | FileReadEvent
  | FileWriteEvent
  | SearchEvent
  | CommandRunEvent
  | TurnBoundaryEvent
  | UserRequestEvent;

export interface BaseEvent {
  id?: string;
  runId: string;
  time: string;
}

export interface FileReadEvent extends BaseEvent {
  type: "file.read";
  path: string;
}

export interface FileWriteEvent extends BaseEvent {
  type: "file.write";
  path: string;
  range?: LineRange;
}

export interface SearchEvent extends BaseEvent {
  type: "search.run";
  query: string;
  paths?: string[];
}

export interface CommandRunEvent extends BaseEvent {
  type: "command.run";
  cmd: string;
  exitCode: number;
  startedAt?: string;
  completedAt?: string;
}

export interface TurnBoundaryEvent extends BaseEvent {
  type: "turn.start" | "turn.end";
}

export interface UserRequestEvent extends BaseEvent {
  type: "user.request";
  text: string;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface UnifiedDiff {
  files: DiffFile[];
}

export interface DiffFile {
  oldPath: string;
  newPath: string;
  hunks: DiffHunk[];
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: string[];
  identity: HunkIdentity;
}

export interface HunkIdentity {
  patchId: string;
  contentHash: string;
  locationHash: string;
  contextHash: string;
}

export type GradientFact =
  | "file-read-before-edit"
  | "blind-edit"
  | "tested-after-edit"
  | "unchecked-after-edit"
  | "searched-before-edit"
  | "rewritten"
  | "model-initiated"
  | "requested"
  | "mechanical";

export interface HunkProjection {
  commit?: string;
  path: string;
  hunkHeader: string;
  identity: HunkIdentity;
  newRange: LineRange;
  facts: GradientFact[];
  evidence: {
    readBeforeEdit: boolean;
    searchBeforeEdit: boolean;
    testsAfterEdit: string[];
    editCount: number;
    provenance: "requested" | "model-initiated" | "mechanical";
    firstEditAt?: string;
    lastEditAt?: string;
  };
}

export interface GradientArtifact {
  gradientVersion: "0.1";
  runId: string;
  base?: string;
  head?: string;
  generatedAt: string;
  hunks: HunkProjection[];
}
