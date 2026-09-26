"""FastAPI API for the LAYA and Jev demo arcade."""

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from app.data_loader import DEFAULT_DATA_DIR, load_emoji_catalog
from app.data_models import EmojiCatalog
from app.decisions import score_tetris_moves
from app.emoji_scoring import EmojiDecisionScorer
from app.engines import MODEL_NAMES, Engine, is_available
from app.jev_runtime import JevError, JevNotConfigured
from app.laya_requests import TETRIS_INSTRUCTIONS, describe_tetris_move
from app.laya_runtime import LAYA_MODEL_NAME, ModelOutputError


Language = Literal["pl", "en"]

# Same 200 emoji IDs in both files; labels, descriptions and prompts follow the language.
CATALOG_PATHS: dict[str, Path] = {
    "pl": Path(DEFAULT_DATA_DIR) / "emojis_200_pl.json",
    "en": Path(DEFAULT_DATA_DIR) / "emojis_200.json",
}
class PredictionRequest(BaseModel):
    """One partial or complete phrase entered in the UI."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    text: str = Field(min_length=1, max_length=240)
    lang: Language = "pl"
    engine: Engine = "laya"


class TetrisMove(BaseModel):
    """Board features after one legal landing computed by the game engine."""

    model_config = ConfigDict(extra="forbid")

    linesCleared: int = Field(ge=0, le=4)
    holes: int = Field(ge=0, le=200)
    maxHeight: int = Field(ge=0, le=20)
    bumpiness: int = Field(ge=0, le=200)
    nextLinePotential: int = Field(ge=0, le=4)


class TetrisBoard(BaseModel):
    """Features of the board before the move; descriptions are relative to it."""

    model_config = ConfigDict(extra="forbid")

    holes: int = Field(ge=0, le=200)
    maxHeight: int = Field(ge=0, le=20)
    bumpiness: int = Field(ge=0, le=200)


class TetrisRequest(BaseModel):
    """A shortlist of legal placements, in the order the game engine sent them."""

    model_config = ConfigDict(extra="forbid")

    # Up to every distinct landing of one piece (at most 34 on a 10-wide board).
    candidates: list[TetrisMove] = Field(min_length=2, max_length=40)
    board: TetrisBoard
    engine: Engine = "laya"


@lru_cache(maxsize=len(CATALOG_PATHS))
def get_catalog(lang: Language) -> EmojiCatalog:
    """Load and validate one language's 200-emoji catalog once per process."""

    return load_emoji_catalog(CATALOG_PATHS[lang])


@lru_cache(maxsize=len(CATALOG_PATHS))
def get_scorer(lang: Language) -> EmojiDecisionScorer:
    """Load the emoji catalog once; LAYA is loaded lazily on first inference."""

    return EmojiDecisionScorer(get_catalog(lang))


@lru_cache(maxsize=512)
def predict_scores(
    text: str, lang: Language, engine: Engine = "laya"
) -> tuple[tuple[str, float], ...]:
    """Cache recent prefixes so deleting, retyping and switching models feels immediate.

    For Jev the cache also avoids paying again for a phrase already scored.
    """

    return tuple(get_scorer(lang).scores(text, engine).items())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Validate catalogs without blocking startup on the LAYA checkpoint.

    LAYA is loaded lazily by the first prediction, so the API can serve the
    catalog and expose the Jev switch while the local model is still cold.
    """

    # The UI keeps the emoji pile when the language changes, so IDs must match.
    ids = {lang: [item.id for item in get_catalog(lang).items] for lang in CATALOG_PATHS}
    if len({tuple(values) for values in ids.values()}) != 1:
        raise RuntimeError("all emoji catalogs must list the same IDs in the same order")
    yield


app = FastAPI(
    title="LAYA Arcade API",
    version="0.7.0",
    description="API for the Emoji Rain and Tetris demos using local LAYA or hosted Jev.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.exception_handler(ModelOutputError)
def model_output_error(_: Request, error: ModelOutputError) -> JSONResponse:
    """Report unusable model output as a bad gateway, not a server crash."""

    return JSONResponse(status_code=502, content={"detail": str(error)})


@app.exception_handler(JevError)
def jev_error(_: Request, error: JevError) -> JSONResponse:
    """Missing key is a configuration problem; anything else is an upstream failure."""

    status_code = 503 if isinstance(error, JevNotConfigured) else 502
    return JSONResponse(status_code=status_code, content={"detail": str(error)})


@app.get("/health")
def health() -> dict[str, Any]:
    """Report API readiness and which models can be selected.

    Calling ``loaded_device`` here would load LAYA as a side effect, so health
    reports ``pending`` until the first prediction needs the checkpoint.
    """

    return {
        "status": "ok",
        "phase": "api-ready",
        "model": LAYA_MODEL_NAME,
        "device": "pending",
        "engines": {
            engine: {"model": model, "available": is_available(engine)}
            for engine, model in MODEL_NAMES.items()
        },
    }


@app.get("/catalog")
def catalog(lang: Language = "pl") -> dict[str, Any]:
    """Return display data without exposing model prompt details."""

    emoji_catalog = get_catalog(lang)
    return {
        "version": emoji_catalog.version,
        "language": emoji_catalog.language,
        "items": [
            {"id": item.id, "emoji": item.emoji, "label": item.label}
            for item in emoji_catalog.items
        ],
    }


@app.post("/predict")
def predict(payload: PredictionRequest) -> dict[str, Any]:
    """Score all emoji for a partial or complete phrase."""

    started_at = perf_counter()
    raw_scores = predict_scores(payload.text, payload.lang, payload.engine)
    elapsed_ms = (perf_counter() - started_at) * 1000

    scores_by_id = dict(raw_scores)
    ranking = sorted(raw_scores, key=lambda item: item[1], reverse=True)
    rank_by_id = {
        emoji_id: index + 1
        for index, (emoji_id, _) in enumerate(ranking)
    }

    return {
        "text": payload.text,
        "lang": payload.lang,
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round(elapsed_ms, 1),
        "items": [
            {
                "id": item.id,
                "emoji": item.emoji,
                "label": item.label,
                "score": scores_by_id[item.id],
                "rank": rank_by_id[item.id],
            }
            for item in get_catalog(payload.lang).items
        ],
    }


@app.post("/tetris/choose")
def tetris_choose(payload: TetrisRequest) -> dict[str, Any]:
    """Let the selected model rate placements already validated by the game engine."""

    moves = [candidate.model_dump() for candidate in payload.candidates]
    board = payload.board.model_dump()
    started_at = perf_counter()
    scores = score_tetris_moves(moves, board, payload.engine)

    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        "selected_index": max(range(len(scores)), key=scores.__getitem__),
        "scores": scores,
        # What the model saw, so the UI can show it next to the scores.
        "question": TETRIS_INSTRUCTIONS.format(description="<move description>"),
        "descriptions": [describe_tetris_move(move, board) for move in moves],
    }
