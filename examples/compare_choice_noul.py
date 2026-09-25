"""Compare one choice question with independent noul questions."""

import json
import math
import sys
from statistics import mean
from time import perf_counter
from typing import Any

from app.data_loader import load_demo_data
from app.data_models import TestCase, TestSuite
from app.laya_requests import build_choice_request, build_noul_request
from app.laya_runtime import predict_choice, predict_noul


FOCUS_CASE_ID = "healthy-food"


def ndcg_at_k(
    ranking: list[tuple[str, float]],
    test_case: TestCase,
    suite: TestSuite,
) -> float:
    """Calculate NDCG using the relevance weights from the test suite."""

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
    actual = [grade(emoji_id) for emoji_id, _ in ranking[:k]]
    ideal = sorted(
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

    ideal_gain = discounted_gain(ideal)
    return discounted_gain(actual) / ideal_gain if ideal_gain else 0.0


def choice_ranking(result: dict[str, Any]) -> list[tuple[str, float]]:
    """Convert a choice response into an emoji ranking."""

    probabilities = result["answers"]["emoji_match"]["probabilities"]
    return sorted(probabilities.items(), key=lambda item: item[1], reverse=True)


def noul_ranking(result: dict[str, Any]) -> list[tuple[str, float]]:
    """Rank emoji by their independent probability of a true answer."""

    probabilities = {
        emoji_id: answer["noul"]
        for emoji_id, answer in result["answers"].items()
    }
    return sorted(probabilities.items(), key=lambda item: item[1], reverse=True)


def case_summary(
    test_case: TestCase,
    suite: TestSuite,
    ranking: list[tuple[str, float]],
    result: dict[str, Any],
    elapsed_seconds: float,
) -> dict[str, Any]:
    """Build comparable measurements for one prediction."""

    return {
        "id": test_case.id,
        "input": test_case.input,
        "ndcg_at_5": round(ndcg_at_k(ranking, test_case, suite), 4),
        "elapsed_seconds": round(elapsed_seconds, 3),
        "input_tokens": result["usage"]["input_tokens"],
        "top_5": [
            {"id": emoji_id, "probability": probability}
            for emoji_id, probability in ranking[:5]
        ],
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    data = load_demo_data()

    print("Rozgrzewam model...", file=sys.stderr)
    warmup = build_choice_request(data.tests.cases[0].input, data.emojis)
    predict_choice(warmup, head_max_len=256)

    results: dict[str, list[dict[str, Any]]] = {"choice": [], "noul": []}
    for test_case in data.tests.cases:
        choice_request = build_choice_request(test_case.input, data.emojis)
        started_at = perf_counter()
        choice_result = predict_choice(choice_request, head_max_len=256)
        choice_elapsed = perf_counter() - started_at
        results["choice"].append(
            case_summary(
                test_case,
                data.tests,
                choice_ranking(choice_result),
                choice_result,
                choice_elapsed,
            )
        )

        noul_request = build_noul_request(test_case.input, data.emojis)
        started_at = perf_counter()
        noul_result = predict_noul(noul_request, head_max_len=256)
        noul_elapsed = perf_counter() - started_at
        results["noul"].append(
            case_summary(
                test_case,
                data.tests,
                noul_ranking(noul_result),
                noul_result,
                noul_elapsed,
            )
        )

    comparisons = {
        mode: {
            "mean_ndcg_at_5": round(
                mean(case["ndcg_at_5"] for case in cases), 4
            ),
            "mean_elapsed_seconds": round(
                mean(case["elapsed_seconds"] for case in cases), 3
            ),
            "mean_input_tokens": round(
                mean(case["input_tokens"] for case in cases), 1
            ),
            "focus_case": next(
                case for case in cases if case["id"] == FOCUS_CASE_ID
            ),
            "cases": cases,
        }
        for mode, cases in results.items()
    }

    output = {
        "model": "multilingual",
        "language": data.emojis.language,
        "head_max_len": 256,
        "test_cases": len(data.tests.cases),
        "comparisons": comparisons,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
