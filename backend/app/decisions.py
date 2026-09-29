"""Interpret model answers for the Tetris and Snake demos."""

from app.engines import Engine, predict
from app.laya_requests import (
    SnakeMoveFeatures,
    SnakeStrategyFeatures,
    TetrisBoardFeatures,
    TetrisMoveFeatures,
    build_snake_request,
    build_snake_strategy_request,
    build_tetris_request,
)
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


def score_snake_moves(moves: list[SnakeMoveFeatures], engine: Engine = "laya") -> list[float]:
    """Return one independent 'this move helps' probability per legal move."""

    result = predict(build_snake_request(moves), engine=engine)
    return [
        checked_probability(answer(result, f"move_{index}").get("noul"), f"move {index}")
        for index in range(len(moves))
    ]


def score_snake_strategies(options: list[SnakeStrategyFeatures], engine: Engine = "laya") -> list[float]:
    """Return one independent 'this strategy helps' probability per offered strategy."""

    result = predict(build_snake_strategy_request(options), engine=engine)
    return [
        checked_probability(answer(result, f"move_{index}").get("noul"), f"strategy {index}")
        for index in range(len(options))
    ]
