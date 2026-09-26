"""Run the same typed requests through Jev via the OpenRouter Decisions API.

Jev (TypeSafe) answers the same state + questions format as LAYA, so the demo
sends identical questions to both models. The only difference is the noul
answer descriptions: LAYA calls them ``labels``, Jev calls them ``criteria``.
"""

import os
from functools import lru_cache
from pathlib import Path
from typing import Any

import httpx

from app.laya_requests import ChoiceRequest, NoulRequest


ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


def load_env_file(path: Path = ENV_FILE) -> None:
    """Read KEY=VALUE lines from the git-ignored .env; real env vars win."""

    if not path.is_file():
        return
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        name, sep, value = line.partition("=")
        name = name.strip()
        if sep and name and not name.startswith("#"):
            os.environ.setdefault(name, value.strip().strip("\"'"))


load_env_file()

JEV_API_URL = os.environ.get("JEV_API_URL", "https://openrouter.ai/api/alpha/decisions")
JEV_MODEL_NAME = os.environ.get("JEV_MODEL", "typesafe/jev-1.13")
REQUEST_TIMEOUT_S = 30.0


class JevError(RuntimeError):
    """Raised when Jev cannot be called or answers with an HTTP error."""


class JevNotConfigured(JevError):
    """Raised when no OpenRouter API key is set."""


def api_key() -> str:
    return os.environ.get("OPENROUTER_API_KEY", "").strip()


def is_configured() -> bool:
    return bool(api_key())


def jev_questions(questions: dict[str, Any]) -> dict[str, Any]:
    """Rename LAYA's noul ``labels`` to the ``criteria`` field Jev expects."""

    converted = {}
    for question_id, question in questions.items():
        question = dict(question)
        if question["type"] == "noul" and "labels" in question:
            question["criteria"] = question.pop("labels")
        converted[question_id] = question
    return converted


@lru_cache(maxsize=1)
def get_client() -> httpx.Client:
    """Reuse one connection pool; typing sends a request per keystroke."""

    return httpx.Client(timeout=REQUEST_TIMEOUT_S)


def error_message(response: httpx.Response) -> str:
    try:
        return str(response.json()["error"]["message"])
    except (ValueError, KeyError, TypeError):
        return response.text[:200] or response.reason_phrase


def predict(request: ChoiceRequest | NoulRequest) -> dict[str, Any]:
    """Send one batch of questions to Jev and return its raw result."""

    key = api_key()
    if not key:
        raise JevNotConfigured("Jev needs OPENROUTER_API_KEY set before starting the backend")

    payload = {
        "model": JEV_MODEL_NAME,
        "state": request["state"],
        "questions": jev_questions(request["questions"]),
    }
    try:
        response = get_client().post(
            JEV_API_URL,
            json=payload,
            headers={"Authorization": f"Bearer {key}", "X-Title": "LAYA demos"},
        )
    except httpx.HTTPError as error:
        raise JevError(f"Jev request failed: {error}") from error

    if response.status_code != 200:
        raise JevError(f"Jev returned HTTP {response.status_code}: {error_message(response)}")
    try:
        return response.json()
    except ValueError as error:
        raise JevError("Jev returned a response that is not JSON") from error
