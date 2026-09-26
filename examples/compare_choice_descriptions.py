"""Compare choice criteria built from labels and full descriptions."""

import argparse
import json
import sys
from time import perf_counter
from typing import Any

from app.data_loader import load_demo_data
from app.laya_requests import CriteriaMode, build_choice_request
from app.laya_runtime import predict_choice


MODES: tuple[CriteriaMode, ...] = ("descriptions", "labels")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare full descriptions with label-only criteria."
    )
    parser.add_argument(
        "text",
        nargs="?",
        default="healthy food",
        help="English text that the emoji should be matched against.",
    )
    return parser.parse_args()


def summarize(result: dict[str, Any], elapsed_seconds: float) -> dict[str, Any]:
    answer = result["answers"]["emoji_match"]
    ranking = sorted(
        answer["probabilities"].items(),
        key=lambda item: item[1],
        reverse=True,
    )
    return {
        "elapsed_seconds": round(elapsed_seconds, 3),
        "choice": answer["choice"],
        "confidence": answer["confidence"],
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

    args = parse_args()
    data = load_demo_data()

    print("Rozgrzewam model...", file=sys.stderr)
    warmup_request = build_choice_request(args.text, data.emojis)
    predict_choice(warmup_request, head_max_len=256)

    comparisons: dict[str, Any] = {}
    for mode in MODES:
        request = build_choice_request(
            args.text,
            data.emojis,
            criteria_mode=mode,
        )
        started_at = perf_counter()
        result = predict_choice(request, head_max_len=256)
        elapsed_seconds = perf_counter() - started_at
        comparisons[mode] = summarize(result, elapsed_seconds)

    output = {
        "input": args.text.strip(),
        "model": "multilingual",
        "head_max_len": 256,
        "variable": "criteria_mode",
        "comparisons": comparisons,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
