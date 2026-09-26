"""Run validated requests through the local LAYA model."""

import os
from functools import lru_cache
from math import isfinite
from threading import Lock
from typing import Any

from app.laya_requests import ChoiceRequest, NoulRequest


os.environ.setdefault("USE_TF", "0")

LAYA_CHECKPOINT = "multilingual"
LAYA_MODEL_NAME = f"convaiinnovations/laya-{LAYA_CHECKPOINT}"
# Token budget for the question head. LAYA also caps every option at 48 tokens,
# so option texts built by the demo must stay shorter than that.
HEAD_MAX_LEN = 256

# FastAPI runs sync endpoints in a thread pool; GPU backends such as MPS crash
# when two predictions share the device concurrently, so run them one by one.
MODEL_LOCK = Lock()


class ModelOutputError(ValueError):
    """Raised when a model returns an answer the demo cannot interpret."""


def configured_device() -> str | None:
    """Resolve LAYA_DEVICE; None lets LAYA select the best available device."""

    value = os.environ.get("LAYA_DEVICE", "auto").strip().lower()
    if value == "auto":
        return None
    if value in {"cpu", "cuda", "mps", "xpu"}:
        return value
    raise ValueError(
        "LAYA_DEVICE must be one of: auto, cpu, cuda, mps, xpu"
    )


@lru_cache(maxsize=1)
def get_router() -> Any:
    """Create one lazy router on the configured device and reuse it."""

    from laya import Router

    return Router(device=configured_device(), max_loaded=1, preload=False)


def loaded_device(model: str = LAYA_CHECKPOINT) -> str:
    """Return the device of the loaded checkpoint, loading it if necessary."""

    return str(get_router().load(model).device)


def predict(
    request: ChoiceRequest | NoulRequest,
    *,
    model: str = LAYA_CHECKPOINT,
    head_max_len: int | None = None,
) -> dict[str, Any]:
    """Run one batch of LAYA questions against the selected checkpoint."""

    options: dict[str, Any] = {"model": model}
    if head_max_len is not None:
        options["head_max_len"] = head_max_len

    with MODEL_LOCK:
        return get_router().predict(request["state"], request["questions"], **options)


# Kept for the experiment scripts; both question types share one code path.
predict_choice = predict
predict_noul = predict


def checked_probability(value: Any, what: str) -> float:
    """Return a model probability as float or raise ModelOutputError."""

    if (
        isinstance(value, bool)
        or not isinstance(value, (int, float))
        or not isfinite(value)
        or not 0 <= value <= 1
    ):
        raise ModelOutputError(f"the model returned an invalid probability for {what}")
    return float(value)


def answer(result: dict[str, Any], question_id: str) -> dict[str, Any]:
    """Return one answer from a model result or raise ModelOutputError."""

    try:
        return result["answers"][question_id]
    except (KeyError, TypeError) as error:
        raise ModelOutputError(f"the model returned no answer for {question_id}") from error
