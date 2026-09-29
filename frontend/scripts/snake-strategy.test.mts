/**
 * Rules of the Snake strategies: a strategy always turns into a legal move that does not kill the
 * snake, following the tail works, unsafe food is flagged and filtered, and a player that only
 * follows the engine's safe options survives long games. No backend needed.
 *
 *   node --test --experimental-strip-types frontend/scripts/snake-strategy.test.mts
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  STRATEGIES,
  candidateMoves,
  isRisky,
  newGame,
  planStrategy,
  stepGame,
  strategyOptions,
  withoutRisky,
  type GameState,
  type Strategy,
} from "../src/snakeEngine.ts";

function seeded(start = 7): () => number {
  let seed = start;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

const withSnake = (cells: [number, number][], direction: GameState["direction"], food: [number, number] | null, size = 8): GameState => ({
  ...newGame(size, size, seeded()),
  snake: cells.map(([x, y]) => ({ x, y })),
  direction,
  food: food ? { x: food[0], y: food[1] } : null,
});

/** Plays with the given picker for `moves` moves and returns the final state. */
function play(seed: number, moves: number, pick: (state: GameState) => Strategy | null, size = 16): GameState {
  const rng = seeded(seed);
  let state = newGame(size, size, rng);
  for (let i = 0; i < moves && state.status === "playing"; i++) {
    const strategy = pick(state);
    const plan = strategy ? planStrategy(state, strategy) : null;
    state = stepGame(state, plan?.move ?? "straight", rng);
  }
  return state;
}

/** The safe player: the first offered strategy in food, tail, space order, with the engine's filter on. */
const safePick = (state: GameState) => strategyOptions(state, true)[0]?.strategy ?? null;

test("food strategy heads straight for food that lies ahead", () => {
  const state = withSnake([[3, 3], [2, 3], [1, 3]], "right", [6, 3]);
  const plan = planStrategy(state, "food")!;
  assert.equal(plan.move, "straight");
  assert.equal(plan.steps, 3);
  assert.equal(plan.safe, true);
});

test("food strategy goes around the body and never takes the reverse", () => {
  // The food sits behind the head; the snake must turn, not reverse.
  const state = withSnake([[3, 3], [4, 3], [5, 3], [6, 3]], "left", [5, 2]);
  const plan = planStrategy(state, "food")!;
  assert.ok(plan.move === "left" || plan.move === "right");
  assert.ok(candidateMoves(state).some((c) => c.move === plan.move));
});

test("tail strategy chases the tail, which frees up as the snake moves", () => {
  const loop = withSnake([[1, 1], [2, 1], [2, 2], [1, 2]], "down", [6, 6]);
  const plan = planStrategy(loop, "tail")!;
  assert.equal(plan.steps, 1);
  assert.equal(plan.move, "straight");
  assert.equal(plan.safe, true);
});

test("without food the food strategy has no plan, the others still do", () => {
  const state = withSnake([[3, 3], [2, 3], [1, 3]], "right", null);
  assert.equal(planStrategy(state, "food"), null);
  assert.ok(planStrategy(state, "tail"));
  assert.ok(planStrategy(state, "space"));
});

test("space strategy picks the move with the most room", () => {
  // Heading right at the top wall region: straight has room, left goes into a one-cell pocket.
  const state = withSnake([[2, 2], [2, 1], [1, 1], [1, 2], [0, 2], [0, 1]], "down", [7, 7]);
  const plan = planStrategy(state, "space")!;
  const all = candidateMoves(state);
  assert.equal(plan.openPercent, Math.max(...all.map((c) => c.openPercent)));
});

test("every plan is a legal move that does not kill the snake, over many random positions", () => {
  let checked = 0;
  for (let seed = 1; seed <= 12; seed++) {
    const rng = seeded(seed);
    let state = newGame(12, 12, rng);
    for (let i = 0; i < 300 && state.status === "playing"; i++) {
      const legal = candidateMoves(state).map((c) => c.move);
      for (const strategy of STRATEGIES) {
        const plan = planStrategy(state, strategy);
        if (!plan) continue;
        assert.ok(legal.includes(plan.move), `${strategy} played an illegal move`);
        assert.notEqual(stepGame(state, plan.move, seeded(1)).status, "over", `${strategy} killed the snake`);
        checked++;
      }
      // Wander with a mix so positions are varied.
      const options = strategyOptions(state, false);
      const chosen = options[Math.floor(rng() * options.length)];
      state = stepGame(state, chosen ? chosen.move : "straight", rng);
    }
  }
  assert.ok(checked > 1000);
});

test("the guard drops unsafe food while a safe strategy exists", () => {
  let unsafeSeen = 0;
  for (let seed = 1; seed <= 40 && unsafeSeen < 3; seed++) {
    const rng = seeded(seed);
    let state = newGame(10, 10, rng);
    for (let i = 0; i < 400 && state.status === "playing"; i++) {
      const open = strategyOptions(state, false);
      const guarded = strategyOptions(state, true);
      if (open.some((o) => !o.safe) && open.some((o) => o.safe)) {
        unsafeSeen++;
        assert.ok(guarded.every((o) => o.safe));
        assert.ok(guarded.length < open.length);
      } else {
        assert.equal(guarded.length, open.length);
      }
      state = stepGame(state, (guarded[0] ?? open[0])?.move ?? "straight", rng);
    }
  }
  assert.ok(unsafeSeen > 0, "no unsafe food case found: the test lost its power");
});

test("withoutRisky keeps risky moves only when nothing else is left", () => {
  const safe = { move: "straight" as const, eats: false, foodDistance: 3, foodDelta: 1, openPercent: 80, exits: 2, boxedIn: false };
  const boxed = { ...safe, move: "left" as const, boxedIn: true };
  assert.deepEqual(withoutRisky([safe, boxed]), [safe]);
  assert.deepEqual(withoutRisky([boxed]), [boxed]);
  assert.ok(isRisky({ ...safe, exits: 0 }));
});

test("a player that follows the safe options survives long games on 16x16", () => {
  for (const seed of [1, 2, 3, 4, 5, 6]) {
    const end = play(seed, 1500, safePick);
    assert.equal(end.status, "playing", `seed ${seed} ended after ${end.steps} moves: ${end.cause}`);
    // It may circle its tail for a while when the only food left is unsafe to eat, but it must still eat.
    assert.ok(end.score >= 10, `seed ${seed} only ate ${end.score}`);
  }
});

test("following only the tail never dies either, it just never eats", () => {
  const end = play(3, 800, () => "tail");
  assert.equal(end.status, "playing");
});
