"""Compare LAYA and Jev on the Emoji Rain test phrases.

Separates ranking quality (are the right emoji on top?) from calibration (how
many emoji pass the UI threshold, and are they right?), and tries several
wordings of the noul question and of its yes/no descriptions.

    python examples/compare_emoji_engines.py
    python examples/compare_emoji_engines.py --variants pl-labels --show-top
"""

import argparse
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import mean
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.data_loader import DEFAULT_DATA_DIR, load_demo_data_files  # noqa: E402
from app.engines import predict  # noqa: E402
from app.laya_requests import EMOJI_PROMPTS  # noqa: E402
from compare_choice_noul import ndcg_at_k, noul_ranking  # noqa: E402

# Per-model lift thresholds used by the app (frontend/src/EmojiDemo.tsx).
UI_THRESHOLDS = {"laya": 0.85, "jev": 0.45}
UI_MAX_LIFTED = 12

# (question template, yes/no descriptions). The app sends "pl-labels" to LAYA
# and "pl-criteria" to Jev.
VARIANTS = {
    "pl-labels": (EMOJI_PROMPTS["pl"]["noul"], EMOJI_PROMPTS["pl"]["labels"]),
    "pl-criteria": (EMOJI_PROMPTS["pl"]["noul"], EMOJI_PROMPTS["pl"]["criteria"]),
    "en-labels": (EMOJI_PROMPTS["en"]["noul"], EMOJI_PROMPTS["en"]["labels"]),
    "en-criteria": (EMOJI_PROMPTS["en"]["noul"], EMOJI_PROMPTS["en"]["criteria"]),
}


def request_for(text: str, catalog, variant: str) -> dict:
    template, labels = VARIANTS[variant]
    return {
        "state": {"text": text},
        "questions": {
            item.id: {
                "type": "noul",
                "instructions": template.format(category=f"{item.label}: {item.description}"),
                "labels": dict(labels),
            }
            for item in catalog.items
        },
    }


def auc(scores: dict[str, float], relevant: set[str]) -> float:
    """Chance that a relevant emoji scores above an unrelated one (0.5 = random)."""

    positive = [scores[i] for i in relevant]
    negative = [score for i, score in scores.items() if i not in relevant]
    wins = sum((p > n) + 0.5 * (p == n) for p in positive for n in negative)
    return wins / (len(positive) * len(negative))


def best_f1_threshold(cases: list[dict]) -> tuple[float, float]:
    """Threshold that best separates relevant from unrelated emoji over all cases."""

    best = (0.0, 0.0)
    for step in range(1, 100):
        threshold = step / 100
        tp = fp = fn = 0
        for case in cases:
            lifted = {i for i, s in case["scores"].items() if s >= threshold}
            tp += len(lifted & case["relevant"])
            fp += len(lifted - case["relevant"])
            fn += len(case["relevant"] - lifted)
        f1 = 2 * tp / (2 * tp + fp + fn) if tp else 0.0
        best = max(best, (f1, threshold))
    return best[1], best[0]


def evaluate(engine: str, variant: str, data, workers: int) -> list[dict]:
    catalog, suite = data.emojis, data.tests

    def run(test_case) -> dict:
        started = perf_counter()
        result = predict(request_for(test_case.input, catalog, variant), engine=engine)
        elapsed = (perf_counter() - started) * 1000
        ranking = noul_ranking(result)
        scores = dict(ranking)
        primary = set(test_case.expected.primary)
        relevant = primary | set(test_case.expected.related)
        lifted = [i for i, s in ranking if s >= UI_THRESHOLDS[engine]][:UI_MAX_LIFTED]
        return {
            "id": test_case.id,
            "input": test_case.input,
            "ms": elapsed,
            "scores": scores,
            "ranking": ranking,
            "relevant": relevant,
            "ndcg5": ndcg_at_k(ranking, test_case, suite),
            "auc": auc(scores, relevant),
            "above": sum(s >= UI_THRESHOLDS[engine] for s in scores.values()),
            "lifted_precision": (sum(i in relevant for i in lifted) / len(lifted)) if lifted else None,
            "primary_recall": sum(i in primary for i in lifted) / len(primary),
            "tokens": result.get("usage", {}).get("input_tokens"),
        }

    with ThreadPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(run, suite.cases))


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--engines", nargs="+", default=["laya", "jev"])
    parser.add_argument("--variants", nargs="+", default=list(VARIANTS))
    parser.add_argument("--show-top", action="store_true", help="print the top emoji per phrase")
    args = parser.parse_args()

    data = load_demo_data_files(
        DEFAULT_DATA_DIR / "emojis_100_pl.json", DEFAULT_DATA_DIR / "test-cases_100.json"
    )
    labels = {item.id: item.label for item in data.emojis.items}

    print(f"{'engine':<5} {'variant':<12} {'NDCG@5':>7} {'AUC':>6} {'lifted':>6} "
          f"{'prec@UI':>8} {'recall@UI':>9} {'best thr':>9} {'F1':>5} {'ms':>6}")
    for variant in args.variants:
        for engine in args.engines:
            cases = evaluate(engine, variant, data, workers=1 if engine == "laya" else 6)
            precisions = [c["lifted_precision"] for c in cases if c["lifted_precision"] is not None]
            threshold, f1 = best_f1_threshold(cases)
            print(
                f"{engine:<5} {variant:<12} {mean(c['ndcg5'] for c in cases):>7.3f} "
                f"{mean(c['auc'] for c in cases):>6.3f} {mean(c['above'] for c in cases):>6.1f} "
                f"{(mean(precisions) if precisions else 0):>8.2f} "
                f"{mean(c['primary_recall'] for c in cases):>9.2f} "
                f"{threshold:>9.2f} {f1:>5.2f} {mean(c['ms'] for c in cases):>6.0f}",
                flush=True,
            )
            if args.show_top:
                for c in cases:
                    top = ", ".join(
                        f"{'*' if i in c['relevant'] else ''}{labels[i]} {s:.2f}" for i, s in c["ranking"][:8]
                    )
                    print(f"    {c['input']:<32} {top}")


if __name__ == "__main__":
    main()
