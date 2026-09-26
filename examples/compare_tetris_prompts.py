"""Compare Tetris question wordings, move descriptions and candidate counts.

Plays seeded headless games with a Python port of frontend/src/tetrisEngine.ts
and lets the model pick among the candidate moves with one independent noul
question per move. Every variant sees the same piece sequences.

    python examples/compare_tetris_prompts.py --engine laya
    python examples/compare_tetris_prompts.py --engine jev --variants q2-d2-all
"""

import argparse
import random
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))

from app.engines import predict  # noqa: E402
from app.laya_requests import (  # noqa: E402
    TETRIS_INSTRUCTIONS,
    describe_tetris_move,
    describe_tetris_move_absolute,
)

WIDTH, HEIGHT = 10, 20
SHAPES = {
    "I": [(0, 1), (1, 1), (2, 1), (3, 1)],
    "O": [(1, 0), (2, 0), (1, 1), (2, 1)],
    "T": [(1, 0), (0, 1), (1, 1), (2, 1)],
    "S": [(1, 0), (2, 0), (0, 1), (1, 1)],
    "Z": [(0, 0), (1, 0), (1, 1), (2, 1)],
    "J": [(0, 0), (0, 1), (1, 1), (2, 1)],
    "L": [(2, 0), (0, 1), (1, 1), (2, 1)],
}


# ---------- engine port (same rules as tetrisEngine.ts) ----------

def cells(piece: str, rotation: int) -> list[tuple[int, int]]:
    points = list(SHAPES[piece])
    for _ in range(rotation % 4):
        points = [(3 - y, x) for x, y in points]
    min_x = min(x for x, _ in points)
    min_y = min(y for _, y in points)
    return [(x - min_x, y - min_y) for x, y in points]


def fits(board, piece, rotation, px, py) -> bool:
    for x, y in cells(piece, rotation):
        column, row = px + x, py + y
        if column < 0 or column >= WIDTH or row >= HEIGHT:
            return False
        if row >= 0 and board[row][column]:
            return False
    return True


def place(board, piece, rotation, px, py):
    placed = [row[:] for row in board]
    for x, y in cells(piece, rotation):
        placed[py + y][px + x] = True
    remaining = [row for row in placed if not all(row)]
    cleared = HEIGHT - len(remaining)
    return [[False] * WIDTH for _ in range(cleared)] + remaining, cleared


def features(board) -> dict:
    heights = []
    for x in range(WIDTH):
        first = next((y for y in range(HEIGHT) if board[y][x]), None)
        heights.append(0 if first is None else HEIGHT - first)
    holes = 0
    for x in range(WIDTH):
        filled = False
        for y in range(HEIGHT):
            if board[y][x]:
                filled = True
            elif filled:
                holes += 1
    return {
        "holes": holes,
        "maxHeight": max(heights),
        "aggregateHeight": sum(heights),
        "bumpiness": sum(abs(a - b) for a, b in zip(heights, heights[1:])),
        "nearCompleteRows": sum(1 for row in board if sum(row) >= 8),
    }


def spawn_x(piece: str) -> int:
    width = max(x for x, _ in cells(piece, 0)) + 1
    return (WIDTH - width) // 2


def candidates(board, piece, next_piece=None) -> list[dict]:
    moves, seen = [], set()
    for rotation in range(4):
        width = max(x for x, _ in cells(piece, rotation)) + 1
        for x in range(WIDTH - width + 1):
            if not fits(board, piece, rotation, x, 0):
                continue
            y = 0
            while fits(board, piece, rotation, x, y + 1):
                y += 1
            key = tuple(sorted((x + cx, y + cy) for cx, cy in cells(piece, rotation)))
            if key in seen:
                continue
            seen.add(key)
            after, cleared = place(board, piece, rotation, x, y)
            potential = 0
            if next_piece:
                potential = max([m["linesCleared"] for m in candidates(after, next_piece)] or [0])
            moves.append({
                "rotation": rotation, "x": x, "y": y, "linesCleared": cleared,
                "nextLinePotential": potential, "board": after, **features(after),
            })
    return moves


def shortlist_score(m) -> float:
    return (m["linesCleared"] * 90 + m["nextLinePotential"] * 35 + m["nearCompleteRows"] * 7
            - m["holes"] * 10 - m["aggregateHeight"] * 0.8 - m["maxHeight"] * 2 - m["bumpiness"] * 0.5)


def shortlist(moves, limit):
    ranked = sorted(moves, key=shortlist_score, reverse=True)
    return ranked if limit is None else ranked[:limit]


# ---------- descriptions and questions ----------

QUESTIONS = {
    "q1": TETRIS_INSTRUCTIONS,
    "q2": (
        "Is this a good Tetris move? A good move clears lines, creates no new holes, "
        "keeps the stack low and keeps the surface flat. The move {description}."
    ),
}
DESCRIBERS = {
    "d1": lambda move, before: describe_tetris_move_absolute(move),
    "d2": describe_tetris_move,
}
LIMITS = {"4": 4, "8": 8, "all": None}


@dataclass
class Variant:
    name: str
    question: str | None  # None: no model, use a reference picker
    describer: str | None
    limit: int | None
    picker: str = "model"


def variant(name: str) -> Variant:
    if name.startswith(("heuristic-", "random-")):
        picker, limit = name.split("-")
        return Variant(name, None, None, LIMITS[limit], picker)
    q, d, limit = name.split("-")
    return Variant(name, q, d, LIMITS[limit])


# ---------- games ----------

def bag(rng: random.Random) -> list[str]:
    pieces = list("IOTSZJL")
    rng.shuffle(pieces)
    return pieces


def play(v: Variant, engine: str, game_seed: int, max_pieces: int, stats: dict) -> int:
    rng = random.Random(game_seed)
    pick_rng = random.Random(game_seed + 7)
    queue = bag(rng) + bag(rng)
    board = [[False] * WIDTH for _ in range(HEIGHT)]
    lines = 0
    for _ in range(max_pieces):
        if len(queue) < 7:
            queue += bag(rng)
        piece, next_piece = queue[0], queue[1]
        if not fits(board, piece, 0, spawn_x(piece), 0):
            break
        moves = shortlist(candidates(board, piece, next_piece), v.limit)
        if not moves:
            break
        if len(moves) == 1 or v.picker == "heuristic":
            choice = 0
        elif v.picker == "random":
            choice = pick_rng.randrange(len(moves))
        else:
            before = features(board)
            template = QUESTIONS[v.question]
            request = {
                "state": {"game": "Tetris"},
                "questions": {
                    f"move_{i}": {
                        "type": "noul",
                        "instructions": template.format(description=DESCRIBERS[v.describer](m, before)),
                        "labels": {"false": "no", "true": "yes"},
                    }
                    for i, m in enumerate(moves)
                },
            }
            started = time.perf_counter()
            result = predict(request, engine=engine)
            stats["ms"] += (time.perf_counter() - started) * 1000
            stats["calls"] += 1
            scores = [result["answers"][f"move_{i}"]["noul"] for i in range(len(moves))]
            best = max(scores)
            choice = scores.index(best)
            stats["ties"] += scores.count(best) > 1
        stats["pieces"] += 1
        chosen = moves[choice]
        board, lines = chosen["board"], lines + chosen["linesCleared"]
        queue.pop(0)
    return lines


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--engine", choices=["laya", "jev"], default="laya")
    parser.add_argument("--games", type=int, default=6)
    parser.add_argument("--max-pieces", type=int, default=250)
    parser.add_argument("--workers", type=int, default=1, help="games played in parallel (useful for jev)")
    parser.add_argument("--variants", nargs="+", default=[
        "heuristic-4", "random-4", "random-all",
        "q1-d1-4", "q1-d1-all", "q1-d2-4", "q2-d2-4", "q2-d2-all",
    ])
    args = parser.parse_args()

    for name in args.variants:
        v = variant(name)
        stats = {"ms": 0.0, "calls": 0, "ties": 0, "pieces": 0}
        seeds = [1000 + index for index in range(args.games)]
        with ThreadPoolExecutor(max_workers=args.workers) as pool:
            lines = list(pool.map(lambda s: play(v, args.engine, s, args.max_pieces, stats), seeds))
        mean = sum(lines) / len(lines)
        extra = ""
        if stats["calls"]:
            extra = (f"  avg {stats['ms'] / stats['calls']:.0f} ms/call"
                     f"  ties {100 * stats['ties'] / stats['calls']:.0f}%")
        print(f"{name:<12} lines: {', '.join(map(str, lines))}  mean {mean:.1f}"
              f"  pieces {stats['pieces']}{extra}", flush=True)


if __name__ == "__main__":
    main()
