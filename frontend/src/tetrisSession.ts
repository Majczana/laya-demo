/**
 * Real-time Tetris session for testing a decision model live.
 *
 * The clock never waits for the model. A piece falls at the current gravity
 * and locks where it rests once the lock delay runs out, whether or not the
 * model has answered. When the answer arrives a bot "presses keys" at a fixed
 * rate to steer the piece to the chosen landing; if the piece is already too
 * low, or its path is blocked, the bot gives up and the piece lands wherever
 * gravity puts it. Gravity speeds up as pieces are placed, so a model that
 * answers too slowly ends up with pieces piled on top of each other.
 *
 * Nothing here touches the DOM or the network: the caller advances time with
 * `tick`, asks `takeRequest` what to send the model and hands the answer to
 * `receive`. The browser demo and `scripts/tetris-live.mts` share this module.
 * Imports end in `.ts` so Node can run it directly.
 */
import {
  boardFeatures,
  candidatePlacements,
  canFall,
  ghostY,
  lockActive,
  move,
  newGame,
  rotate,
  shortlistPlacements,
  togglePause,
  type GameState,
  type PieceType,
  type Placement,
} from "./tetrisEngine.ts";

export type Settings = {
  /** Starting gravity: milliseconds for the piece to fall one row. */
  gravityMs: number;
  /** Gravity speeds up after this many placed pieces; 0 keeps it constant. */
  rampEvery: number;
  /** Each speed-up multiplies the milliseconds per row by this factor (below 1). */
  rampFactor: number;
  minGravityMs: number;
  /** The bot presses one key (rotate, left or right) this often. */
  inputMs: number;
  /** A resting piece locks after this long. */
  lockDelayMs: number;
  /** Milliseconds per row once the piece is lined up and the bot drops it. */
  dropMs: number;
  /** How many of the engine's ranked moves the model chooses from. */
  candidates: number | "all";
};

export const DEFAULT_SETTINGS: Settings = {
  gravityMs: 600,
  rampEvery: 5,
  rampFactor: 0.85,
  minGravityMs: 25,
  inputMs: 70,
  lockDelayMs: 400,
  dropMs: 18,
  candidates: 4,
};

/** What the model answered for one piece. */
export type Choice = {
  candidates: Placement[];
  chosen: number;
  /** null when there was only one legal move and the model was not asked. */
  scores: number[] | null;
  descriptions: string[] | null;
  /** Compute time reported by the backend. */
  modelMs: number | null;
};

/** on-target: locked exactly where the model chose. off-target: an answer came, but the piece
 *  landed elsewhere (too late or blocked). unanswered: it locked before any answer. */
export type Outcome = "on-target" | "off-target" | "unanswered";

export type PieceReport = {
  serial: number;
  piece: PieceType;
  gravityMs: number;
  /** Time from spawn until the piece would lock if nothing steered it. */
  budgetMs: number;
  /** Game time from spawn until the answer arrived; null if none did. */
  answerMs: number | null;
  modelMs: number | null;
  asked: boolean;
  outcome: Outcome;
  cleared: number;
  /** Rows the piece had already fallen when the answer arrived. */
  fallenAtAnswer: number | null;
};

export type SessionEvent =
  | { type: "spawn"; serial: number; piece: PieceType; gravityMs: number; budgetMs: number }
  | { type: "answer"; serial: number; choice: Choice; answerMs: number; steps: { rotations: number; shift: number; drop: number } }
  | { type: "abandon"; serial: number }
  | { type: "lock"; report: PieceReport }
  | { type: "over"; score: number; lines: number };

export type Session = {
  settings: Settings;
  game: GameState;
  /** Game time in milliseconds; only `tick` advances it. */
  clock: number;
  gravityMs: number;
  spawnedAt: number;
  budgetMs: number;
  startRow: number;
  fallTimer: number;
  restTimer: number;
  inputTimer: number;
  /** The piece is lined up and dropping fast. */
  dropping: boolean;
  requested: boolean;
  choice: Choice | null;
  answeredAt: number | null;
  fallenAtAnswer: number | null;
  plan: { target: Placement; blocked: number } | null;
  reports: PieceReport[];
  /** Answers that arrived after their piece had already locked. */
  lateAnswers: number;
  /** Bumps whenever the board or the moving piece changes. */
  version: number;
  events: SessionEvent[];
};

export type ModelRequest = {
  serial: number;
  candidates: Placement[];
  board: Pick<Placement, "holes" | "maxHeight" | "bumpiness">;
};

const STEP_MS = 5;
const MAX_REPORTS = 500;
/** The bot gives up after this many consecutive blocked key presses. */
const MAX_BLOCKED = 3;

export function gravityFor(settings: Settings, placed: number): number {
  const raised = settings.rampEvery > 0 ? Math.floor(placed / settings.rampEvery) : 0;
  return Math.max(settings.minGravityMs, Math.round(settings.gravityMs * settings.rampFactor ** raised));
}

export function createSession(settings: Settings = DEFAULT_SETTINGS, game: GameState = newGame()): Session {
  const session: Session = {
    settings, game, clock: 0, gravityMs: settings.gravityMs, spawnedAt: 0, budgetMs: 0, startRow: 0,
    fallTimer: 0, restTimer: 0, inputTimer: 0, dropping: false, requested: false, choice: null,
    answeredAt: null, fallenAtAnswer: null, plan: null, reports: [], lateAnswers: 0, version: 0, events: [],
  };
  beginPiece(session);
  return session;
}

function beginPiece(s: Session): void {
  const { active, board } = s.game;
  s.gravityMs = gravityFor(s.settings, s.game.pieceSerial - 1);
  s.spawnedAt = s.clock;
  s.startRow = active.y;
  s.budgetMs = (ghostY(board, active) - active.y) * s.gravityMs + s.settings.lockDelayMs;
  s.fallTimer = 0;
  s.restTimer = 0;
  s.inputTimer = 0;
  s.dropping = false;
  s.requested = false;
  s.choice = null;
  s.answeredAt = null;
  s.fallenAtAnswer = null;
  s.plan = null;
  s.version++;
  s.events.push({ type: "spawn", serial: s.game.pieceSerial, piece: active.type, gravityMs: s.gravityMs, budgetMs: s.budgetMs });
}

/** What to ask the model for the current piece, or null if it was asked already or needs no answer. */
export function takeRequest(s: Session): ModelRequest | null {
  const { game } = s;
  if (game.status !== "playing" || s.requested || s.choice) return null;
  s.requested = true;
  s.version++;
  const all = candidatePlacements(game.board, game.active, game.queue[0]);
  const limit = s.settings.candidates === "all" ? all.length : s.settings.candidates;
  const candidates = shortlistPlacements(all, limit);
  if (candidates.length === 0) {
    s.game = { ...game, status: "over" };
    s.events.push({ type: "over", score: game.score, lines: game.lines });
    return null;
  }
  if (candidates.length === 1) {
    receive(s, game.pieceSerial, { candidates, chosen: 0, scores: null, descriptions: null, modelMs: null });
    return null;
  }
  const { holes, maxHeight, bumpiness } = boardFeatures(game.board);
  return { serial: game.pieceSerial, candidates, board: { holes, maxHeight, bumpiness } };
}

/** Hands the model's answer to the session. Returns false if the piece had already locked. */
export function receive(s: Session, serial: number, choice: Choice): boolean {
  if (s.game.pieceSerial !== serial || s.game.status === "over") {
    s.lateAnswers++;
    return false;
  }
  const target = choice.candidates[choice.chosen];
  const { active } = s.game;
  s.choice = choice;
  s.answeredAt = s.clock;
  s.fallenAtAnswer = active.y - s.startRow;
  s.plan = { target, blocked: 0 };
  s.inputTimer = 0;
  s.version++;
  s.events.push({
    type: "answer", serial, choice, answerMs: s.clock - s.spawnedAt,
    steps: { rotations: (target.rotation - active.rotation + 4) % 4, shift: target.x - active.x, drop: target.y - active.y },
  });
  return true;
}

/** Lets a failed request be asked again for the same piece. */
export function forgetRequest(s: Session): void {
  if (s.choice) return;
  s.requested = false;
  s.version++;
}

export function pause(s: Session): void {
  s.game = togglePause(s.game);
  s.version++;
}

/**
 * Advance game time. Long gaps are split into small steps so gravity and key presses stay ordered.
 * With `stopAtNextPiece` it returns as soon as a piece locks, so a headless caller can ask the
 * model about the new piece at the moment it appears. Returns the milliseconds left unused.
 */
export function tick(s: Session, dtMs: number, stopAtNextPiece = false): number {
  let left = dtMs;
  const serial = s.game.pieceSerial;
  while (left > 0 && s.game.status === "playing") {
    const step = Math.min(STEP_MS, left);
    left -= step;
    s.clock += step;
    advance(s, step);
    if (stopAtNextPiece && s.game.pieceSerial !== serial) break;
  }
  return left;
}

function advance(s: Session, step: number): void {
  const resting = !canFall(s.game);
  if (resting) {
    s.restTimer += step;
    s.fallTimer = 0;
    // A lined-up piece has finished its drop: lock at once instead of waiting.
    if (s.dropping || s.restTimer >= s.settings.lockDelayMs) {
      lockNow(s);
      return;
    }
  } else {
    s.restTimer = 0;
    s.fallTimer += step;
    const interval = s.dropping ? s.settings.dropMs : s.gravityMs;
    if (s.fallTimer >= interval) {
      s.fallTimer -= interval;
      s.game = { ...s.game, active: { ...s.game.active, y: s.game.active.y + 1 } };
      s.version++;
    }
  }
  if (s.plan && !s.dropping) {
    s.inputTimer += step;
    if (s.inputTimer >= s.settings.inputMs) {
      s.inputTimer -= s.settings.inputMs;
      pressKey(s, s.plan);
    }
  }
}

/** One key press towards the target: rotate first, then slide, then start the fast drop. */
function pressKey(s: Session, plan: NonNullable<Session["plan"]>): void {
  const before = s.game;
  const { active } = before;
  const { target } = plan;
  let after = before;
  if (active.rotation !== target.rotation) after = rotate(before);
  else if (active.x !== target.x) after = move(before, active.x < target.x ? 1 : -1);
  else {
    s.dropping = true;
    return;
  }
  if (after === before) {
    // Rotation or slide is blocked; a piece that is too low cannot get past the stack.
    plan.blocked++;
    if (plan.blocked >= MAX_BLOCKED) {
      s.plan = null;
      s.version++;
      s.events.push({ type: "abandon", serial: before.pieceSerial });
    }
    return;
  }
  plan.blocked = 0;
  s.game = after;
  s.version++;
}

function lockNow(s: Session): void {
  const before = s.game;
  const { active } = before;
  const target = s.plan?.target ?? s.choice?.candidates[s.choice.chosen] ?? null;
  const onTarget = target !== null && target.rotation === active.rotation && target.x === active.x && target.y === active.y;
  const after = lockActive(before);
  const report: PieceReport = {
    serial: before.pieceSerial,
    piece: active.type,
    gravityMs: s.gravityMs,
    budgetMs: s.budgetMs,
    answerMs: s.answeredAt === null ? null : s.answeredAt - s.spawnedAt,
    modelMs: s.choice?.modelMs ?? null,
    asked: s.choice !== null && s.choice.scores !== null,
    outcome: s.choice === null ? "unanswered" : onTarget ? "on-target" : "off-target",
    cleared: after.lines - before.lines,
    fallenAtAnswer: s.fallenAtAnswer,
  };
  s.reports.push(report);
  if (s.reports.length > MAX_REPORTS) s.reports.shift();
  s.game = after;
  s.version++;
  s.events.push({ type: "lock", report });
  if (after.status === "over") s.events.push({ type: "over", score: after.score, lines: after.lines });
  else beginPiece(s);
}

export type Summary = {
  pieces: number;
  onTarget: number;
  offTarget: number;
  unanswered: number;
  /** Pieces where the model was actually asked. */
  asked: number;
  avgAnswerMs: number | null;
  p95AnswerMs: number | null;
  avgModelMs: number | null;
  /** Average of (time budget − answer time) over answered pieces; negative means too slow. */
  avgSlackMs: number | null;
};

export function summarize(reports: PieceReport[]): Summary {
  const answered = reports.filter((report) => report.answerMs !== null);
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const sorted = answered.map((report) => report.answerMs!).sort((a, b) => a - b);
  return {
    pieces: reports.length,
    onTarget: reports.filter((report) => report.outcome === "on-target").length,
    offTarget: reports.filter((report) => report.outcome === "off-target").length,
    unanswered: reports.filter((report) => report.outcome === "unanswered").length,
    asked: reports.filter((report) => report.asked).length,
    avgAnswerMs: mean(sorted),
    p95AnswerMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null,
    avgModelMs: mean(answered.map((report) => report.modelMs).filter((value): value is number => value !== null)),
    avgSlackMs: mean(answered.map((report) => report.budgetMs - report.answerMs!)),
  };
}
