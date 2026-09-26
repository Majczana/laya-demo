"""Compare noul ranking quality and cost for 16 and 100 emoji."""

import json
import sys
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any

from app.data_loader import load_demo_data_files
from app.data_models import EmojiCatalog, TestSuite
from app.laya_requests import build_noul_request
from app.laya_runtime import predict_noul
from compare_choice_noul import ndcg_at_k, noul_ranking


PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATASETS = {
    "16": {
        "catalog": PROJECT_ROOT / "data" / "emojis_pl.json",
        "tests": PROJECT_ROOT / "data" / "test-cases.json",
    },
    "100": {
        "catalog": PROJECT_ROOT / "data" / "emojis_100_pl.json",
        "tests": PROJECT_ROOT / "data" / "test-cases_100.json",
    },
}
FOCUS_CASE_ID = "healthy-food"


def validate_catalog_extension(
    base: EmojiCatalog,
    extended: EmojiCatalog,
) -> None:
    """Ensure the larger catalog preserves every original emoji identity."""

    extended_by_id = {item.id: item for item in extended.items}
    for item in base.items:
        candidate = extended_by_id.get(item.id)
        if candidate is None or (
            candidate.emoji,
            candidate.label,
            candidate.description,
        ) != (item.emoji, item.label, item.description):
            raise ValueError(
                f"extended catalog must preserve emoji '{item.id}' unchanged"
            )


def validate_matching_cases(base: TestSuite, extended: TestSuite) -> None:
    """Ensure both suites exercise exactly the same input phrases."""

    base_inputs = [(case.id, case.input) for case in base.cases]
    extended_inputs = [(case.id, case.input) for case in extended.cases]
    if base_inputs != extended_inputs:
        raise ValueError("test suites must contain identical IDs and inputs")


def run_catalog(catalog: EmojiCatalog, suite: TestSuite) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for test_case in suite.cases:
        request = build_noul_request(test_case.input, catalog)
        started_at = perf_counter()
        result = predict_noul(request, head_max_len=256)
        elapsed_seconds = perf_counter() - started_at
        ranking = noul_ranking(result)
        cases.append(
            {
                "id": test_case.id,
                "input": test_case.input,
                "ndcg_at_5": round(ndcg_at_k(ranking, test_case, suite), 4),
                "elapsed_seconds": round(elapsed_seconds, 4),
                "input_tokens": result["usage"]["input_tokens"],
                "top_5": [
                    {"id": emoji_id, "probability": probability}
                    for emoji_id, probability in ranking[:5]
                ],
            }
        )

    return {
        "emoji_count": len(catalog.items),
        "mean_ndcg_at_5": round(
            mean(case["ndcg_at_5"] for case in cases), 4
        ),
        "mean_elapsed_seconds": round(
            mean(case["elapsed_seconds"] for case in cases), 4
        ),
        "mean_input_tokens": round(
            mean(case["input_tokens"] for case in cases), 1
        ),
        "focus_case": next(
            case for case in cases if case["id"] == FOCUS_CASE_ID
        ),
        "cases": cases,
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    datasets = {
        size: load_demo_data_files(paths["catalog"], paths["tests"])
        for size, paths in DATASETS.items()
    }
    validate_catalog_extension(
        datasets["16"].emojis,
        datasets["100"].emojis,
    )
    validate_matching_cases(datasets["16"].tests, datasets["100"].tests)

    print("Rozgrzewam model...", file=sys.stderr)
    warmup = build_noul_request(
        datasets["16"].tests.cases[0].input,
        datasets["16"].emojis,
    )
    predict_noul(warmup, head_max_len=256)

    output = {
        "model": "multilingual",
        "language": datasets["16"].tests.language,
        "head_max_len": 256,
        "test_cases": len(datasets["16"].tests.cases),
        "evaluation": "catalog-specific relevance for identical inputs",
        "comparisons": {
            size: run_catalog(dataset.emojis, dataset.tests)
            for size, dataset in datasets.items()
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
