"""Run validated requests through the local LAYA model."""

import os
from functools import lru_cache
from typing import Any

from app.laya_requests import ChoiceRequest


os.environ.setdefault("USE_TF", "0")


@lru_cache(maxsize=1)
def get_router() -> Any:
    """Create one lazy CPU router and reuse it for later predictions."""

    from laya import Router

    return Router(device="cpu", max_loaded=1, preload=False)


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
