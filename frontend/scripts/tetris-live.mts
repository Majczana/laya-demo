/**
 * Live test: plays real-time Tetris against the running backend and reports how well each
 * model keeps up as gravity speeds up. It uses the same session module as the browser demo.
 *
 * The game clock advances by the wall-clock time each request really took, so a slow
 * answer costs the piece exactly the rows it would have fallen in the browser. Answers that
 * arrive after the piece locked are dropped, as in the demo.
 *
 *   node --experimental-strip-types frontend/scripts/tetris-live.mts
 *   node --experimental-strip-types frontend/scripts/tetris-live.mts --engine laya,jev \
 *        --gravity 600,300,150,80 --ramp 5 --max 80 --games 2 --candidates 4
 *
 * Options: --engine (laya, jev, instant: a zero-latency reference that always takes the
 * engine's top move), --gravity (start ms per row, comma list), --ramp (pieces per speed-up,
 * 0 = constant), --factor, --max (pieces per game), --games (seeds per row), --candidates
 * (4, 8 or all), --url (default http://localhost:8000).
 * Requires the backend; Jev also needs OPENROUTER_API_KEY there.
 */
import type { Placement } from "../src/tetrisEngine.ts";
import { newGame } from "../src/tetrisEngine.ts";
import {
  DEFAULT_SETTINGS,
  createSession,
  receive,
  summarize,
  takeRequest,
  tick,
  type ModelRequest,
  type Settings,
} from "../src/tetrisSession.ts";

const args = new Map<string, string>();
for (let index = 2; index < process.argv.length; index += 2) args.set(process.argv[index].replace(/^--/, ""), process.argv[index + 1] ?? "");
const list = (name: string, fallback: string) => (args.get(name) ?? fallback).split(",").map((item) => item.trim()).filter(Boolean);

const URL = args.get("url") ?? "http://localhost:8000";
const ENGINES = list("engine", "instant,laya");
const GRAVITIES = list("gravity", "600,300,150,80").map(Number);
const MAX_PIECES = Number(args.get("max") ?? 60);
const GAMES = Number(args.get("games") ?? 2);
const RAMP = Number(args.get("ramp") ?? DEFAULT_SETTINGS.rampEvery);
const FACTOR = Number(args.get("factor") ?? DEFAULT_SETTINGS.rampFactor);
const CANDIDATES = (args.get("candidates") ?? "4") === "all" ? "all" : Number(args.get("candidates") ?? 4);

// Seeded random so every model sees the same piece sequence per game.
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

type Answer = { chosen: number; scores: number[] | null; descriptions: string[] | null; modelMs: number | null };

async function ask(engine: string, request: ModelRequest): Promise<Answer> {
  if (engine === "instant") return { chosen: 0, scores: null, descriptions: null, modelMs: 0 };
  const response = await fetch(`${URL}/tetris/choose`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidates: request.candidates.map(({ linesCleared, holes, maxHeight, bumpiness, nextLinePotential }: Placement) => (
        { linesCleared, holes, maxHeight, bumpiness, nextLinePotential }
      )),
      board: request.board,
      engine,
    }),
  });
  if (!response.ok) throw new Error(`backend returned ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const data = await response.json();
  return { chosen: data.selected_index, scores: data.scores, descriptions: data.descriptions, modelMs: data.elapsed_ms };
}

async function playGame(engine: string, gravityMs: number, gameSeed: number) {
  seed = gameSeed;
  const settings: Settings = { ...DEFAULT_SETTINGS, gravityMs, rampEvery: RAMP, rampFactor: FACTOR, candidates: CANDIDATES };
  const session = createSession(settings, newGame());
  let requests = 0;
  let wallMs = 0;
  while (session.game.status === "playing" && session.reports.length < MAX_PIECES) {
    const request = takeRequest(session);
    if (request) {
      const started = performance.now();
      const answer = await ask(engine, request);
      const waited = engine === "instant" ? 0 : performance.now() - started;
      requests++;
      wallMs += waited;
      // The game keeps running while the model thinks.
      tick(session, waited);
      receive(session, request.serial, { candidates: request.candidates, chosen: answer.chosen, scores: answer.scores, descriptions: answer.descriptions, modelMs: answer.modelMs });
    }
    // Let the current piece play out (steer, drop, lock) before asking about the next one.
    const serial = session.game.pieceSerial;
    while (session.game.status === "playing" && session.game.pieceSerial === serial) tick(session, 50, true);
  }
  return { session, requests, wallMs, summary: summarize(session.reports) };
}

const pad = (value: string | number, width: number) => String(value).padStart(width);
console.log(`start gravity → after ${RAMP > 0 ? `+${Math.round((1 / FACTOR - 1) * 100)}% speed every ${RAMP} pieces` : "constant"}; ${GAMES} game(s) × up to ${MAX_PIECES} pieces; candidates ${CANDIDATES}\n`);
console.log(`${"model".padEnd(8)}${pad("ms/row", 8)}${pad("pieces", 8)}${pad("lines", 7)}${pad("on target", 11)}${pad("off", 6)}${pad("no answer", 11)}${pad("answer ms", 11)}${pad("slack ms", 10)}${pad("end gravity", 13)}  result`);
for (const engine of ENGINES) {
  for (const gravity of GRAVITIES) {
    let pieces = 0, lines = 0, on = 0, off = 0, none = 0, answerSum = 0, answerCount = 0, slackSum = 0, over = 0, endGravity = 0;
    for (let game = 0; game < GAMES; game++) {
      const { session, summary } = await playGame(engine, gravity, 1000 + game);
      pieces += summary.pieces; lines += session.game.lines; on += summary.onTarget; off += summary.offTarget; none += summary.unanswered;
      if (summary.avgAnswerMs !== null) { answerSum += summary.avgAnswerMs; answerCount++; slackSum += summary.avgSlackMs ?? 0; }
      if (session.game.status === "over") over++;
      endGravity += session.gravityMs;
    }
    const percent = pieces ? Math.round((on / pieces) * 100) : 0;
    console.log(
      `${engine.padEnd(8)}${pad(gravity, 8)}${pad(pieces, 8)}${pad(lines, 7)}${pad(`${percent}%`, 11)}${pad(off, 6)}${pad(none, 11)}`
      + `${pad(answerCount ? Math.round(answerSum / answerCount) : "–", 11)}${pad(answerCount ? Math.round(slackSum / answerCount) : "–", 10)}${pad(Math.round(endGravity / GAMES), 13)}  ${over}/${GAMES} topped out`,
    );
  }
}
