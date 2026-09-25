"""Measure warm noul inference on a selected CPU or GPU device."""

import argparse
import json
import os
import sys
from statistics import mean, median
from time import perf_counter
from typing import Any

import torch

from app.data_loader import load_demo_data
from app.laya_requests import build_noul_request
from app.laya_runtime import get_router, predict_noul


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Benchmark one 16-question noul request on CPU or GPU."
    )
    parser.add_argument(
        "--device",
        choices=("auto", "cpu", "cuda"),
        default="auto",
        help="Device requested through LAYA_DEVICE.",
    )
    parser.add_argument(
        "--iterations",
        type=int,
        default=10,
        help="Number of measured warm predictions.",
    )
    parser.add_argument(
        "--text",
        default="jedzenie zdrowe",
        help="Polish text used for every prediction.",
    )
    args = parser.parse_args()
    if args.iterations < 1:
        parser.error("--iterations must be at least 1")
    return args


def ranking(result: dict[str, Any]) -> list[dict[str, Any]]:
    probabilities = sorted(
        (
            (emoji_id, answer["noul"])
            for emoji_id, answer in result["answers"].items()
        ),
        key=lambda item: item[1],
        reverse=True,
    )
    return [
        {"id": emoji_id, "probability": probability}
        for emoji_id, probability in probabilities[:5]
    ]


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    os.environ["LAYA_DEVICE"] = args.device

    data = load_demo_data()
    request = build_noul_request(args.text, data.emojis)

    cold_started_at = perf_counter()
    result = predict_noul(request, head_max_len=256)
    cold_seconds = perf_counter() - cold_started_at

    agent = get_router().load("multilingual")
    actual_device = str(agent.device)
    if actual_device.startswith("cuda"):
        torch.cuda.synchronize()
        torch.cuda.reset_peak_memory_stats()

    timings: list[float] = []
    for _ in range(args.iterations):
        started_at = perf_counter()
        result = predict_noul(request, head_max_len=256)
        if actual_device.startswith("cuda"):
            torch.cuda.synchronize()
        timings.append(perf_counter() - started_at)

    device_name = (
        torch.cuda.get_device_name(agent.device)
        if actual_device.startswith("cuda")
        else None
    )
    peak_memory_mb = (
        round(torch.cuda.max_memory_allocated(agent.device) / 1024**2, 1)
        if actual_device.startswith("cuda")
        else None
    )
    output = {
        "requested_device": args.device,
        "actual_device": actual_device,
        "device_name": device_name,
        "torch_version": torch.__version__,
        "cuda_available": torch.cuda.is_available(),
        "iterations": args.iterations,
        "cold_seconds": round(cold_seconds, 3),
        "warm_seconds": {
            "mean": round(mean(timings), 4),
            "median": round(median(timings), 4),
            "min": round(min(timings), 4),
            "max": round(max(timings), 4),
        },
        "peak_gpu_memory_mb": peak_memory_mb,
        "input_tokens": result["usage"]["input_tokens"],
        "top_5": ranking(result),
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
