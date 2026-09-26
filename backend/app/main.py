"""FastAPI application exposing live emoji matching by embedding similarity."""

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from threading import Lock
from time import perf_counter
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from app.data_loader import DEFAULT_DATA_DIR, load_emoji_catalog
from app.data_models import EmojiCatalog
from app.embedding_runtime import MODEL_NAME, EmojiScorer


CATALOG_PATH = Path(DEFAULT_DATA_DIR) / "emojis_100.json"
WARMUP_TEXT = "jedzenie zdrowe"

# FastAPI runs sync endpoints in a thread pool; GPU backends such as MPS crash
# when two predictions share the device concurrently, so run them one by one.
MODEL_LOCK = Lock()


class PredictionRequest(BaseModel):
    """One partial or complete phrase entered in the UI."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    text: str = Field(min_length=1, max_length=240)


@lru_cache(maxsize=1)
def get_catalog() -> EmojiCatalog:
    """Load and validate the 100-emoji catalog once per process."""

    return load_emoji_catalog(CATALOG_PATH)


@lru_cache(maxsize=1)
def get_scorer() -> EmojiScorer:
    """Embed the catalog once so each phrase costs a single encoder pass."""

    with MODEL_LOCK:
        return EmojiScorer(get_catalog())


@lru_cache(maxsize=256)
def predict_scores(text: str) -> tuple[tuple[str, float], ...]:
    """Cache recent prefixes so deleting and retyping feels immediate."""

    scorer = get_scorer()
    with MODEL_LOCK:
        scores = scorer.scores(text)
    return tuple(scores.items())


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm the selected model before accepting interactive requests."""

    predict_scores(WARMUP_TEXT)
    app.state.model_device = get_scorer().device
    yield


app = FastAPI(
    title="LAYA Emoji Demo API",
    version="0.3.0",
    description="Local API for live emoji matching with sentence embeddings.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)


@app.get("/health")
def health() -> dict[str, str]:
    """Report readiness and the device selected during warmup."""

    return {
        "status": "ok",
        "phase": "model-ready",
        "model": MODEL_NAME,
        "device": app.state.model_device,
    }


@app.get("/catalog")
def catalog() -> dict[str, Any]:
    """Return display data without exposing model prompt details."""

    emoji_catalog = get_catalog()
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
    raw_scores = predict_scores(payload.text)
    elapsed_ms = (perf_counter() - started_at) * 1000

    scores_by_id = dict(raw_scores)
    ranking = sorted(raw_scores, key=lambda item: item[1], reverse=True)
    rank_by_id = {
        emoji_id: index + 1
        for index, (emoji_id, _) in enumerate(ranking)
    }

    return {
        "text": payload.text,
        "model": MODEL_NAME,
        "device": app.state.model_device,
        "elapsed_ms": round(elapsed_ms, 1),
        "items": [
            {
                "id": item.id,
                "emoji": item.emoji,
                "label": item.label,
                "score": scores_by_id[item.id],
                "rank": rank_by_id[item.id],
            }
            for item in get_catalog().items
        ],
    }
