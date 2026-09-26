"""Check whether LAYA prefers the objectively better of two Tetris moves.

Each pair has one move that is at least as good in every feature and strictly
better in two (more lines, fewer holes, lower stack, more next-piece lines).
A model that ignores the content scores about 50%. The same pairs are also
sent in reverse order to confirm that the answer does not depend on position.
"""

import random

from app.decisions import score_tetris_moves
from app.laya_requests import TetrisBoardFeatures, TetrisMoveFeatures, describe_tetris_move


PAIRS = 60
SEED = 3
# Moves are described relative to the board before them.
BOARD: TetrisBoardFeatures = {"holes": 1, "maxHeight": 6, "bumpiness": 6}


def random_move(rng: random.Random) -> TetrisMoveFeatures:
    return {
        "linesCleared": rng.choice([0, 0, 0, 1, 2]),
        "holes": rng.randint(0, 6),
        "maxHeight": rng.randint(3, 16),
        "bumpiness": rng.randint(2, 14),
        "nextLinePotential": rng.randint(0, 2),
    }


def dominated_pair(rng: random.Random) -> tuple[TetrisMoveFeatures, TetrisMoveFeatures]:
    """Return (better, worse), where the worse move differs in its description."""

    while True:
        better = random_move(rng)
        worse = dict(better)
        for key in rng.sample(list(better), 2):
            if key in ("linesCleared", "nextLinePotential"):
                worse[key] = max(0, better[key] - rng.randint(1, 2))
            else:
                worse[key] = min(20, better[key] + rng.randint(1, 4))
        if describe_tetris_move(better, BOARD) != describe_tetris_move(worse, BOARD):
            return better, worse  # type: ignore[return-value]


def main() -> None:
    rng = random.Random(SEED)
    pairs = [dominated_pair(rng) for _ in range(PAIRS)]
    correct = consistent = 0
    for better, worse in pairs:
        forward = score_tetris_moves([better, worse], BOARD)
        backward = score_tetris_moves([worse, better], BOARD)
        correct += forward[0] > forward[1]
        consistent += (forward[0] > forward[1]) == (backward[1] > backward[0])

    print(f"Better move preferred: {correct}/{PAIRS} (chance: about {PAIRS // 2})")
    print(f"Same preference after swapping order: {consistent}/{PAIRS}")
    print("Synthetic development check, not a measure of game strength.")


if __name__ == "__main__":
    main()
