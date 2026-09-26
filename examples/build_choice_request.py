"""Print a choice request so it can be inspected before model inference."""

import argparse
import json
import sys

from app.data_loader import load_demo_data
from app.laya_requests import build_choice_request


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Build a LAYA choice request without running the model."
    )
    parser.add_argument(
        "text",
        nargs="?",
        default="healthy food",
        help="English text that the emoji should be matched against.",
    )
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    data = load_demo_data()
    request = build_choice_request(args.text, data.emojis)
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    print(json.dumps(request, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
