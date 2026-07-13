// Gradient — re-exports for library consumers.
//
//   import { distill, parseUnifiedDiff, renderArtifact } from "gradient";
//   import type { GradientArtifact, GradientEvent, GradientFact } from "gradient";

export type {
  BaseEvent,
  CommandRunEvent,
  DiffFile,
  DiffHunk,
  FileReadEvent,
  FileWriteEvent,
  GradientArtifact,
  GradientEvent,
  GradientFact,
  HunkIdentity,
  HunkProjection,
  LineRange,
  SearchEvent,
  TurnBoundaryEvent,
  UnifiedDiff,
  UserRequestEvent
} from "./types.ts";

export { distill } from "./distill.ts";
export { parseUnifiedDiff } from "./diff.ts";
export {
  installHooks,
  handleHook
} from "./hooks.ts";
export {
  writeNote,
  readNote,
  pushNotes,
  fetchNotes,
  hasNotesRef
} from "./notes.ts";
export {
  renderArtifact,
  renderAnnotatedUnifiedDiff
} from "./render.ts";
export {
  writeArtifact,
  readArtifact,
  findArtifactForCommit,
  findLatestArtifact,
  storageDir,
  writableStorageDir,
  readArtifactIndex,
  storageDirs
} from "./storage.ts";