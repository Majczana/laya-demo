/**
 * Rules of the Snake engine and of the real-time session: only legal moves are offered, the clock
 * never waits for the model, a missing answer means "straight", and the snake speeds up as it eats.
 * No backend needed.
 *
 *   node --test --experimental-strip-types frontend/scripts/snake-session.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { candidateMoves, newGame, planStrategy, stepGame, strategyOptions, turn, type GameState } from "../src/snakeEngine.ts";
import {
  DEFAULT_SETTINGS,
  createSession,
  receive,
  stepMsFor,
  summarize,
  takeRequest,
  tick,
  type ModelRequest,
  type Session,
  type Settings,
} from "../src/snakeSession.ts";

function seeded(start = 7): () => number {
  let seed = start;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const SETTINGS: Settings = { ...DEFAULT_SETTINGS, mode: "moves", guard: false, stepMs: 100, rampEvery: 0, rampFactor: 1, minStepMs: 100 };

const withSnake = (cells: [number, number][], direction: GameState["direction"], food: [number, number] | null, size = 8): GameState => ({
  ...newGame(size, size, seeded()),
  snake: cells.map(([x, y]) => ({ x, y })),
  direction,
  food: food ? { x: food[0], y: food[1] } : null,
});

function answer(session: Session, request: ModelRequest, chosen = 0): boolean {
  return receive(session, request.turn, {
    candidates: request.candidates, chosen, scores: request.candidates.map(() => 0.5), descriptions: null, modelMs: 10,
  });
}

test("relative turns rotate the heading and never reverse", () => {
  assert.equal(turn("up", "left"), "left");
  assert.equal(turn("up", "right"), "right");
  assert.equal(turn("left", "left"), "down");
  assert.equal(turn("left", "straight"), "left");
});

test("a new game starts in the middle with food off the snake", () => {
  const game = newGame(16, 16, seeded());
  assert.equal(game.snake.length, 3);
  assert.equal(game.status, "playing");
  assert.ok(game.food && !game.snake.some((cell) => cell.x === game.food!.x && cell.y === game.food!.y));
});

test("only moves that keep the snake alive are candidates", () => {
  // Head at the top-left corner heading up: straight and left hit the wall, right is fine.
  const game = withSnake([[0, 0], [0, 1], [0, 2]], "up", [5, 5]);
  assert.deepEqual(candidateMoves(game).map((c) => c.move), ["right"]);
  // Head heading left into its own body: straight and left are fatal, only right is free.
  const curled = withSnake([[1, 1], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1], [0, 0]], "left", [6, 6]);
  assert.deepEqual(candidateMoves(curled).map((c) => c.move), ["right"]);
});

test("moving onto the tail is legal unless the move eats", () => {
  // A 2x2 loop: the head can follow the tail because it moves away.
  const loop = withSnake([[1, 1], [2, 1], [2, 2], [1, 2]], "down", [6, 6]);
  assert.ok(candidateMoves(loop).some((c) => c.move === "straight"), "(1,2) is the tail and leaves");
  const hungry = { ...loop, food: { x: 1, y: 2 } };
  assert.ok(!candidateMoves(hungry).some((c) => c.move === "straight"), "eating grows the snake, the tail stays");
});

test("eating grows the snake, scores, and puts new food on a free cell", () => {
  const game = withSnake([[3, 3], [2, 3], [1, 3]], "right", [4, 3]);
  const next = stepGame(game, "straight", seeded());
  assert.equal(next.snake.length, 4);
  assert.equal(next.score, 1);
  assert.ok(next.food && !next.snake.some((cell) => cell.x === next.food!.x && cell.y === next.food!.y));
  assert.equal(next.turn, game.turn + 1);
});

test("a fatal move ends the game with a cause and leaves the snake in place", () => {
  const game = withSnake([[7, 3], [6, 3], [5, 3]], "right", [0, 0]);
  const dead = stepGame(game, "straight");
  assert.equal(dead.status, "over");
  assert.equal(dead.cause, "wall");
  assert.deepEqual(dead.snake, game.snake);
  assert.equal(stepGame(dead, "left"), dead, "a finished game does not move");
});

test("features tell food direction and a dead end apart", () => {
  const game = withSnake([[3, 3], [2, 3], [1, 3]], "right", [6, 3]);
  const [straight, left, right] = candidateMoves(game);
  assert.equal(straight.foodDelta, -1);
  assert.equal(left.foodDelta, 1);
  assert.equal(right.foodDelta, 1);
  assert.ok(candidateMoves(game).every((c) => c.exits >= 2 && !c.boxedIn));
  // Entering the single free cell of a pocket leaves no exit and no room.
  const pocket = withSnake([[1, 1], [1, 2], [2, 2], [3, 2], [3, 1], [3, 0], [2, 0], [1, 0], [0, 0], [0, 1], [0, 2]], "right", [7, 7], 6);
  const into = candidateMoves(pocket).find((c) => c.move === "straight");
  assert.ok(into && into.exits <= 1);
});

test("filling the board ends the game with cause full", () => {
  // Boustrophedon path over 5x5; the snake covers 24 cells and the last one holds the food.
  const path: [number, number][] = [];
  for (let y = 0; y < 5; y++) for (let i = 0; i < 5; i++) path.push([y % 2 === 0 ? i : 4 - i, y]);
  const game = withSnake(path.slice(0, 24).reverse(), "right", path[24], 5);
  const done = stepGame(game, "straight", seeded());
  assert.equal(done.snake.length, 25);
  assert.equal(done.status, "over");
  assert.equal(done.cause, "full");
  assert.equal(done.food, null);
});

test("speed ramps with food and stops at the minimum", () => {
  const ramp: Settings = { ...SETTINGS, stepMs: 500, rampEvery: 3, rampFactor: 0.8, minStepMs: 200 };
  assert.equal(stepMsFor(ramp, 0), 500);
  assert.equal(stepMsFor(ramp, 3), 400);
  assert.equal(stepMsFor(ramp, 300), 200);
  assert.equal(stepMsFor(SETTINGS, 99), 100);
});

test("the clock does not wait: an unanswered move goes straight", () => {
  const session = createSession(SETTINGS, newGame(16, 16, seeded()), seeded());
  const request = takeRequest(session);
  assert.ok(request && request.candidates.length >= 2);
  const head = session.game.snake[0];
  tick(session, 99);
  assert.equal(session.game.steps, 0, "still waiting inside the step");
  tick(session, 1);
  assert.equal(session.game.steps, 1);
  assert.deepEqual(session.game.snake[0], { x: head.x + 1, y: head.y }, "went straight");
  assert.equal(session.reports[0].outcome, "unanswered");
  assert.equal(takeRequest(session)?.turn, 2, "the next turn is asked afresh");
});

test("an answer in time is played and reported", () => {
  const session = createSession(SETTINGS, withSnake([[3, 3], [2, 3], [1, 3]], "right", [3, 6]), seeded());
  const request = takeRequest(session)!;
  const wanted = request.candidates.findIndex((c) => c.move === "right");
  tick(session, 30);
  assert.ok(answer(session, request, wanted));
  tick(session, 70);
  assert.equal(session.game.direction, "down");
  assert.equal(session.reports[0].outcome, "answered");
  assert.equal(session.reports[0].answerMs, 30);
  assert.equal(session.reports[0].modelMs, 10);
});

test("an answer after the move was played is dropped", () => {
  const session = createSession(SETTINGS, newGame(16, 16, seeded()), seeded());
  const request = takeRequest(session)!;
  tick(session, 100);
  assert.equal(answer(session, request), false);
  assert.equal(session.lateAnswers, 1);
  assert.equal(session.choice, null);
});

test("an answer outside the list of candidates is rejected", () => {
  const session = createSession(SETTINGS, newGame(16, 16, seeded()), seeded());
  const request = takeRequest(session)!;
  assert.throws(() => answer(session, request, 9), RangeError);
  assert.throws(() => answer(session, request, -1), RangeError);
});

test("a single legal move is played without asking the model", () => {
  const session = createSession(SETTINGS, withSnake([[0, 0], [0, 1], [0, 2]], "up", [5, 5]), seeded());
  assert.equal(takeRequest(session), null);
  assert.equal(session.choice?.scores, null);
  tick(session, 100);
  assert.equal(session.game.status, "playing");
  assert.equal(session.game.direction, "right");
  assert.equal(session.reports[0].asked, false);
});

test("a trapped snake dies when the step runs out", () => {
  const session = createSession(SETTINGS, withSnake([[0, 0], [1, 0], [1, 1], [0, 1], [0, 2]], "left", [5, 5]), seeded());
  assert.equal(takeRequest(session), null);
  tick(session, 100);
  assert.equal(session.game.status, "over");
  assert.ok(session.game.cause);
  assert.equal(session.events.at(-1)?.type, "over");
});

test("stopAtNextTurn returns as soon as a move is played", () => {
  const session = createSession(SETTINGS, newGame(16, 16, seeded()), seeded());
  const left = tick(session, 1000, true);
  assert.equal(session.game.steps, 1);
  assert.equal(left, 900);
});

test("a model that always answers instantly survives a long game and the summary adds up", () => {
  const session = createSession({ ...SETTINGS, stepMs: 50, minStepMs: 50 }, newGame(16, 16, seeded(3)), seeded(3));
  for (let i = 0; i < 400 && session.game.status === "playing"; i++) {
    const request = takeRequest(session);
    if (request) {
      // Prefer moves that eat, then ones that get closer, then the roomiest.
      const best = request.candidates
        .map((c, index) => ({ index, value: (c.eats ? 1000 : 0) - c.foodDistance + c.openPercent / 10 - (c.boxedIn ? 500 : 0) }))
        .sort((a, b) => b.value - a.value)[0].index;
      answer(session, request, best);
    }
    tick(session, 50, true);
  }
  const summary = summarize(session.reports);
  assert.equal(summary.turns, session.reports.length);
  assert.equal(summary.answered + summary.unanswered, summary.turns);
  assert.ok(session.game.score > 0, "a greedy player eats at least once");
  assert.equal(summary.unanswered, 0);
});

test("session defaults are sane", () => {
  assert.ok(DEFAULT_SETTINGS.minStepMs < DEFAULT_SETTINGS.stepMs);
  assert.ok(DEFAULT_SETTINGS.rampFactor < 1);
});

// --- strategy mode and the safety filter -----------------------------------------------------

const STRATEGY: Settings = { ...SETTINGS, mode: "strategy", guard: true };

function strategyChoice(request: ModelRequest, strategy: string) {
  const chosen = request.candidates.findIndex((option) => "strategy" in option && option.strategy === strategy);
  return { candidates: request.candidates, chosen, scores: request.candidates.map(() => 0.5), descriptions: null, modelMs: 10 };
}

test("strategy mode: with no answer the snake follows the default order and does not drive into the wall", () => {
  // Heading right at the last column: "straight" would be fatal, the food order turns away.
  const session = createSession(STRATEGY, withSnake([[6, 3], [5, 3], [4, 3]], "right", [1, 6]), seeded());
  tick(session, 100);
  assert.equal(session.game.status, "playing");
  assert.equal(session.reports[0].outcome, "unanswered");
  assert.equal(session.reports[0].strategy, "food");
  assert.notEqual(session.reports[0].move, "straight");
});

test("strategy mode: a late answer is still applied and its age is recorded", () => {
  const session = createSession(STRATEGY, newGame(16, 16, seeded()), seeded());
  const request = takeRequest(session)!;
  tick(session, 300); // three steps pass while the model thinks
  assert.equal(session.game.steps, 3);
  assert.equal(receive(session, request.turn, strategyChoice(request, "tail")), true);
  assert.equal(session.lateAnswers, 0);
  assert.equal(session.strategy, "tail");
  tick(session, 100);
  const report = session.reports.at(-1)!;
  assert.equal(report.strategy, "tail");
  assert.equal(report.lagSteps, 3);
  assert.equal(report.outcome, "answered");
});

test("strategy mode: one question at a time and at most one per move", () => {
  const session = createSession(STRATEGY, newGame(16, 16, seeded()), seeded());
  const first = takeRequest(session)!;
  assert.equal(takeRequest(session), null, "still open");
  receive(session, first.turn, strategyChoice(first, "food"));
  assert.equal(takeRequest(session), null, "answered within the same move");
  tick(session, 100);
  assert.equal(takeRequest(session)?.turn, first.turn + 1, "asks again on the next position");
});

test("strategy mode: an order with nothing to do falls back to the tail and is counted", () => {
  const session = createSession(STRATEGY, withSnake([[3, 3], [2, 3], [1, 3], [0, 3]], "right", null), seeded());
  tick(session, 100);
  assert.equal(session.game.status, "playing");
  assert.equal(session.reports[0].fallback, true);
  assert.equal(session.fallbacks, 1);
  assert.equal(summarize(session.reports).fallbacks, 1);
});

test("strategy mode: a stale unsafe order is overridden only when the guard is on", () => {
  // Look for a position where following the food order is unsafe but another order is safe.
  let found: GameState | null = null;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const rng = seeded(seed);
    let state = newGame(10, 10, rng);
    for (let i = 0; i < 400 && state.status === "playing" && !found; i++) {
      const food = planStrategy(state, "food");
      if (food && !food.safe && planStrategy(state, "tail")) found = state;
      // Walk the way the guarded player does; it meets positions where the food is unsafe.
      state = stepGame(state, (strategyOptions(state, true)[0])?.move ?? "straight", rng);
    }
  }
  assert.ok(found, "no unsafe-food position found: the test lost its power");
  const guarded = createSession({ ...STRATEGY, guard: true }, found!, seeded());
  const open = createSession({ ...STRATEGY, guard: false }, found!, seeded());
  tick(guarded, 100);
  tick(open, 100);
  assert.equal(guarded.reports[0].fallback, true);
  assert.equal(open.reports[0].fallback, false);
});

test("the safety filter removes risky moves in moves mode, and only when a safe one exists", () => {
  let found: GameState | null = null;
  for (let seed = 1; seed <= 80 && !found; seed++) {
    const rng = seeded(seed);
    let state = newGame(8, 8, rng);
    for (let i = 0; i < 300 && state.status === "playing" && !found; i++) {
      const moves = candidateMoves(state);
      if (moves.some((c) => c.boxedIn || c.exits === 0) && moves.some((c) => !c.boxedIn && c.exits > 0)) found = state;
      // Greedy for the food, ignoring danger, so the snake wanders into risky spots.
      const pick = [...moves].sort((a, b) => Number(b.eats) - Number(a.eats) || a.foodDistance - b.foodDistance)[0];
      state = stepGame(state, pick ? pick.move : "straight", rng);
    }
  }
  assert.ok(found, "no risky-versus-safe position found: the test lost its power");
  const withGuard = createSession({ ...SETTINGS, guard: true }, found!, seeded());
  const withoutGuard = createSession({ ...SETTINGS, guard: false }, found!, seeded());
  const filtered = takeRequest(withGuard);
  const all = takeRequest(withoutGuard);
  assert.ok((filtered?.candidates ?? withGuard.choice!.candidates).every((c) => !("boxedIn" in c) || !(c.boxedIn || c.exits === 0)));
  assert.ok((all?.candidates ?? withoutGuard.choice!.candidates).length > (filtered?.candidates ?? withGuard.choice!.candidates).length);
});

/** A model that always answers after `latencyMs`; it picks the first option offered. */
function playWithLatency(mode: "moves" | "strategy", latencyMs: number, stepMs: number, moves: number, seed: number) {
  const rng = seeded(seed);
  const session = createSession({ ...SETTINGS, mode, guard: true, stepMs, minStepMs: stepMs }, newGame(16, 16, rng), rng);
  let pending: { request: ModelRequest; readyAt: number } | null = null;
  while (session.game.status === "playing" && session.reports.length < moves) {
    if (!pending) {
      const request = takeRequest(session);
      if (request) pending = { request, readyAt: session.clock + latencyMs };
    }
    tick(session, 10);
    if (pending && session.clock >= pending.readyAt) {
      const { request } = pending;
      pending = null;
      receive(session, request.turn, { candidates: request.candidates, chosen: 0, scores: null, descriptions: null, modelMs: latencyMs });
    }
  }
  return session;
}

test("a model slower than the step crashes the snake in moves mode but not in strategy mode", () => {
  // Jev takes about 450 ms per answer; speed 6 is a 240 ms step.
  const driver = playWithLatency("moves", 450, 240, 300, 5);
  assert.equal(driver.game.status, "over", "every answer arrives too late, so the snake goes straight into a wall");
  assert.equal(driver.reports.filter((r) => r.outcome === "answered").length, 0);
  for (const seed of [5, 6, 7]) {
    const pilot = playWithLatency("strategy", 450, 240, 400, seed);
    assert.equal(pilot.game.status, "playing", `seed ${seed} ended: ${pilot.game.cause}`);
    assert.ok(summarize(pilot.reports).avgLagSteps! >= 1, "answers land at least one step late");
  }
});
