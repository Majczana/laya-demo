export const BOARD_WIDTH = 10;
export const BOARD_HEIGHT = 20;

export const PIECE_TYPES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
export type PieceType = (typeof PIECE_TYPES)[number];
export type Board = (PieceType | null)[][];
export type GameStatus = "playing" | "paused" | "over";

export type Piece = {
  type: PieceType;
  rotation: number;
  x: number;
  y: number;
};

export type GameState = {
  board: Board;
  active: Piece;
  queue: PieceType[];
  hold: PieceType | null;
  canHold: boolean;
  score: number;
  lines: number;
  combo: number;
  bestCombo: number;
  backToBack: boolean;
  status: GameStatus;
  pieceSerial: number;
};

type Point = { x: number; y: number };

export type Placement = {
  rotation: number;
  x: number;
  y: number;
  linesCleared: number;
  holes: number;
  maxHeight: number;
  aggregateHeight: number;
  bumpiness: number;
  nearCompleteRows: number;
  nextLinePotential: number;
};

const BASE_SHAPES: Record<PieceType, Point[]> = {
  I: [{ x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }, { x: 3, y: 1 }],
  O: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  T: [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  S: [{ x: 1, y: 0 }, { x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }],
  Z: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  J: [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
  L: [{ x: 2, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 2, y: 1 }],
};

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_HEIGHT }, () => Array<PieceType | null>(BOARD_WIDTH).fill(null));
}

export function cellsFor(type: PieceType, rotation: number): Point[] {
  let cells = BASE_SHAPES[type].map((cell) => ({ ...cell }));
  for (let turn = 0; turn < ((rotation % 4) + 4) % 4; turn++) {
    cells = cells.map(({ x, y }) => ({ x: 3 - y, y: x }));
  }
  const minX = Math.min(...cells.map((cell) => cell.x));
  const minY = Math.min(...cells.map((cell) => cell.y));
  return cells.map(({ x, y }) => ({ x: x - minX, y: y - minY }));
}

function bag(): PieceType[] {
  const pieces = [...PIECE_TYPES];
  for (let i = pieces.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pieces[i], pieces[j]] = [pieces[j], pieces[i]];
  }
  return pieces;
}

function spawn(type: PieceType): Piece {
  const width = Math.max(...cellsFor(type, 0).map((cell) => cell.x)) + 1;
  return { type, rotation: 0, x: Math.floor((BOARD_WIDTH - width) / 2), y: 0 };
}

function takeNext(queue: PieceType[]): { type: PieceType; queue: PieceType[] } {
  const available = [...queue];
  while (available.length < 6) available.push(...bag());
  return { type: available.shift()!, queue: available };
}

export function newGame(): GameState {
  const first = takeNext(bag());
  return {
    board: emptyBoard(),
    active: spawn(first.type),
    queue: first.queue,
    hold: null,
    canHold: true,
    score: 0,
    lines: 0,
    combo: 0,
    bestCombo: 0,
    backToBack: false,
    status: "playing",
    pieceSerial: 1,
  };
}

export function fits(board: Board, piece: Piece): boolean {
  return cellsFor(piece.type, piece.rotation).every(({ x, y }) => {
    const column = piece.x + x;
    const row = piece.y + y;
    return column >= 0 && column < BOARD_WIDTH && row < BOARD_HEIGHT
      && (row < 0 || board[row][column] === null);
  });
}

export function ghostY(board: Board, piece: Piece): number {
  let y = piece.y;
  while (fits(board, { ...piece, y: y + 1 })) y++;
  return y;
}

function placedBoard(board: Board, piece: Piece): { board: Board; linesCleared: number } {
  const placed = board.map((row) => [...row]);
  for (const cell of cellsFor(piece.type, piece.rotation)) {
    const row = piece.y + cell.y;
    if (row >= 0) placed[row][piece.x + cell.x] = piece.type;
  }
  const remaining = placed.filter((row) => row.some((cell) => cell === null));
  const linesCleared = BOARD_HEIGHT - remaining.length;
  while (remaining.length < BOARD_HEIGHT) {
    remaining.unshift(Array<PieceType | null>(BOARD_WIDTH).fill(null));
  }
  return { board: remaining, linesCleared };
}

function lockPiece(game: GameState, piece: Piece): GameState {
  if (cellsFor(piece.type, piece.rotation).some((cell) => piece.y + cell.y < 0)) {
    return { ...game, status: "over" };
  }
  const placed = placedBoard(game.board, piece);
  const next = takeNext(game.queue);
  const active = spawn(next.type);
  const lines = game.lines + placed.linesCleared;
  const level = Math.floor(game.lines / 10) + 1;
  const combo = placed.linesCleared > 0 ? game.combo + 1 : 0;
  const tetrisBonus = placed.linesCleared === 4 && game.backToBack ? 400 * level : 0;
  const comboBonus = placed.linesCleared > 0 ? (combo - 1) * 50 * level : 0;
  const score = game.score + [0, 100, 300, 500, 800][placed.linesCleared] * level
    + comboBonus + tetrisBonus;
  return {
    ...game,
    board: placed.board,
    active,
    queue: next.queue,
    canHold: true,
    score,
    lines,
    combo,
    bestCombo: Math.max(game.bestCombo, combo),
    backToBack: placed.linesCleared === 4 || (placed.linesCleared === 0 && game.backToBack),
    status: fits(placed.board, active) ? "playing" : "over",
    pieceSerial: game.pieceSerial + 1,
  };
}

export function move(game: GameState, dx: number): GameState {
  if (game.status !== "playing") return game;
  const active = { ...game.active, x: game.active.x + dx };
  return fits(game.board, active) ? { ...game, active } : game;
}

export function rotate(game: GameState): GameState {
  if (game.status !== "playing") return game;
  const rotation = (game.active.rotation + 1) % 4;
  for (const kick of [0, -1, 1, -2, 2]) {
    const active = { ...game.active, rotation, x: game.active.x + kick };
    if (fits(game.board, active)) return { ...game, active };
  }
  return game;
}

export function stepDown(game: GameState, soft = false): GameState {
  if (game.status !== "playing") return game;
  const active = { ...game.active, y: game.active.y + 1 };
  if (fits(game.board, active)) {
    return { ...game, active, score: game.score + (soft ? 1 : 0) };
  }
  return lockPiece(game, game.active);
}

/** Move the active piece down during model thinking, without locking it. */
export function fallWhileThinking(game: GameState): GameState {
  if (game.status !== "playing") return game;
  const active = { ...game.active, y: game.active.y + 1 };
  return fits(game.board, active) ? { ...game, active } : game;
}

export function hardDrop(game: GameState): GameState {
  if (game.status !== "playing") return game;
  const y = ghostY(game.board, game.active);
  return lockPiece({ ...game, score: game.score + (y - game.active.y) * 2 }, { ...game.active, y });
}

export function holdPiece(game: GameState): GameState {
  if (game.status !== "playing" || !game.canHold) return game;
  const next = game.hold === null ? takeNext(game.queue) : null;
  const active = spawn(game.hold ?? next!.type);
  return {
    ...game,
    active,
    hold: game.active.type,
    queue: next?.queue ?? game.queue,
    canHold: false,
    status: fits(game.board, active) ? "playing" : "over",
    pieceSerial: game.pieceSerial + 1,
  };
}

export function togglePause(game: GameState): GameState {
  if (game.status === "over") return game;
  return { ...game, status: game.status === "paused" ? "playing" : "paused" };
}

export function boardFeatures(board: Board): Omit<Placement, "rotation" | "x" | "y" | "linesCleared" | "nextLinePotential"> {
  const heights = Array.from({ length: BOARD_WIDTH }, (_, x) => {
    const first = board.findIndex((row) => row[x] !== null);
    return first < 0 ? 0 : BOARD_HEIGHT - first;
  });
  let holes = 0;
  for (let x = 0; x < BOARD_WIDTH; x++) {
    let filled = false;
    for (let y = 0; y < BOARD_HEIGHT; y++) {
      if (board[y][x] !== null) filled = true;
      else if (filled) holes++;
    }
  }
  return {
    holes,
    maxHeight: Math.max(...heights),
    aggregateHeight: heights.reduce((sum, height) => sum + height, 0),
    bumpiness: heights.slice(1).reduce((sum, height, i) => sum + Math.abs(height - heights[i]), 0),
    nearCompleteRows: board.filter((row) => row.filter((cell) => cell !== null).length >= 8).length,
  };
}

export function candidatePlacements(board: Board, active: Piece, nextType?: PieceType): Placement[] {
  const placements: Placement[] = [];
  const seen = new Set<string>();
  for (let rotation = 0; rotation < 4; rotation++) {
    const cells = cellsFor(active.type, rotation);
    const width = Math.max(...cells.map((cell) => cell.x)) + 1;
    for (let x = 0; x <= BOARD_WIDTH - width; x++) {
      const piece: Piece = { type: active.type, rotation, x, y: active.y };
      if (!fits(board, piece)) continue;
      piece.y = ghostY(board, piece);
      const shapeKey = cells
        .map((cell) => `${x + cell.x},${piece.y + cell.y}`)
        .sort()
        .join(";");
      if (seen.has(shapeKey)) continue;
      seen.add(shapeKey);
      const placed = placedBoard(board, piece);
      const nextLinePotential = nextType
        ? Math.max(0, ...candidatePlacements(placed.board, spawn(nextType)).map((candidate) => candidate.linesCleared))
        : 0;
      placements.push({
        rotation,
        x,
        y: piece.y,
        linesCleared: placed.linesCleared,
        ...boardFeatures(placed.board),
        nextLinePotential,
      });
    }
  }
  return placements;
}

function shortlistScore(move: Placement): number {
  return move.linesCleared * 90 + move.nextLinePotential * 35
    + move.nearCompleteRows * 7 - move.holes * 10
    - move.aggregateHeight * 0.8 - move.maxHeight * 2 - move.bumpiness * 0.5;
}

export function shortlistPlacements(placements: Placement[], limit = 4): Placement[] {
  return [...placements]
    .sort((a, b) => shortlistScore(b) - shortlistScore(a))
    .slice(0, limit);
}

export function applyPlacement(game: GameState, placement: Placement): GameState {
  if (game.status !== "playing") return game;
  const piece = { ...game.active, rotation: placement.rotation, x: placement.x, y: placement.y };
  if (!fits(game.board, piece) || fits(game.board, { ...piece, y: piece.y + 1 })) return game;
  return lockPiece(game, piece);
}
