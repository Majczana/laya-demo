"""Compare the same choice request with two option-token budgets."""

import argparse
import json
import sys
from time import perf_counter
from typing import Any

from app.data_loader import load_demo_data
from app.laya_requests import build_choice_request
from app.laya_runtime import predict_choice


BUDGETS = (256, 512)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Compare LAYA choice rankings for two head token budgets."
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
    probabilities = answer["probabilities"]
    ranking = sorted(
        probabilities.items(),
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
    request = build_choice_request(args.text, data.emojis)

    print("Rozgrzewam model...", file=sys.stderr)
    predict_choice(request, head_max_len=BUDGETS[0])

    comparisons: dict[str, Any] = {}
    for budget in BUDGETS:
        started_at = perf_counter()
        result = predict_choice(request, head_max_len=budget)
        elapsed_seconds = perf_counter() - started_at
        comparisons[str(budget)] = summarize(result, elapsed_seconds)

    output = {
        "input": request["state"]["text"],
        "model": "multilingual",
        "variable": "head_max_len",
        "comparisons": comparisons,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
