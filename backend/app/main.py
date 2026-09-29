"""FastAPI API for the LAYA and Jev demo arcade."""

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any, Literal

import httpx
from fastapi import FastAPI, File, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.data_loader import DEFAULT_DATA_DIR, load_emoji_catalog
from app.data_models import EmojiCatalog
from app.decisions import score_snake_moves, score_snake_strategies, score_tetris_moves
from app.emoji_scoring import EmojiDecisionScorer
from app.engines import MODEL_NAMES, Engine, is_available
from app.jev_runtime import JevError, JevNotConfigured
from app.injection import detect as detect_injection
from app.laya_requests import (
    SNAKE_INSTRUCTIONS,
    TETRIS_INSTRUCTIONS,
    describe_snake_move,
    describe_snake_strategy,
    describe_tetris_move,
)
from app.laya_runtime import LAYA_MODEL_NAME, ModelOutputError
from app.ticket_triage import triage as triage_ticket
from app.repair_scoring import score_repair
from app.note_gate import gate_note
from app.action_gate import review_action
from app.grounding import NoClaims, check_answer
from app.parts_locator import locate as locate_parts
from app.document_sorting import CATEGORIES as DOCUMENT_CATEGORIES, TAGS as DOCUMENT_TAGS, classify as classify_document, extract_text as extract_document_text, openai_available
from app.ticket_triage import ROBOT_MODELS


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


class InjectionRequest(BaseModel):
    """Untrusted text to classify; examples are selected only in the browser."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    text: str = Field(min_length=1, max_length=4000)
    lang: Language = "pl"
    engine: Engine = "laya"


class TicketRequest(BaseModel):
    """One untrusted customer message with optional model and case details."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    ticket: str = Field(min_length=1, max_length=6000)
    lang: Language = "pl"
    engine: Engine = "laya"


class ScoreCriterion(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    name: str = Field(min_length=1, max_length=60)
    question: str = Field(min_length=5, max_length=300)
    levels: tuple[str, str, str]

    @field_validator("levels")
    @classmethod
    def nonempty_levels(cls, levels: tuple[str, str, str]) -> tuple[str, str, str]:
        if any(not level.strip() or len(level) > 120 for level in levels):
            raise ValueError("each level must contain 1–120 characters")
        return levels


class RepairScoreRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    description: str = Field(min_length=1, max_length=4000)
    technician_note: str = Field(default="", max_length=4000)
    history: str = Field(default="", max_length=4000)
    criteria: list[ScoreCriterion] = Field(min_length=1, max_length=8)
    engine: Engine = "laya"


class NoteGateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    context: str = Field(min_length=1, max_length=4000)
    draft: str = Field(min_length=1, max_length=4000)
    mode: Literal["customer_reply", "service_note", "sales_note"] = "service_note"
    lang: Language = "pl"
    engine: Engine = "laya"


class GroundingRequest(BaseModel):
    """A source text and an assistant answer to check against it, sentence by sentence."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    source: str = Field(min_length=1, max_length=4000)
    answer: str = Field(min_length=1, max_length=2000)
    lang: Language = "pl"
    engine: Engine = "laya"


class PartsRequest(BaseModel):
    """A fault description and the robot family whose parts should be rated."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    symptom: str = Field(min_length=3, max_length=1500)
    robot: Literal["delivery", "cleaning"] = "delivery"
    lang: Language = "pl"
    engine: Engine = "laya"


class ActionReviewRequest(BaseModel):
    """A proposed action and its justification; execution stays in the demo UI."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    action: Literal["remove_robot", "reject_project", "cancel_visit", "close_ticket"]
    target: str = Field(min_length=1, max_length=160)
    context: str = Field(min_length=1, max_length=3000)
    reason: str = Field(min_length=1, max_length=3000)
    lang: Language = "pl"


class DocumentClassifyRequest(BaseModel):
    """Extracted document text; original file bytes stay on the local backend."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")
    filename: str = Field(min_length=1, max_length=180)
    content: str = Field(min_length=1, max_length=20000)
    lang: Language = "pl"
    engine: Literal["jev", "openai"] = "jev"


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


class SnakeMove(BaseModel):
    """Features of one legal Snake move computed by the game engine."""

    model_config = ConfigDict(extra="forbid")

    eats: bool
    foodDelta: int = Field(ge=-1, le=1)
    openPercent: int = Field(ge=0, le=100)
    exits: int = Field(ge=0, le=3)
    boxedIn: bool


class SnakeRequest(BaseModel):
    """The legal moves of one turn (at most straight, left and right), in the order the engine sent them."""

    model_config = ConfigDict(extra="forbid")

    candidates: list[SnakeMove] = Field(min_length=2, max_length=3)
    engine: Engine = "laya"


class SnakeStrategy(BaseModel):
    """What following one Snake strategy leads to, computed by the game engine."""

    model_config = ConfigDict(extra="forbid")

    strategy: Literal["food", "tail", "space"]
    steps: int = Field(ge=0, le=1000)
    safe: bool
    openPercent: int = Field(ge=0, le=100)


class SnakeStrategyRequest(BaseModel):
    """The strategies offered on one position (food, tail, space), in the order the engine sent them."""

    model_config = ConfigDict(extra="forbid")

    candidates: list[SnakeStrategy] = Field(min_length=2, max_length=3)
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
    version="0.8.0",
    description="API for six decision demos using local LAYA or hosted Jev.",
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


@app.post("/snake/choose")
def snake_choose(payload: SnakeRequest) -> dict[str, Any]:
    """Let the selected model rate the legal Snake moves already validated by the game engine."""

    moves = [candidate.model_dump() for candidate in payload.candidates]
    started_at = perf_counter()
    scores = score_snake_moves(moves, payload.engine)

    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        "selected_index": max(range(len(scores)), key=scores.__getitem__),
        "scores": scores,
        "question": SNAKE_INSTRUCTIONS.format(description="<move description>"),
        "descriptions": [describe_snake_move(move) for move in moves],
    }


@app.post("/snake/strategy")
def snake_strategy(payload: SnakeStrategyRequest) -> dict[str, Any]:
    """Let the selected model rate the Snake strategies the game engine offers on this position."""

    options = [candidate.model_dump() for candidate in payload.candidates]
    started_at = perf_counter()
    scores = score_snake_strategies(options, payload.engine)

    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        "selected_index": max(range(len(scores)), key=scores.__getitem__),
        "scores": scores,
        "question": SNAKE_INSTRUCTIONS.format(description="<strategy description>"),
        "descriptions": [describe_snake_strategy(option) for option in options],
    }


@app.post("/injection/detect")
def injection_detect(payload: InjectionRequest) -> dict[str, Any]:
    """Classify one untrusted prompt and return observed usage and cost."""

    started_at = perf_counter()
    decision = detect_injection(payload.text, payload.lang, payload.engine)
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **decision,
    }


@app.post("/tickets/triage")
def tickets_triage(payload: TicketRequest) -> dict[str, Any]:
    """Return every typed score plus exact model-facing JSON for inspection."""

    started_at = perf_counter()
    result = triage_ticket(payload.ticket, payload.lang, payload.engine)
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.post("/repairs/score")
def repairs_score(payload: RepairScoreRequest) -> dict[str, Any]:
    """Score default or user-defined dimensions and expose sent/received JSON."""

    started_at = perf_counter()
    state = {
        "description": payload.description,
        "technician_note": payload.technician_note,
        "history": payload.history,
    }
    result = score_repair(state, [criterion.model_dump() for criterion in payload.criteria], payload.engine)
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.post("/notes/gate")
def notes_gate(payload: NoteGateRequest) -> dict[str, Any]:
    """Check draft completeness and expose the raw decision for inspection."""

    started_at = perf_counter()
    result = gate_note(payload.context, payload.draft, payload.mode, payload.lang, payload.engine)
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.post("/grounding/check")
def grounding_check(payload: GroundingRequest) -> dict[str, Any]:
    """Check each sentence of an answer against the source and expose the raw decision."""

    started_at = perf_counter()
    try:
        result = check_answer(payload.source, payload.answer, payload.lang, payload.engine)
    except ValueError as error:
        if isinstance(error, ModelOutputError):
            raise
        raise HTTPException(status_code=422, detail=str(error)) from error
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.post("/parts/locate")
def parts_locate(payload: PartsRequest) -> dict[str, Any]:
    """Rate every part of the robot family against the described fault."""

    started_at = perf_counter()
    result = locate_parts(payload.symptom, payload.robot, payload.lang, payload.engine)
    return {
        "engine": payload.engine,
        "model": MODEL_NAMES[payload.engine],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.post("/actions/review")
def actions_review(payload: ActionReviewRequest) -> dict[str, Any]:
    """Review a proposed action with Jev; no live system action is performed."""

    started_at = perf_counter()
    result = review_action(payload.action, payload.target, payload.context, payload.reason, payload.lang)
    return {
        "engine": "jev", "model": MODEL_NAMES["jev"],
        "elapsed_ms": round((perf_counter() - started_at) * 1000, 1),
        **result,
    }


@app.get("/documents/status")
def documents_status() -> dict[str, bool]:
    """Show available document classifiers without exposing credentials."""

    return {"jev": is_available("jev"), "openai": openai_available()}


@app.get("/documents/catalog")
def documents_catalog() -> dict[str, Any]:
    """Return the folder taxonomy used by the document demo."""

    return {
        "models": {key: {"name": item[0], "family": item[1]} for key, item in ROBOT_MODELS.items()},
        "categories": {key: {"pl": labels[0], "en": labels[1]} for key, labels in DOCUMENT_CATEGORIES.items()},
        "tags": {key: {"pl": labels[0], "en": labels[1]} for key, labels in DOCUMENT_TAGS.items()},
    }


@app.post("/documents/extract")
async def documents_extract(file: UploadFile = File(...)) -> dict[str, Any]:
    """Extract text locally; no file bytes are forwarded to a model."""

    data = await file.read(10_000_001)
    try:
        return extract_document_text(file.filename or "document", data)
    except (ValueError, OSError, KeyError, RuntimeError) as error:
        raise HTTPException(status_code=422, detail=str(error)) from error


@app.post("/documents/classify")
def documents_classify(payload: DocumentClassifyRequest) -> dict[str, Any]:
    """Propose a folder using Jev or an optional OpenAI Responses model."""

    if payload.engine == "openai" and not openai_available():
        raise HTTPException(status_code=503, detail="OPENAI_API_KEY is not configured")
    started_at = perf_counter()
    try:
        result = classify_document(payload.filename, payload.content, payload.lang, payload.engine)
    except httpx.HTTPError as error:
        raise HTTPException(status_code=502, detail=f"document model request failed: {error}") from error
    return {"elapsed_ms": round((perf_counter() - started_at) * 1000, 1), **result}
