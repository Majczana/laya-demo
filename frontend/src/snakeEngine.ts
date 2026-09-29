/**
 * Snake rules as pure functions, so a model can steer the game without touching the DOM.
 *
 * The model never sees raw coordinates. Each turn the engine lists the moves that keep the snake
 * alive (`candidateMoves`) with features computed here, and the caller passes back an index into
 * that list. `stepGame` then applies a move; a move that is not legal ends the game instead of
 * throwing, because in real time the fallback move ("straight") can be fatal.
 *
 * Coordinates: x grows to the right, y grows downwards, the head is `snake[0]`.
 * Imports end in `.ts` so Node can run it directly.
 */

export const DEFAULT_WIDTH = 16;
export const DEFAULT_HEIGHT = 16;

export const DIRECTIONS = ["up", "right", "down", "left"] as const;
export type Direction = (typeof DIRECTIONS)[number];
/** Relative to the current heading, so a model can never reverse into its own neck. */
export const MOVES = ["straight", "left", "right"] as const;
export type Move = (typeof MOVES)[number];

export type Point = { x: number; y: number };
export type GameStatus = "playing" | "paused" | "over";
export type Cause = "wall" | "self" | "full";

export type GameState = {
  width: number;
  height: number;
  snake: Point[];
  direction: Direction;
  food: Point | null;
  /** Food eaten so far. */
  score: number;
  /** Moves made so far. */
  steps: number;
  status: GameStatus;
  /** Why the game ended; null while it is running. `full` means the snake filled the board. */
  cause: Cause | null;
  /** Number of the move being decided, starting at 1. Answers carry it so stale ones are dropped. */
  turn: number;
};

/** A legal move and what it does to the board, computed by the engine. */
export type Candidate = {
  move: Move;
  eats: boolean;
  /** Manhattan distance from the new head to the food (0 when it eats). */
  foodDistance: number;
  /** foodDistance minus the distance before the move: -1 closer, +1 further. */
  foodDelta: number;
  /** Free cells the head can still reach after the move, as a percentage of all free cells. */
  openPercent: number;
  /** Free neighbours of the new head. 0 means the next move is fatal. */
  exits: number;
  /** The reachable area is smaller than the snake, or the head can no longer get back to its own tail. */
  boxedIn: boolean;
};

export type BoardFeatures = {
  length: number;
  freeCells: number;
  foodDistance: number;
};

const DELTAS: Record<Direction, Point> = {
  up: { x: 0, y: -1 },
  right: { x: 1, y: 0 },
  down: { x: 0, y: 1 },
  left: { x: -1, y: 0 },
};

export type Rng = () => number;

const same = (a: Point, b: Point) => a.x === b.x && a.y === b.y;
const distance = (a: Point, b: Point) => Math.abs(a.x - b.x) + Math.abs(a.y - b.y);

export function turn(direction: Direction, move: Move): Direction {
  const offset = move === "left" ? 3 : move === "right" ? 1 : 0;
  return DIRECTIONS[(DIRECTIONS.indexOf(direction) + offset) % 4];
}

function freeCellList(width: number, height: number, snake: Point[]): Point[] {
  const taken = new Set(snake.map((cell) => cell.y * width + cell.x));
  const free: Point[] = [];
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) if (!taken.has(y * width + x)) free.push({ x, y });
  return free;
}

function placeFood(width: number, height: number, snake: Point[], rng: Rng): Point | null {
  const free = freeCellList(width, height, snake);
  return free.length === 0 ? null : free[Math.min(free.length - 1, Math.floor(rng() * free.length))];
}

/** A snake of 3 cells in the middle heading right, with the first food placed. */
export function newGame(width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, rng: Rng = Math.random): GameState {
  if (width < 5 || height < 5) throw new Error("The board must be at least 5x5.");
  const y = Math.floor(height / 2);
  const x = Math.floor(width / 2);
  const snake = [{ x, y }, { x: x - 1, y }, { x: x - 2, y }];
  return {
    width, height, snake, direction: "right", food: placeFood(width, height, snake, rng),
    score: 0, steps: 0, status: "playing", cause: null, turn: 1,
  };
}

function inside(state: GameState, cell: Point): boolean {
  return cell.x >= 0 && cell.y >= 0 && cell.x < state.width && cell.y < state.height;
}

/** Cells that stay occupied after the move; the tail leaves unless the snake grows. */
function bodyAfter(snake: Point[], grows: boolean): Point[] {
  return grows ? snake : snake.slice(0, -1);
}

/** Where a move would put the head, and whether it is legal. Moving onto the tail is legal unless it eats. */
export function probe(state: GameState, move: Move): { direction: Direction; head: Point; eats: boolean; cause: Cause | null } {
  const direction = turn(state.direction, move);
  const delta = DELTAS[direction];
  const from = state.snake[0];
  const head = { x: from.x + delta.x, y: from.y + delta.y };
  const eats = state.food !== null && same(head, state.food);
  if (!inside(state, head)) return { direction, head, eats, cause: "wall" };
  const blocked = bodyAfter(state.snake, eats).some((cell) => same(cell, head));
  return { direction, head, eats, cause: blocked ? "self" : null };
}

/**
 * Can the head still get to its own tail through free cells? The tail keeps moving away, so a snake
 * that can always follow it cannot be trapped. This is the standard survival check.
 */
function canReachTail(width: number, height: number, snake: Point[]): boolean {
  if (snake.length < 3) return true;
  const tail = snake[snake.length - 1];
  const seen = new Uint8Array(width * height);
  for (const cell of snake) seen[cell.y * width + cell.x] = 1;
  const stack = [snake[0]];
  while (stack.length > 0) {
    const cell = stack.pop()!;
    for (const direction of DIRECTIONS) {
      const x = cell.x + DELTAS[direction].x;
      const y = cell.y + DELTAS[direction].y;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (x === tail.x && y === tail.y) return true;
      if (seen[y * width + x]) continue;
      seen[y * width + x] = 1;
      stack.push({ x, y });
    }
  }
  return false;
}

/** Free cells reachable from `start` when `blocked` cells cannot be entered; `start` itself is not counted. */
function reachable(state: GameState, start: Point, blocked: Point[]): number {
  const { width, height } = state;
  const wall = new Uint8Array(width * height);
  for (const cell of blocked) wall[cell.y * width + cell.x] = 1;
  wall[start.y * width + start.x] = 1;
  const stack = [start];
  let count = 0;
  while (stack.length > 0) {
    const cell = stack.pop()!;
    for (const direction of DIRECTIONS) {
      const x = cell.x + DELTAS[direction].x;
      const y = cell.y + DELTAS[direction].y;
      if (x < 0 || y < 0 || x >= width || y >= height || wall[y * width + x]) continue;
      wall[y * width + x] = 1;
      count++;
      stack.push({ x, y });
    }
  }
  return count;
}

/** The legal moves in a fixed order (straight, left, right) with their features. Empty when every move is fatal. */
export function candidateMoves(state: GameState): Candidate[] {
  if (state.status === "over") return [];
  const before = state.food ? distance(state.snake[0], state.food) : 0;
  const candidates: Candidate[] = [];
  for (const move of MOVES) {
    const outcome = probe(state, move);
    if (outcome.cause) continue;
    const body = bodyAfter(state.snake, outcome.eats);
    const length = body.length + 1;
    const blocked = body.slice(0, -1);
    const reach = reachable(state, outcome.head, blocked);
    const freeAfter = state.width * state.height - length;
    const exits = DIRECTIONS.filter((direction) => {
      const next = { x: outcome.head.x + DELTAS[direction].x, y: outcome.head.y + DELTAS[direction].y };
      return inside(state, next) && !blocked.some((cell) => same(cell, next));
    }).length;
    const tailReachable = canReachTail(state.width, state.height, [outcome.head, ...body]);
    const foodDistance = outcome.eats || !state.food ? 0 : distance(outcome.head, state.food);
    candidates.push({
      move,
      eats: outcome.eats,
      foodDistance,
      foodDelta: foodDistance - before,
      openPercent: freeAfter === 0 ? 100 : Math.min(100, Math.round((reach / freeAfter) * 100)),
      exits,
      boxedIn: reach < length || !tailReachable,
    });
  }
  return candidates;
}

/** A move that leaves the snake with no room, no way out, or cut off from its own tail. */
export const isRisky = (candidate: Candidate) => candidate.boxedIn || candidate.exits === 0;

/**
 * The engine's safety filter: when at least one move is safe, risky ones are dropped, so the model
 * only chooses between safe options. If every move is risky they are all kept.
 */
export function withoutRisky(candidates: Candidate[]): Candidate[] {
  const safe = candidates.filter((candidate) => !isRisky(candidate));
  return safe.length > 0 ? safe : candidates;
}

export function boardFeatures(state: GameState): BoardFeatures {
  return {
    length: state.snake.length,
    freeCells: state.width * state.height - state.snake.length,
    foodDistance: state.food ? distance(state.snake[0], state.food) : 0,
  };
}

/** Applies one move. A fatal move ends the game and leaves the snake where it was. */
export function stepGame(state: GameState, move: Move, rng: Rng = Math.random): GameState {
  if (state.status !== "playing") return state;
  const outcome = probe(state, move);
  if (outcome.cause) return { ...state, direction: outcome.direction, status: "over", cause: outcome.cause, steps: state.steps + 1 };
  const snake = [outcome.head, ...bodyAfter(state.snake, outcome.eats)];
  const food = outcome.eats ? placeFood(state.width, state.height, snake, rng) : state.food;
  const full = outcome.eats && food === null;
  return {
    ...state,
    snake,
    direction: outcome.direction,
    food,
    score: state.score + (outcome.eats ? 1 : 0),
    steps: state.steps + 1,
    turn: state.turn + 1,
    status: full ? "over" : "playing",
    cause: full ? "full" : null,
  };
}

export function togglePause(state: GameState): GameState {
  if (state.status === "over") return state;
  return { ...state, status: state.status === "playing" ? "paused" : "playing" };
}

/** Text picture of the board (`O` head, `o` body, `*` food), handy in logs and tests. */
export function toAscii(state: GameState): string {
  const rows = Array.from({ length: state.height }, () => Array<string>(state.width).fill("."));
  if (state.food) rows[state.food.y][state.food.x] = "*";
  state.snake.forEach((cell, index) => { rows[cell.y][cell.x] = index === 0 ? "O" : "o"; });
  return rows.map((row) => row.join("")).join("\n");
}

// --- Strategies -------------------------------------------------------------------------------
// A strategy is a standing order ("go to the food"), not a single move. The engine turns it into
// a move on the current position every step, so the snake keeps going while a model is thinking.

export const STRATEGIES = ["food", "tail", "space"] as const;
export type Strategy = (typeof STRATEGIES)[number];

/** What a strategy would do on the current position, computed by the engine. */
export type StrategyOption = {
  strategy: Strategy;
  /** The move it plays now. */
  move: Move;
  /** Steps to the food or to the tail; 0 for `space`. */
  steps: number;
  /** After the whole path the head can still reach its own tail. */
  safe: boolean;
  /** Free cells the head can reach after the first move, as a percentage of all free cells. */
  openPercent: number;
};

function moveTowards(state: GameState, cell: Point): Move | null {
  const head = state.snake[0];
  for (const move of MOVES) {
    const delta = DELTAS[turn(state.direction, move)];
    if (head.x + delta.x === cell.x && head.y + delta.y === cell.y) return move;
  }
  return null;
}

/**
 * Shortest path from the head to `target`, first step first. A body cell counts as free once the
 * snake has moved far enough for its segment to have left it, so following the tail works.
 */
function shortestPath(state: GameState, target: Point): Point[] | null {
  const { width, height, snake } = state;
  const length = snake.length;
  const bodyIndex = new Int16Array(width * height).fill(-1);
  snake.forEach((cell, index) => { bodyIndex[cell.y * width + cell.x] = index; });
  const start = snake[0];
  const startIndex = start.y * width + start.x;
  const parent = new Int32Array(width * height).fill(-2);
  const arrival = new Int32Array(width * height);
  parent[startIndex] = -1;
  const queue = [start];
  for (let next = 0; next < queue.length; next++) {
    const cell = queue[next];
    const at = arrival[cell.y * width + cell.x] + 1;
    for (const direction of DIRECTIONS) {
      const x = cell.x + DELTAS[direction].x;
      const y = cell.y + DELTAS[direction].y;
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      const index = y * width + x;
      if (parent[index] !== -2) continue;
      const segment = bodyIndex[index];
      if (segment >= 0 && at < length - segment) continue;
      parent[index] = cell.y * width + cell.x;
      arrival[index] = at;
      if (x === target.x && y === target.y) {
        const path: Point[] = [];
        for (let walk = index; walk !== startIndex; walk = parent[walk]) path.push({ x: walk % width, y: Math.floor(walk / width) });
        return path.reverse();
      }
      queue.push({ x, y });
    }
  }
  return null;
}

/** The snake after walking `path`; it grows by one if the last cell is the food. */
function afterWalking(state: GameState, path: Point[], eatsAtEnd: boolean): Point[] {
  return [...path].reverse().concat(state.snake).slice(0, state.snake.length + (eatsAtEnd ? 1 : 0));
}

/** The strategy's move on the current position, or null when it has nothing to do (no path, or no legal move). */
export function planStrategy(state: GameState, strategy: Strategy): StrategyOption | null {
  if (state.status === "over") return null;
  const legal = candidateMoves(state);
  if (strategy === "space") {
    if (legal.length === 0) return null;
    const best = [...legal].sort((a, b) => Number(isRisky(a)) - Number(isRisky(b)) || b.openPercent - a.openPercent || b.exits - a.exits)[0];
    return { strategy, move: best.move, steps: 0, safe: !isRisky(best), openPercent: best.openPercent };
  }
  const target = strategy === "food" ? state.food : state.snake[state.snake.length - 1];
  if (!target) return null;
  const path = shortestPath(state, target);
  if (!path) return null;
  const move = moveTowards(state, path[0]);
  const first = legal.find((candidate) => candidate.move === move);
  if (move === null || !first) return null;
  const safe = strategy === "tail" || canReachTail(state.width, state.height, afterWalking(state, path, true));
  return { strategy, move, steps: path.length, safe, openPercent: first.openPercent };
}

/**
 * The strategies a model can choose from, in a fixed order (food, tail, space). With `guard`, a
 * strategy that ends in a trap is dropped when a safe one exists.
 */
export function strategyOptions(state: GameState, guard = true): StrategyOption[] {
  const options = STRATEGIES.map((strategy) => planStrategy(state, strategy)).filter((option): option is StrategyOption => option !== null);
  if (!guard) return options;
  const safe = options.filter((option) => option.safe);
  return safe.length > 0 ? safe : options;
}
