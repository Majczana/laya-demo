"""Compare noul categories built from labels and full descriptions."""

import json
import sys
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any

from app.data_loader import load_demo_data_files
from app.data_models import EmojiCatalog, TestSuite
from app.laya_requests import CriteriaMode, build_noul_request
from app.laya_runtime import predict_noul
from compare_choice_noul import ndcg_at_k, noul_ranking


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = PROJECT_ROOT / "data" / "emojis_100_pl.json"
TESTS_PATH = PROJECT_ROOT / "data" / "test-cases_100.json"
MODES: tuple[CriteriaMode, ...] = ("descriptions", "labels")


def run_mode(
    catalog: EmojiCatalog,
    suite: TestSuite,
    mode: CriteriaMode,
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for test_case in suite.cases:
        request = build_noul_request(
            test_case.input,
            catalog,
            criteria_mode=mode,
        )
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
                    {"id": emoji_id, "probability": round(probability, 3)}
                    for emoji_id, probability in ranking[:5]
                ],
            }
        )

    return {
        "mean_ndcg_at_5": round(mean(c["ndcg_at_5"] for c in cases), 4),
        "mean_elapsed_seconds": round(
            mean(c["elapsed_seconds"] for c in cases), 4
        ),
        "mean_input_tokens": round(mean(c["input_tokens"] for c in cases), 1),
        "cases": cases,
    }


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    data = load_demo_data_files(CATALOG_PATH, TESTS_PATH)

    print("Rozgrzewam model...", file=sys.stderr)
    warmup = build_noul_request(data.tests.cases[0].input, data.emojis)
    predict_noul(warmup, head_max_len=256)

    output = {
        "model": "multilingual",
        "head_max_len": 256,
        "emoji_count": len(data.emojis.items),
        "test_cases": len(data.tests.cases),
        "variable": "criteria_mode",
        "comparisons": {
            mode: run_mode(data.emojis, data.tests, mode) for mode in MODES
        },
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
