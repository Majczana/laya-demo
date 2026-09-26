"""Diagnose Emoji Rain for both models: typing prefixes, thresholds, single errors.

Step 1 (--collect) scores every prefix of the 13 Polish test phrases, the way
the demo sends text while typing, plus extra probe phrases (typos, missing
diacritics, emotions, negation, indirect associations, gibberish), with the
exact requests the app sends to each model. Scores are cached in
work/emoji-diagnostics.json, so the analysis can be rerun without calling Jev.

Step 2 (default) prints a threshold sweep, quality by typing progress, the
typing timeline of a few phrases and the worst single mistakes.

    python examples/diagnose_emoji_typing.py --collect
    python examples/diagnose_emoji_typing.py
"""

import argparse
import json
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from statistics import mean

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
sys.path.insert(0, str(Path(__file__).resolve().parent))

from app.data_loader import DEFAULT_DATA_DIR, load_demo_data_files  # noqa: E402
from app.engines import predict  # noqa: E402
from compare_emoji_engines import request_for  # noqa: E402

CACHE = Path(__file__).resolve().parents[1] / "work" / "emoji-diagnostics.json"
ENGINES = ["laya", "jev"]
APP_VARIANT = {"laya": "pl-labels", "jev": "pl-criteria"}
APP_THRESHOLD = {"laya": 0.85, "jev": 0.45}
MAX_LIFTED = 12
# Same rules as frontend/src/EmojiDemo.tsx: nothing below MIN_CHARS, and more
# than NO_CLEAR_MATCH emoji above the threshold means no clear match.
MIN_CHARS = 3
NO_CLEAR_MATCH = 20

# Extra phrases with expected emoji chosen by hand (primary, related). An empty
# primary list means nothing should be lifted.
PROBES = {
    "jedznie": (["pizza", "broccoli", "apple", "bread", "cheese", "carrot", "strawberry", "burger"], ["coffee", "tea"]),
    "ide na basen": (["swimming"], ["beach"]),
    "kot": (["cat"], []),
    "pies na spacerze": (["dog"], ["tree", "city"]),
    "lecę na wakacje": (["plane", "beach"], ["hotel", "sun", "backpack"]),
    "urodziny": (["party"], ["happy", "dancing", "love"]),
    "idę do pracy": (["office"], ["laptop", "bus", "subway", "car", "train"]),
    "smutno mi": (["sad"], ["tired"]),
    "wkurzyłem się": (["angry"], []),
    "nie lubię zimna": (["snow", "coat", "scarf", "gloves"], ["angry"]),
    "internet": (["laptop", "phone"], ["keyboard"]),
    "matematyka": (["school", "chart"], ["books", "thinking"]),
    "choroba": (["hospital"], ["tired", "sad"]),
    "pieniądze": (["bank"], ["chart", "store"]),
    "podróż pociągiem": (["train"], ["backpack"]),
    "mecz": (["football", "basketball", "tennis"], []),
    "morze": (["beach", "boat", "fish", "swimming"], ["sun"]),
    "zoo": (["lion", "monkey"], ["bird", "horse", "cow"]),
    "pomysł": (["lightbulb", "thinking"], []),
    "asdfgh": ([], []),
    "xyz 123": ([], []),
}


def phrases(data) -> dict[str, tuple[set[str], set[str]]]:
    cases = {c.input: (set(c.expected.primary), set(c.expected.related)) for c in data.tests.cases}
    probes = {text: (set(p), set(r)) for text, (p, r) in PROBES.items()}
    return {**cases, **probes}


def prefixes(text: str) -> list[str]:
    """What the demo sends while the phrase is typed (it trims spaces)."""

    seen: list[str] = []
    for end in range(1, len(text) + 1):
        prefix = text[:end].strip()
        if prefix and prefix not in seen:
            seen.append(prefix)
    return seen


def collect(data) -> None:
    cache = json.loads(CACHE.read_text(encoding="utf-8")) if CACHE.exists() else {}
    texts = [p for c in data.tests.cases for p in prefixes(c.input)] + list(PROBES)
    texts = list(dict.fromkeys(texts))
    for engine in ENGINES:
        done = cache.setdefault(engine, {})
        todo = [t for t in texts if t not in done]
        print(f"{engine}: {len(todo)} texts to score", flush=True)

        def run(text: str) -> tuple[str, dict]:
            result = predict(request_for(text, data.emojis, APP_VARIANT[engine]), engine=engine)
            return text, {i: a["noul"] for i, a in result["answers"].items()}

        with ThreadPoolExecutor(max_workers=1 if engine == "laya" else 6) as pool:
            for index, (text, scores) in enumerate(pool.map(run, todo), 1):
                done[text] = scores
                if index % 25 == 0:
                    CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")
        CACHE.parent.mkdir(exist_ok=True)
        CACHE.write_text(json.dumps(cache, ensure_ascii=False), encoding="utf-8")


def lifted(scores: dict[str, float], threshold: float) -> list[str]:
    ranked = sorted(scores, key=scores.get, reverse=True)
    return [i for i in ranked if scores[i] >= threshold][:MAX_LIFTED]


def app_lifted(text: str, scores: dict[str, float], threshold: float) -> list[str]:
    """What the demo lifts, including its minimum length and no-clear-match rules."""

    if len(text) < MIN_CHARS or sum(s >= threshold for s in scores.values()) > NO_CLEAR_MATCH:
        return []
    return lifted(scores, threshold)


def sweep(cache, expected, engine) -> None:
    print(f"\n{engine.upper()}: threshold sweep on complete phrases ({len(expected)}), UI shows at most {MAX_LIFTED}, without app rules")
    print(f"  {'thr':>4} {'lifted':>6} {'precision':>9} {'found':>6} {'F1':>5} {'F0.5':>5}  nothing-right  gibberish-lifted")
    rows = []
    for step in range(2, 20):
        thr = step * 0.05
        lifted_n, tp_all, fp_all, fn_all, found, empty_wrong = [], 0, 0, 0, [], 0
        gib = 0
        for text, (primary, related) in expected.items():
            shown = lifted(cache[engine][text], thr)
            relevant = primary | related
            if not relevant:
                gib += len(shown)
                continue
            lifted_n.append(len(shown))
            tp = len([i for i in shown if i in relevant])
            tp_all += tp
            fp_all += len(shown) - tp
            fn_all += len(primary - set(shown))
            found.append(len(primary & set(shown)) / len(primary))
            empty_wrong += bool(shown) and tp == 0
        precision = tp_all / (tp_all + fp_all) if tp_all + fp_all else 0
        recall = mean(found)
        f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0
        f05 = 1.25 * precision * recall / (0.25 * precision + recall) if precision + recall else 0
        rows.append((thr, mean(lifted_n), precision, recall, f1, f05, empty_wrong, gib))
    best_f1 = max(rows, key=lambda r: r[4])[0]
    best_f05 = max(rows, key=lambda r: r[5])[0]
    for thr, n, p, r, f1, f05, wrong, gib in rows:
        mark = " <- F1" if thr == best_f1 else ""
        mark += " <- F0.5" if thr == best_f05 else ""
        mark += " (app)" if abs(thr - APP_THRESHOLD[engine]) < 1e-9 else ""
        print(f"  {thr:>4.2f} {n:>6.1f} {p:>9.2f} {r:>6.2f} {f1:>5.2f} {f05:>5.2f}  {wrong:>13}  {gib:>16}{mark}")


def typing(cache, data, engine, threshold) -> None:
    print(f"\n{engine.upper()}: quality while typing at threshold {threshold:.2f} (13 test phrases)")
    buckets = {"<=25%": [], "26-50%": [], "51-75%": [], "76-99%": [], "100%": []}
    for case in data.tests.cases:
        primary, related = set(case.expected.primary), set(case.expected.related)
        relevant = primary | related
        full = case.input.strip()
        for prefix in prefixes(case.input):
            share = len(prefix) / len(full)
            key = ("100%" if prefix == full else "<=25%" if share <= 0.25 else "26-50%" if share <= 0.5
                   else "51-75%" if share <= 0.75 else "76-99%")
            shown = app_lifted(prefix, cache[engine][prefix], threshold)
            buckets[key].append((
                len(shown),
                (sum(i in relevant for i in shown) / len(shown)) if shown else None,
                bool(shown) and not any(i in relevant for i in shown),
                len(primary & set(shown)) / len(primary),
            ))
    print(f"  {'typed':>7} {'texts':>5} {'lifted':>6} {'precision':>9} {'all wrong':>9} {'found':>6}")
    for key, rows in buckets.items():
        precisions = [r[1] for r in rows if r[1] is not None]
        print(f"  {key:>7} {len(rows):>5} {mean(r[0] for r in rows):>6.1f} "
              f"{(mean(precisions) if precisions else 0):>9.2f} {sum(r[2] for r in rows):>9} {mean(r[3] for r in rows):>6.2f}")


def timeline(cache, labels, text, thresholds) -> None:
    print(f"\nTyping “{text}” (top 3 lifted; * = expected)")
    for prefix in prefixes(text):
        cells = []
        for engine in ENGINES:
            scores = cache[engine][prefix]
            shown = app_lifted(prefix, scores, thresholds[engine])
            cells.append(", ".join(f"{labels[i]} {scores[i]:.2f}" for i in shown[:3]) or "–")
        print(f"  {prefix:<24} LAYA: {cells[0]:<45} Jev: {cells[1]}")


def mistakes(cache, expected, labels, engine, threshold) -> None:
    print(f"\n{engine.upper()}: single mistakes on complete phrases (threshold {threshold:.2f})")
    confident, misses, failures = [], [], []
    for text, (primary, related) in expected.items():
        scores = cache[engine][text]
        relevant = primary | related
        ranked = sorted(scores, key=scores.get, reverse=True)
        shown = app_lifted(text, scores, threshold)
        for i in shown[:5]:
            if i not in relevant:
                confident.append((scores[i], text, labels[i], ranked.index(i) + 1))
        for i in primary:
            if i not in shown:
                misses.append((scores[i], text, labels[i], ranked.index(i) + 1))
        if relevant and (not shown or not any(i in relevant for i in shown[:3])):
            failures.append((text, ", ".join(f"{labels[i]} {scores[i]:.2f}" for i in ranked[:4])))
    print("  Unrelated emoji lifted from the top 5 (highest first):")
    for score, text, label, rank in sorted(confident, reverse=True)[:15]:
        print(f"    {score:.2f}  {text:<32} -> {label} (#{rank})")
    print("  Expected emoji not lifted (lowest first):")
    for score, text, label, rank in sorted(misses)[:15]:
        print(f"    {score:.2f}  {text:<32} -> {label} (#{rank})")
    print("  Phrases with nothing lifted, or nothing right in the top 3 lifted:")
    for text, top in failures:
        print(f"    {text:<32} top: {top}")


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser()
    parser.add_argument("--collect", action="store_true")
    parser.add_argument("--laya-threshold", type=float, default=APP_THRESHOLD["laya"])
    parser.add_argument("--jev-threshold", type=float, default=APP_THRESHOLD["jev"])
    args = parser.parse_args()

    data = load_demo_data_files(DEFAULT_DATA_DIR / "emojis_100_pl.json", DEFAULT_DATA_DIR / "test-cases_100.json")
    if args.collect:
        collect(data)
        return

    cache = json.loads(CACHE.read_text(encoding="utf-8"))
    labels = {item.id: item.label for item in data.emojis.items}
    expected = phrases(data)
    thresholds = {"laya": args.laya_threshold, "jev": args.jev_threshold}
    for engine in ENGINES:
        sweep(cache, expected, engine)
    for engine in ENGINES:
        typing(cache, data, engine, thresholds[engine])
    for text in ["ubrania na zimę", "coś na deszcz", "chcę tworzyć muzykę"]:
        timeline(cache, labels, text, thresholds)
    for engine in ENGINES:
        mistakes(cache, expected, labels, engine, thresholds[engine])


if __name__ == "__main__":
    main()
