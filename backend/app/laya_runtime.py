"""Run validated requests through the local LAYA model."""

import os
from functools import lru_cache
from typing import Any

from app.laya_requests import ChoiceRequest, NoulRequest


os.environ.setdefault("USE_TF", "0")


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


def predict_choice(
    request: ChoiceRequest,
    *,
    model: str = "multilingual",
    head_max_len: int | None = None,
) -> dict[str, Any]:
    """Run one choice request against the selected LAYA checkpoint."""

    router = get_router()
    options: dict[str, Any] = {"model": model}
    if head_max_len is not None:
        options["head_max_len"] = head_max_len

    return router.predict(request["state"], request["questions"], **options)


def predict_noul(
    request: NoulRequest,
    *,
    model: str = "multilingual",
    head_max_len: int | None = None,
) -> dict[str, Any]:
    """Run a batch of independent noul questions in one model call."""

    router = get_router()
    options: dict[str, Any] = {"model": model}
    if head_max_len is not None:
        options["head_max_len"] = head_max_len

    return router.predict(request["state"], request["questions"], **options)
