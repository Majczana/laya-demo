"""Pick which decision model answers a request: local LAYA or hosted Jev."""

from typing import Any, Literal

from app import jev_runtime, laya_runtime
from app.laya_requests import ChoiceRequest, NoulRequest


Engine = Literal["laya", "jev"]

MODEL_NAMES: dict[Engine, str] = {
    "laya": laya_runtime.LAYA_MODEL_NAME,
    "jev": jev_runtime.JEV_MODEL_NAME,
}


def is_available(engine: Engine) -> bool:
    return engine == "laya" or jev_runtime.is_configured()


def predict(request: ChoiceRequest | NoulRequest, *, engine: Engine = "laya") -> dict[str, Any]:
    """Send the same questions to the selected model."""

    if engine == "jev":
        return jev_runtime.predict(request)
    return laya_runtime.predict(request, head_max_len=laya_runtime.HEAD_MAX_LEN)
