"""Run one controlled choice prediction with the multilingual LAYA model."""

import argparse
import json
import sys
from time import perf_counter

from app.data_loader import load_demo_data
from app.laya_requests import build_choice_request
from app.laya_runtime import predict_choice


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Run one LAYA choice prediction on the local CPU."
    )
    parser.add_argument(
        "text",
        nargs="?",
        default="healthy food",
        help="English text that the emoji should be matched against.",
    )
    return parser.parse_args()


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    data = load_demo_data()
    request = build_choice_request(args.text, data.emojis)

    print(
        "Running the multilingual checkpoint on CPU. "
        "The first call may download the model weights...",
        file=sys.stderr,
    )
    started_at = perf_counter()
    result = predict_choice(request)
    elapsed_seconds = perf_counter() - started_at

    output = {
        "input": request["state"]["text"],
        "model": "multilingual",
        "elapsed_seconds": round(elapsed_seconds, 3),
        "result": result,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
