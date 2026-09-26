/**
 * Plays headless Tetris games with the same engine and shortlist as the demo
 * and compares move pickers. Requires the backend on http://localhost:8000.
 *
 *   node --experimental-strip-types frontend/scripts/benchmark-tetris.mts
 */
import * as engine from "../src/tetrisEngine.ts";

const GAMES = 6;
const MAX_PIECES = 250;

// Seeded random so every picker sees the same piece sequence per game.
let seed = 1;
Math.random = () => {
  seed = (seed * 16807) % 2147483647;
  return (seed - 1) / 2147483646;
};

async function laya(candidates: engine.Placement[], board: engine.Board): Promise<number> {
  const response = await fetch("http://localhost:8000/tetris/choose", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      candidates: candidates.map(({ linesCleared, holes, maxHeight, bumpiness, nextLinePotential }) => (
        { linesCleared, holes, maxHeight, bumpiness, nextLinePotential }
      )),
      board: (({ holes, maxHeight, bumpiness }) => ({ holes, maxHeight, bumpiness }))(engine.boardFeatures(board)),
    }),
  });
  if (!response.ok) throw new Error(`backend returned ${response.status}`);
  return (await response.json()).selected_index as number;
}

const pickers: Record<string, (candidates: engine.Placement[], board: engine.Board) => number | Promise<number>> = {
  "heuristic (shortlist #1)": () => 0,
  "random from shortlist": (candidates) => Math.floor(Math.random() * candidates.length),
  laya,
};

for (const [name, pick] of Object.entries(pickers)) {
  const lines: number[] = [];
  for (let index = 0; index < GAMES; index++) {
    seed = 1000 + index;
    let game = engine.newGame();
    for (let pieces = 0; game.status === "playing" && pieces < MAX_PIECES; pieces++) {
      const candidates = engine.shortlistPlacements(
        engine.candidatePlacements(game.board, game.active, game.queue[0]),
      );
      if (!candidates.length) break;
      const choice = candidates.length === 1 ? 0 : await pick(candidates, game.board);
      // Keep the piece sequence independent of how many random numbers a picker used.
      const pieceSeed = seed;
      game = engine.applyPlacement(game, candidates[choice]);
      seed = pieceSeed;
    }
    lines.push(game.lines);
  }
  const mean = lines.reduce((sum, value) => sum + value, 0) / GAMES;
  console.log(`${name.padEnd(26)} lines: ${lines.join(", ")}  mean ${mean.toFixed(1)}`);
}
