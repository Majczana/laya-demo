/**
 * Live test: plays real-time Snake against the running backend and reports how well each model
 * keeps up as the snake speeds up. It uses the same session module as the browser demo.
 *
 * The game clock advances by the wall-clock time each request really took, so a slow answer
 * costs the snake the moves it would have made without it. In `moves` mode a late answer is
 * dropped and the snake goes straight; in `strategy` mode it is applied when it arrives and the
 * snake keeps following its old order until then.
 *
 *   node --experimental-strip-types frontend/scripts/snake-live.mts
 *   node --experimental-strip-types frontend/scripts/snake-live.mts --engine laya,jev --mode strategy \
 *        --step 600,240 --ramp 3 --max 150 --games 2 --guard on
 *
 * Options: --engine (laya, jev, plus two references that need no backend: instant = zero latency,
 * a greedy player (moves) or the engine's first strategy (strategy); random = a random option, the honest baseline), --mode (moves,
 * strategy, or both), --guard (on/off: the engine drops options that trap the snake), --step (start
 * ms per move, comma list), --ramp (food per speed-up, 0 = constant), --factor, --max (moves per
 * game), --games (seeds per row), --size (board side), --url (default http://localhost:8000).
 * Requires the backend; Jev also needs OPENROUTER_API_KEY there.
 */
import { newGame } from "../src/snakeEngine.ts";
import {
  DEFAULT_SETTINGS,
  createSession,
  isStrategy,
  receive,
  summarize,
  takeRequest,
  tick,
  type Mode,
  type ModelRequest,
  type Settings,
} from "../src/snakeSession.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1] ?? "");
const list = (name: string, fallback: string) => (args.get(name) ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);

const URL = args.get("url") ?? "http://localhost:8000";
const ENGINES = list("engine", "instant,random,laya");
const MODES: Mode[] = (args.get("mode") ?? "both") === "both" ? ["moves", "strategy"] : [(args.get("mode") as Mode)];
const GUARD = (args.get("guard") ?? "on") !== "off";
const STEPS = list("step", "600,300,150").map(Number);
const MAX_MOVES = Number(args.get("max") ?? 150);
const GAMES = Number(args.get("games") ?? 2);
const RAMP = Number(args.get("ramp") ?? DEFAULT_SETTINGS.rampEvery);
const FACTOR = Number(args.get("factor") ?? DEFAULT_SETTINGS.rampFactor);
const SIZE = Number(args.get("size") ?? 16);

// Seeded random so every model sees the same food sequence per game.
function seeded(start: number): () => number {
  let seed = start;
  return () => {
    seed = (seed * 16807) % 2147483647;
    return (seed - 1) / 2147483646;
  };
}

type Answer = { chosen: number; scores: number[] | null; descriptions: string[] | null; modelMs: number | null };

async function ask(engine: string, mode: Mode, request: ModelRequest, pick: () => number): Promise<Answer> {
  if (engine === "instant") {
    // Strategy mode: the first option (food when it is safe, else the tail). Moves mode: eat, else get closer, else keep room.
    if (mode === "strategy") return { chosen: 0, scores: null, descriptions: null, modelMs: 0 };
    const value = (option: (typeof request.candidates)[number]) =>
      isStrategy(option) ? 0 : (option.eats ? 1000 : 0) - (option.boxedIn ? 500 : 0) - (option.exits === 0 ? 200 : 0) - option.foodDelta * 10 + option.openPercent / 10;
    const chosen = request.candidates.reduce((best, option, index) => (value(option) > value(request.candidates[best]) ? index : best), 0);
    return { chosen, scores: null, descriptions: null, modelMs: 0 };
  }
  if (engine === "random") return { chosen: Math.floor(pick() * request.candidates.length), scores: null, descriptions: null, modelMs: 0 };
  const candidates = request.candidates.map((option) => (isStrategy(option)
    ? { strategy: option.strategy, steps: option.steps, safe: option.safe, openPercent: option.openPercent }
    : { eats: option.eats, foodDelta: option.foodDelta, openPercent: option.openPercent, exits: option.exits, boxedIn: option.boxedIn }));
  const response = await fetch(`${URL}/snake/${mode === "strategy" ? "strategy" : "choose"}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ candidates, engine }),
  });
  if (!response.ok) throw new Error(`backend returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  return { chosen: data.selected_index, scores: data.scores, descriptions: data.descriptions, modelMs: data.elapsed_ms };
}

async function playGame(engine: string, mode: Mode, stepMs: number, gameSeed: number) {
  const rng = seeded(gameSeed);
  const picker = seeded(gameSeed + 99);
  const settings: Settings = { ...DEFAULT_SETTINGS, mode, guard: GUARD, stepMs, rampEvery: RAMP, rampFactor: FACTOR };
  const session = createSession(settings, newGame(SIZE, SIZE, rng), rng);
  const timed = engine !== "instant" && engine !== "random";
  while (session.game.status === "playing" && session.reports.length < MAX_MOVES) {
    const request = takeRequest(session);
    if (request) {
      const started = performance.now();
      const answer = await ask(engine, mode, request, picker);
      const waited = timed ? performance.now() - started : 0;
      // The game keeps running while the model thinks.
      tick(session, waited);
      receive(session, request.turn, { candidates: request.candidates, chosen: answer.chosen, scores: answer.scores, descriptions: answer.descriptions, modelMs: answer.modelMs });
    }
    // Let the current move be played before asking about the next position.
    const turn = session.game.turn;
    while (session.game.status === "playing" && session.game.turn === turn) tick(session, 50, true);
  }
  return { session, summary: summarize(session.reports) };
}

const pad = (value: string | number, width: number) => String(value).padStart(width);
console.log(`start step → ${RAMP > 0 ? `+${Math.round((1 / FACTOR - 1) * 100)}% speed every ${RAMP} food` : "constant"}; ${GAMES} game(s) × up to ${MAX_MOVES} moves; board ${SIZE}×${SIZE}; safety filter ${GUARD ? "on" : "off"}\n`);
console.log(`${"mode".padEnd(9)}${"model".padEnd(8)}${pad("ms/move", 9)}${pad("moves", 7)}${pad("food", 6)}${pad("no answer", 11)}${pad("answer ms", 11)}${pad("lag steps", 11)}${pad("overrides", 11)}${pad("end step", 10)}  result`);
for (const mode of MODES) {
  for (const engine of ENGINES) {
    for (const step of STEPS) {
      let moves = 0, food = 0, none = 0, answerSum = 0, answerCount = 0, lagSum = 0, lagCount = 0, overrides = 0, crashed = 0, endStep = 0;
      const causes = new Map<string, number>();
      for (let game = 0; game < GAMES; game++) {
        const { session, summary } = await playGame(engine, mode, step, 1000 + game);
        moves += summary.turns; food += session.game.score; none += summary.unanswered; overrides += summary.fallbacks;
        if (summary.avgAnswerMs !== null) { answerSum += summary.avgAnswerMs; answerCount++; }
        if (summary.avgLagSteps !== null) { lagSum += summary.avgLagSteps; lagCount++; }
        if (session.game.status === "over") { crashed++; causes.set(session.game.cause ?? "?", (causes.get(session.game.cause ?? "?") ?? 0) + 1); }
        endStep += session.stepMs;
      }
      console.log(
        `${mode.padEnd(9)}${engine.padEnd(8)}${pad(step, 9)}${pad(moves, 7)}${pad(food, 6)}${pad(none, 11)}`
        + `${pad(answerCount ? Math.round(answerSum / answerCount) : "–", 11)}${pad(mode === "strategy" && lagCount ? (lagSum / lagCount).toFixed(1) : "–", 11)}${pad(mode === "strategy" ? overrides : "–", 11)}${pad(Math.round(endStep / GAMES), 10)}`
        + `  ${crashed}/${GAMES} ended${causes.size ? ` (${[...causes].map(([cause, count]) => `${cause} ${count}`).join(", ")})` : ""}`,
      );
    }
  }
}
