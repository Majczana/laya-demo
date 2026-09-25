"""Build typed LAYA requests from validated demo data."""

from typing import Literal, TypedDict

from app.data_models import EmojiCatalog


class ChoiceQuestion(TypedDict):
    """One LAYA choice question."""

    type: Literal["choice"]
    instructions: str
    criteria: dict[str, str]


class ChoiceRequest(TypedDict):
    """Complete request accepted by LAYA's prediction interface."""

    state: dict[str, str]
    questions: dict[str, ChoiceQuestion]


def build_choice_request(text: str, catalog: EmojiCatalog) -> ChoiceRequest:
    """Create a choice request without loading or running the model."""

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text must not be empty")

    criteria = {
        item.id: f"{item.label}: {item.description}"
        for item in catalog.items
    }

    return {
        "state": {"text": normalized_text},
        "questions": {
            "emoji_match": {
                "type": "choice",
                "instructions": (
                    "Która opcja najlepiej pasuje do treści użytkownika? "
                    "Oceń znaczenie całej treści i wybierz jedną opcję."
                ),
                "criteria": criteria,
            }
        },
    }
