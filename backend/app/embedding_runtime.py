"""Score emoji by embedding similarity between the phrase and their descriptions."""

import os
from functools import lru_cache
from typing import Any

import numpy as np

from app.data_models import EmojiCatalog


MODEL_NAME = "sdadas/mmlw-retrieval-roberta-large"
# The retriever was trained with this query prefix and no passage prefix.
QUERY_PREFIX = "zapytanie: "

# Cosine similarities sit in a narrow band, so map them linearly to 0-1. On the
# 100-emoji test set unrelated emoji stay below ~0.74 and expected matches sit
# around 0.78-0.83, which puts the UI's default 70% threshold between them.
SIMILARITY_FLOOR = 0.65
SIMILARITY_CEILING = 0.83


def configured_device() -> str | None:
    """Resolve EMBEDDING_DEVICE; None lets PyTorch pick CUDA, MPS or CPU."""

    value = os.environ.get("EMBEDDING_DEVICE", "auto").strip().lower()
    if value == "auto":
        return None
    if value in {"cpu", "cuda", "mps", "xpu"}:
        return value
    raise ValueError(
        "EMBEDDING_DEVICE must be one of: auto, cpu, cuda, mps, xpu"
    )


@lru_cache(maxsize=1)
def get_model() -> Any:
    """Load the sentence encoder once per process."""

    from sentence_transformers import SentenceTransformer

    return SentenceTransformer(MODEL_NAME, device=configured_device())


def document_text(label: str, description: str) -> str:
    """Text embedded for one emoji; the description carries its associations."""

    return f"{label}: {description}"


class EmojiScorer:
    """Precomputed emoji vectors scored against one phrase at a time."""

    def __init__(self, catalog: EmojiCatalog) -> None:
        self.ids = [item.id for item in catalog.items]
        self.vectors = get_model().encode(
            [document_text(item.label, item.description) for item in catalog.items],
            normalize_embeddings=True,
        )

    @property
    def device(self) -> str:
        return str(get_model().device)

    def similarities(self, text: str) -> np.ndarray:
        """Raw cosine similarity of every emoji to the phrase."""

        query = get_model().encode(
            [QUERY_PREFIX + text],
            normalize_embeddings=True,
        )[0]
        return self.vectors @ query

    def scores(self, text: str) -> dict[str, float]:
        """Calibrated 0-1 match score for every emoji."""

        similarities = self.similarities(text)
        calibrated = np.clip(
            (similarities - SIMILARITY_FLOOR)
            / (SIMILARITY_CEILING - SIMILARITY_FLOOR),
            0.0,
            1.0,
        )
        return {
            emoji_id: float(score)
            for emoji_id, score in zip(self.ids, calibrated)
        }
