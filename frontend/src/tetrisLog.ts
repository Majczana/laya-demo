import type { Engine } from "./engine";
import type { PieceType } from "./tetrisEngine";
import type { Choice, PieceReport, SessionEvent } from "./tetrisSession";

/** What the model was shown and answered for one piece (the log and the decision panel share it). */
export type Decision = Choice & { engine: Engine; serial: number };

export type MoveEntry = {
  kind: "move";
  id: string;
  time: number;
  serial: number;
  piece: PieceType;
  engine: Engine;
  phase: "asking" | "moving" | "placed" | "error";
  choice?: Choice;
  /** Game time from the piece appearing until the answer arrived. */
  answerMs?: number;
  steps?: { rotations: number; shift: number; drop: number };
  /** The bot could not reach the chosen spot and gave up. */
  abandoned?: boolean;
  report?: PieceReport;
};

export type LogEntry =
  | MoveEntry
  | { kind: "game"; id: string; time: number; engine: Engine }
  | { kind: "end"; id: string; time: number; score: number; lines: number };

export const MAX_LOG = 150;

/** Candidate indexes ordered by the model's score, best first. */
export function byScore(decision: Choice): number[] {
  const indexes = decision.candidates.map((_, index) => index);
  const { scores } = decision;
  return scores ? indexes.sort((a, b) => scores[b] - scores[a]) : indexes;
}

/** Folds one session event into the log. Pure, so the React layer only stores the result. */
export function applyEvent(
  log: LogEntry[],
  event: SessionEvent,
  context: { generation: number; engine: Engine; now: number },
): LogEntry[] {
  const idFor = (serial: number) => `${context.generation}:${serial}`;
  const update = (serial: number, change: (entry: MoveEntry) => MoveEntry) =>
    log.map((entry) => (entry.kind === "move" && entry.id === idFor(serial) ? change(entry) : entry));

  switch (event.type) {
    case "spawn":
      if (log.some((entry) => entry.id === idFor(event.serial))) return log;
      return [{
        kind: "move", id: idFor(event.serial), time: context.now, serial: event.serial,
        piece: event.piece, engine: context.engine, phase: "asking",
      }, ...log].slice(0, MAX_LOG);
    case "answer":
      return update(event.serial, (entry) => ({ ...entry, phase: "moving", choice: event.choice, answerMs: event.answerMs, steps: event.steps }));
    case "abandon":
      return update(event.serial, (entry) => ({ ...entry, abandoned: true }));
    case "lock":
      return update(event.report.serial, (entry) => ({ ...entry, phase: "placed", report: event.report }));
    case "over":
      return [{ kind: "end", id: `${context.generation}:end`, time: context.now, score: event.score, lines: event.lines }, ...log].slice(0, MAX_LOG);
  }
}

export function markError(log: LogEntry[], generation: number, serial: number): LogEntry[] {
  return log.map((entry) => (entry.kind === "move" && entry.id === `${generation}:${serial}` ? { ...entry, phase: "error" as const } : entry));
}
