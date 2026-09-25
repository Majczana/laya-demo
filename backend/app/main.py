"""FastAPI application exposing the live LAYA emoji experiment."""

from contextlib import asynccontextmanager
from functools import lru_cache
from pathlib import Path
from time import perf_counter
from typing import Any

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, ConfigDict, Field

from app.data_loader import DEFAULT_DATA_DIR, load_emoji_catalog
from app.data_models import EmojiCatalog
from app.laya_requests import build_noul_request
from app.laya_runtime import get_router, predict_noul


CATALOG_PATH = Path(DEFAULT_DATA_DIR) / "emojis_100.json"
MODEL_NAME = "multilingual"
HEAD_MAX_LEN = 256
WARMUP_TEXT = "jedzenie zdrowe"


class PredictionRequest(BaseModel):
    """One partial or complete phrase entered in the UI."""

    model_config = ConfigDict(str_strip_whitespace=True, extra="forbid")

    text: str = Field(min_length=1, max_length=240)


@lru_cache(maxsize=1)
def get_catalog() -> EmojiCatalog:
    """Load and validate the 100-emoji catalog once per process."""

    return load_emoji_catalog(CATALOG_PATH)


@lru_cache(maxsize=256)
def predict_scores(text: str) -> tuple[tuple[str, float], ...]:
    """Cache recent prefixes so deleting and retyping feels immediate."""

    request = build_noul_request(text, get_catalog())
    result = predict_noul(
        request,
        model=MODEL_NAME,
        head_max_len=HEAD_MAX_LEN,
    )
    return tuple(
        (emoji_id, float(answer["noul"]))
        for emoji_id, answer in result["answers"].items()
    )


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Warm the selected model before accepting interactive requests."""

    get_catalog()
    predict_scores(WARMUP_TEXT)
    agent = get_router().load(MODEL_NAME)
    app.state.model_device = str(agent.device)
    yield


app = FastAPI(
    title="LAYA Emoji Demo API",
    version="0.2.0",
    description="Local API for live independent emoji matching with LAYA.",
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
    """Score all emoji independently for a partial or complete phrase."""

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
