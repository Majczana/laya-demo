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


class NoulQuestion(TypedDict):
    """One independent LAYA yes-or-no question."""

    type: Literal["noul"]
    instructions: str
    labels: dict[Literal["false", "true"], str]


class NoulRequest(TypedDict):
    """A batch of independent emoji matching questions."""

    state: dict[str, str]
    questions: dict[str, NoulQuestion]


CriteriaMode = Literal["descriptions", "labels"]
OptionKeyMode = Literal["ids", "opaque"]


def build_option_key_map(
    catalog: EmojiCatalog,
    *,
    option_key_mode: OptionKeyMode = "ids",
) -> dict[str, str]:
    """Map model-facing option keys to stable emoji IDs."""

    if option_key_mode == "ids":
        return {item.id: item.id for item in catalog.items}
    if option_key_mode == "opaque":
        if len(catalog.items) > 26:
            raise ValueError("opaque A-Z keys support at most 26 options")
        return {
            chr(ord("A") + index): item.id
            for index, item in enumerate(catalog.items)
        }
    raise ValueError(f"unsupported option key mode: {option_key_mode}")


def build_choice_request(
    text: str,
    catalog: EmojiCatalog,
    *,
    criteria_mode: CriteriaMode = "descriptions",
    option_key_mode: OptionKeyMode = "ids",
) -> ChoiceRequest:
    """Create a choice request without loading or running the model."""

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text must not be empty")

    option_keys = build_option_key_map(
        catalog,
        option_key_mode=option_key_mode,
    )
    items_by_id = {item.id: item for item in catalog.items}

    if criteria_mode == "descriptions":
        criteria = {
            option_key: (
                f"{items_by_id[emoji_id].label}: "
                f"{items_by_id[emoji_id].description}"
            )
            for option_key, emoji_id in option_keys.items()
        }
    elif criteria_mode == "labels":
        criteria = {
            option_key: items_by_id[emoji_id].label
            for option_key, emoji_id in option_keys.items()
        }
    else:
        raise ValueError(f"unsupported criteria mode: {criteria_mode}")

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


def build_noul_request(text: str, catalog: EmojiCatalog) -> NoulRequest:
    """Create one independent yes-or-no matching question per emoji."""

    normalized_text = text.strip()
    if not normalized_text:
        raise ValueError("text must not be empty")

    return {
        "state": {"text": normalized_text},
        "questions": {
            item.id: {
                "type": "noul",
                "instructions": (
                    "Czy treść użytkownika w polu `text` pasuje znaczeniowo "
                    f"do kategorii „{item.label}: {item.description}”?"
                ),
                "labels": {"false": "nie", "true": "tak"},
            }
            for item in catalog.items
        },
    }
