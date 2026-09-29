/**
 * Real-time Snake session for testing a decision model live.
 *
 * The clock never waits for the model. Every `stepMs` the snake moves once. Two ways to steer it:
 *
 * - `moves`: the model picks the next move (straight, left or right). If its answer is not in by
 *   the end of the step the snake goes straight ahead, which is fatal at a wall. A late answer is
 *   dropped, so a model slower than one step never gets to steer.
 * - `strategy`: the model picks a standing order (go to the food, follow the tail, take the most
 *   space) and the engine turns it into a move on the current position every step. One question is
 *   always open; when its answer arrives, late or not, it replaces the order from the next step, and
 *   until then the snake keeps following the old one. A slow model reacts late but never crashes
 *   the snake by being slow.
 *
 * Nothing here touches the DOM or the network: the caller advances time with `tick`, asks
 * `takeRequest` what to send the model and hands the answer to `receive`, exactly as with
 * `tetrisSession.ts`. The browser demo and `scripts/snake-live.mts` share this module.
 * Imports end in `.ts` so Node can run it directly.
 */
import {
  boardFeatures,
  candidateMoves,
  newGame,
  planStrategy,
  stepGame,
  strategyOptions,
  togglePause,
  withoutRisky,
  type BoardFeatures,
  type Candidate,
  type GameState,
  type Move,
  type Rng,
  type Strategy,
  type StrategyOption,
} from "./snakeEngine.ts";

export type Mode = "moves" | "strategy";

export type Settings = {
  mode: Mode;
  /** The engine drops moves (or strategies) that trap the snake whenever a safe one exists. */
  guard: boolean;
  /** Starting speed: milliseconds between two moves. */
  stepMs: number;
  /** The snake speeds up after this many pieces of food; 0 keeps it constant. */
  rampEvery: number;
  /** Each speed-up multiplies the milliseconds per move by this factor (below 1). */
  rampFactor: number;
  minStepMs: number;
};

export const DEFAULT_SETTINGS: Settings = { mode: "moves", guard: true, stepMs: 500, rampEvery: 3, rampFactor: 0.85, minStepMs: 60 };

/** What the model can choose from: a move, or a strategy (which also carries the move it plays now). */
export type Option = Candidate | StrategyOption;
export const isStrategy = (option: Option): option is StrategyOption => "strategy" in option;

/** What the model answered for one question. */
export type Choice = {
  candidates: Option[];
  chosen: number;
  /** null when only one option was legal and the model was not asked. */
  scores: number[] | null;
  descriptions: string[] | null;
  /** Compute time reported by the backend. */
  modelMs: number | null;
};

/** answered: the model's choice was in force. unanswered: nothing from the model yet (moves: went straight; strategy: default order). */
export type Outcome = "answered" | "unanswered";

export type TurnReport = {
  turn: number;
  stepMs: number;
  /** Time the question took, from asking to the answer; null unless an answer arrived during this turn. */
  answerMs: number | null;
  modelMs: number | null;
  /** The model was really asked (more than one option). */
  asked: boolean;
  outcome: Outcome;
  move: Move;
  ate: boolean;
  /** strategy mode: the order that was followed. */
  strategy: Strategy | null;
  /** strategy mode: how many steps old the position was when the answer arrived, if one did this turn. */
  lagSteps: number | null;
  /** strategy mode: the order had nothing to do here (or was unsafe with the guard on) and the engine took over. */
  fallback: boolean;
};

export type SessionEvent =
  | { type: "turn"; turn: number; stepMs: number }
  | { type: "answer"; turn: number; choice: Choice; answerMs: number; lagSteps: number }
  | { type: "move"; report: TurnReport }
  | { type: "over"; score: number; steps: number; cause: GameState["cause"] };

export type Session = {
  settings: Settings;
  rng: Rng;
  game: GameState;
  /** Game time in milliseconds; only `tick` advances it. */
  clock: number;
  stepMs: number;
  turnStartedAt: number;
  /** A question is open (moves: for this move; strategy: for the position it was asked about). */
  requested: boolean;
  requestedAt: number;
  /** strategy mode: the last move number a question was asked for; one question per move at most. */
  askedTurn: number;
  /** moves mode: the answer for this move. strategy mode: the latest answer. */
  choice: Choice | null;
  answeredAt: number | null;
  /** strategy mode: the order being followed. */
  strategy: Strategy;
  /** strategy mode: the answer that landed during the current turn. */
  landed: { answerMs: number; lagSteps: number } | null;
  reports: TurnReport[];
  /** Answers that arrived when they could no longer be used. */
  lateAnswers: number;
  /** strategy mode: moves where the chosen order had nothing to do. */
  fallbacks: number;
  /** Bumps whenever the board changes. */
  version: number;
  events: SessionEvent[];
};

export type ModelRequest = {
  turn: number;
  candidates: Option[];
  board: BoardFeatures;
};

const MAX_REPORTS = 500;

export function stepMsFor(settings: Settings, eaten: number): number {
  const raised = settings.rampEvery > 0 ? Math.floor(eaten / settings.rampEvery) : 0;
  return Math.max(settings.minStepMs, Math.round(settings.stepMs * settings.rampFactor ** raised));
}

export function createSession(settings: Settings = DEFAULT_SETTINGS, game?: GameState, rng: Rng = Math.random): Session {
  const session: Session = {
    settings, rng, game: game ?? newGame(undefined, undefined, rng), clock: 0, stepMs: settings.stepMs, turnStartedAt: 0,
    requested: false, requestedAt: 0, askedTurn: 0, choice: null, answeredAt: null, strategy: "food", landed: null,
    reports: [], lateAnswers: 0, fallbacks: 0, version: 0, events: [],
  };
  beginTurn(session);
  return session;
}

function beginTurn(s: Session): void {
  s.stepMs = stepMsFor(s.settings, s.game.score);
  s.turnStartedAt = s.clock;
  s.landed = null;
  // In moves mode every move is its own question; in strategy mode the question and the order outlive the move.
  if (s.settings.mode === "moves") {
    s.requested = false;
    s.choice = null;
    s.answeredAt = null;
  }
  s.version++;
  s.events.push({ type: "turn", turn: s.game.turn, stepMs: s.stepMs });
}

/** What to ask the model now, or null if a question is open already or there is nothing to ask. */
export function takeRequest(s: Session): ModelRequest | null {
  const { game } = s;
  if (game.status !== "playing" || s.requested) return null;
  if (s.settings.mode === "moves") {
    if (s.choice) return null;
    s.requested = true;
    s.requestedAt = s.clock;
    s.version++;
    const all = candidateMoves(game);
    const candidates = s.settings.guard ? withoutRisky(all) : all;
    // No legal move: the snake is trapped. Let the turn run out, the fallback move ends the game.
    if (candidates.length === 0) return null;
    if (candidates.length === 1) {
      receive(s, game.turn, { candidates, chosen: 0, scores: null, descriptions: null, modelMs: null });
      return null;
    }
    return { turn: game.turn, candidates, board: boardFeatures(game) };
  }
  if (game.turn === s.askedTurn) return null;
  const options = strategyOptions(game, s.settings.guard);
  s.askedTurn = game.turn;
  if (options.length === 0) return null;
  s.requested = true;
  s.requestedAt = s.clock;
  s.version++;
  if (options.length === 1) {
    receive(s, game.turn, { candidates: options, chosen: 0, scores: null, descriptions: null, modelMs: null });
    return null;
  }
  return { turn: game.turn, candidates: options, board: boardFeatures(game) };
}

/**
 * Hands the model's answer to the session. Returns false if it can no longer be used: in moves mode
 * the move was already played; in strategy mode the game is over. A strategy answer for an older
 * position is still applied (`lagSteps` records how old it was).
 */
export function receive(s: Session, turn: number, choice: Choice): boolean {
  const strategyMode = s.settings.mode === "strategy";
  const unusable = s.game.status === "over" || (strategyMode ? !s.requested : s.choice !== null || s.game.turn !== turn);
  if (unusable) {
    s.lateAnswers++;
    return false;
  }
  if (!Number.isInteger(choice.chosen) || choice.chosen < 0 || choice.chosen >= choice.candidates.length) {
    throw new RangeError(`Answer ${choice.chosen} is not one of the ${choice.candidates.length} candidates.`);
  }
  const lagSteps = s.game.turn - turn;
  const answerMs = s.clock - s.requestedAt;
  s.choice = choice;
  s.answeredAt = s.clock;
  if (strategyMode) {
    const picked = choice.candidates[choice.chosen];
    if (!isStrategy(picked)) throw new TypeError("Strategy mode needs strategy options.");
    s.strategy = picked.strategy;
    s.requested = false;
    s.landed = { answerMs, lagSteps };
  }
  s.version++;
  s.events.push({ type: "answer", turn, choice, answerMs: strategyMode ? answerMs : s.clock - s.turnStartedAt, lagSteps });
  return true;
}

/** Lets a failed request be asked again. */
export function forgetRequest(s: Session): void {
  if (s.settings.mode === "moves" && s.choice) return;
  s.requested = false;
  s.askedTurn = 0;
  s.version++;
}

export function pause(s: Session): void {
  s.game = togglePause(s.game);
  s.version++;
}

/**
 * Advance game time. With `stopAtNextTurn` it returns as soon as a move is played, so a headless
 * caller can ask the model about the new position at the moment it appears. Returns the
 * milliseconds left unused.
 */
export function tick(s: Session, dtMs: number, stopAtNextTurn = false): number {
  let left = dtMs;
  while (left > 0 && s.game.status === "playing") {
    const remaining = s.stepMs - (s.clock - s.turnStartedAt);
    const step = Math.min(left, remaining);
    left -= step;
    s.clock += step;
    if (s.clock - s.turnStartedAt >= s.stepMs) {
      playMove(s);
      if (stopAtNextTurn) break;
    }
  }
  return left;
}

/** The move for this step: moves mode plays the answer or goes straight; strategy mode plays its order, or follows the tail when the order has nothing to do (or is now unsafe and the guard is on). */
function decideMove(s: Session): { move: Move; fallback: boolean } {
  if (s.settings.mode === "moves") {
    const picked = s.choice ? s.choice.candidates[s.choice.chosen] : null;
    return { move: picked ? picked.move : "straight", fallback: false };
  }
  const plan = planStrategy(s.game, s.strategy);
  // With the guard on, an order that has gone stale and now ends in a trap is overridden too.
  if (plan && (plan.safe || !s.settings.guard)) return { move: plan.move, fallback: false };
  // Never "straight" by default: the snake follows its tail, or takes the roomiest legal move.
  const rescue = planStrategy(s.game, "tail") ?? planStrategy(s.game, "space") ?? plan;
  return { move: rescue ? rescue.move : "straight", fallback: true };
}

function playMove(s: Session): void {
  const before = s.game;
  const strategyMode = s.settings.mode === "strategy";
  const { move, fallback } = decideMove(s);
  const after = stepGame(before, move, s.rng);
  if (fallback) s.fallbacks++;
  const report: TurnReport = {
    turn: before.turn,
    stepMs: s.stepMs,
    answerMs: strategyMode ? s.landed?.answerMs ?? null : s.answeredAt === null ? null : s.answeredAt - s.turnStartedAt,
    modelMs: s.choice?.modelMs ?? null,
    asked: s.choice !== null && s.choice.scores !== null,
    outcome: s.choice === null ? "unanswered" : "answered",
    move,
    ate: after.score > before.score,
    strategy: strategyMode ? s.strategy : null,
    lagSteps: strategyMode ? s.landed?.lagSteps ?? null : null,
    fallback,
  };
  s.reports.push(report);
  if (s.reports.length > MAX_REPORTS) s.reports.shift();
  s.game = after;
  s.version++;
  s.events.push({ type: "move", report });
  if (after.status === "over") s.events.push({ type: "over", score: after.score, steps: after.steps, cause: after.cause });
  else beginTurn(s);
}

export type Summary = {
  turns: number;
  answered: number;
  unanswered: number;
  /** Turns where the model was actually asked. */
  asked: number;
  avgAnswerMs: number | null;
  p95AnswerMs: number | null;
  avgModelMs: number | null;
  /** moves mode: average of (step time − answer time) over answered turns, and its minimum. */
  avgSlackMs: number | null;
  minSlackMs: number | null;
  /** strategy mode: moves where the chosen order had nothing to do and the engine took over. */
  fallbacks: number;
  /** strategy mode: average and worst age, in steps, of the position an answer was about. */
  avgLagSteps: number | null;
  maxLagSteps: number | null;
};

export function summarize(reports: TurnReport[]): Summary {
  const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null);
  const timed = reports.filter((report) => report.answerMs !== null);
  const sorted = timed.map((report) => report.answerMs!).sort((a, b) => a - b);
  const slack = timed.filter((report) => report.strategy === null).map((report) => report.stepMs - report.answerMs!);
  const lags = reports.map((report) => report.lagSteps).filter((value): value is number => value !== null);
  const answered = reports.filter((report) => report.outcome === "answered").length;
  return {
    turns: reports.length,
    answered,
    unanswered: reports.length - answered,
    asked: reports.filter((report) => report.asked).length,
    avgAnswerMs: mean(sorted),
    p95AnswerMs: sorted.length ? sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] : null,
    avgModelMs: mean(timed.map((report) => report.modelMs).filter((value): value is number => value !== null)),
    avgSlackMs: mean(slack),
    minSlackMs: slack.length ? Math.min(...slack) : null,
    fallbacks: reports.filter((report) => report.fallback).length,
    avgLagSteps: mean(lags),
    maxLagSteps: lags.length ? Math.max(...lags) : null,
  };
}
