"""Interpret model answers for the Tetris demo."""

from app.engines import Engine, predict
from app.laya_requests import TetrisBoardFeatures, TetrisMoveFeatures, build_tetris_request
from app.laya_runtime import answer, checked_probability


def score_tetris_moves(
    moves: list[TetrisMoveFeatures], board: TetrisBoardFeatures, engine: Engine = "laya"
) -> list[float]:
    """Return one independent 'this move helps' probability per candidate."""

    result = predict(build_tetris_request(moves, board), engine=engine)
    return [
        checked_probability(answer(result, f"move_{index}").get("noul"), f"move {index}")
        for index in range(len(moves))
    ]
