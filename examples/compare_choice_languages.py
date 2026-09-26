"""Compare Polish and English emoji descriptions on Polish test phrases."""

import json
import math
import sys
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any

from app.data_loader import load_emoji_catalog, load_test_suite
from app.data_models import EmojiCatalog, TestCase, TestSuite
from app.laya_requests import build_choice_request
from app.laya_runtime import predict_choice


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CATALOGS = {
    "pl": PROJECT_ROOT / "data" / "emojis_pl.json",
    "en": PROJECT_ROOT / "data" / "emojis_eng.json",
}
FOCUS_CASE_ID = "healthy-food"


def validate_comparable_catalogs(
    polish: EmojiCatalog,
    english: EmojiCatalog,
) -> None:
    """Ensure language text is the only experimental variable."""

    polish_identity = [(item.id, item.emoji) for item in polish.items]
    english_identity = [(item.id, item.emoji) for item in english.items]
    if polish_identity != english_identity:
        raise ValueError(
            "catalogs must contain identical IDs and emoji in the same order"
        )


def ranking_from_result(result: dict[str, Any]) -> list[tuple[str, float]]:
    """Return model probabilities ordered from highest to lowest."""

    probabilities = result["answers"]["emoji_match"]["probabilities"]
    return sorted(probabilities.items(), key=lambda item: item[1], reverse=True)


def ndcg_at_k(
    ranking: list[tuple[str, float]],
    test_case: TestCase,
    suite: TestSuite,
) -> float:
    """Calculate NDCG using the relevance weights stored in the test suite."""

    relevance = suite.evaluation.relevance
    primary = set(test_case.expected.primary)
    related = set(test_case.expected.related)

    def grade(emoji_id: str) -> int:
        if emoji_id in primary:
            return relevance.primary
        if emoji_id in related:
            return relevance.related
        return relevance.other

    k = suite.evaluation.k
    actual_grades = [grade(emoji_id) for emoji_id, _ in ranking[:k]]
    ideal_grades = sorted(
        [
            *([relevance.primary] * len(primary)),
            *([relevance.related] * len(related)),
            *([relevance.other] * max(0, k - len(primary) - len(related))),
        ],
        reverse=True,
    )[:k]

    def discounted_gain(grades: list[int]) -> float:
        return sum(
            (2**value - 1) / math.log2(position + 2)
            for position, value in enumerate(grades)
        )

    ideal_gain = discounted_gain(ideal_grades)
    if ideal_gain == 0:
        return 0.0
    return discounted_gain(actual_grades) / ideal_gain


def run_catalog(catalog: EmojiCatalog, suite: TestSuite) -> dict[str, Any]:
    """Run every test case with one catalog and summarize its quality."""

    cases: list[dict[str, Any]] = []
    started_at = perf_counter()

    for test_case in suite.cases:
        request = build_choice_request(test_case.input, catalog)
        result = predict_choice(request, head_max_len=256)
        ranking = ranking_from_result(result)
        cases.append(
            {
                "id": test_case.id,
                "input": test_case.input,
                "choice": ranking[0][0],
                "ndcg_at_5": round(ndcg_at_k(ranking, test_case, suite), 4),
                "top_5": [
                    {"id": emoji_id, "probability": probability}
                    for emoji_id, probability in ranking[:5]
                ],
            }
        )

    return {
        "mean_ndcg_at_5": round(mean(case["ndcg_at_5"] for case in cases), 4),
        "elapsed_seconds": round(perf_counter() - started_at, 3),
        "focus_case": next(case for case in cases if case["id"] == FOCUS_CASE_ID),
        "cases": cases,
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    suite = load_test_suite()
    catalogs = {
        language: load_emoji_catalog(path)
        for language, path in CATALOGS.items()
    }
    validate_comparable_catalogs(catalogs["pl"], catalogs["en"])

    print("Rozgrzewam model...", file=sys.stderr)
    warmup_request = build_choice_request(suite.cases[0].input, catalogs["pl"])
    predict_choice(warmup_request, head_max_len=256)

    comparisons = {
        language: run_catalog(catalog, suite)
        for language, catalog in catalogs.items()
    }
    output = {
        "model": "multilingual",
        "input_language": suite.language,
        "head_max_len": 256,
        "criteria_mode": "descriptions",
        "variable": "catalog_language",
        "comparisons": comparisons,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
