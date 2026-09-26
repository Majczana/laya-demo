"""Compare embedding retrieval with LAYA noul and a LAYA choice rerank."""

import argparse
import json
import sys
from pathlib import Path
from statistics import mean
from time import perf_counter
from typing import Any, Callable

import numpy as np

from app.data_loader import load_demo_data_files
from app.data_models import EmojiCatalog, EmojiItem, TestSuite
from app.laya_requests import (
    build_choice_request,
    build_noul_request,
    build_option_key_map,
)
from app.laya_runtime import predict_choice, predict_noul
from compare_choice_noul import choice_ranking, ndcg_at_k, noul_ranking


PROJECT_ROOT = Path(__file__).resolve().parents[1]
CATALOG_PATH = PROJECT_ROOT / "data" / "emojis_100.json"
TESTS_PATH = PROJECT_ROOT / "data" / "test-cases_100.json"
KEYWORDS_PATH = PROJECT_ROOT / "data" / "emoji_keywords_cldr_pl.json"

# Each retriever expects its own prefixes; wrong ones silently ruin rankings.
EMBEDDING_MODELS = {
    "e5-large": {
        "name": "intfloat/multilingual-e5-large",
        "query_prefix": "query: ",
        "passage_prefix": "passage: ",
    },
    "mmlw-roberta-large": {
        "name": "sdadas/mmlw-retrieval-roberta-large",
        "query_prefix": "zapytanie: ",
        "passage_prefix": "",
    },
}
DOCUMENT_MODES = (
    "label",
    "label+cldr",
    "label+description",
    "label+description+cldr",
)
RERANK_TOP_K = 10

Ranking = list[tuple[str, float]]


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--models",
        nargs="+",
        choices=sorted(EMBEDDING_MODELS),
        default=list(EMBEDDING_MODELS),
    )
    parser.add_argument(
        "--skip-laya",
        action="store_true",
        help="Skip the LAYA noul baseline and the choice rerank.",
    )
    return parser.parse_args()


def document_text(item: EmojiItem, keywords: list[str], mode: str) -> str:
    if mode == "label":
        return item.label
    if mode == "label+cldr":
        return f"{item.label}. {', '.join(keywords)}"
    if mode == "label+description":
        return f"{item.label}: {item.description}"
    if mode == "label+description+cldr":
        return f"{item.label}: {item.description}. {', '.join(keywords)}"
    raise ValueError(f"unsupported document mode: {mode}")


def evaluate(
    suite: TestSuite,
    rank: Callable[[str], Ranking],
) -> dict[str, Any]:
    cases: list[dict[str, Any]] = []
    for test_case in suite.cases:
        started_at = perf_counter()
        ranking = rank(test_case.input)
        elapsed_seconds = perf_counter() - started_at
        cases.append(
            {
                "id": test_case.id,
                "input": test_case.input,
                "ndcg_at_5": round(ndcg_at_k(ranking, test_case, suite), 4),
                "elapsed_seconds": round(elapsed_seconds, 4),
                "top_5": [emoji_id for emoji_id, _ in ranking[:5]],
            }
        )
    return {
        "mean_ndcg_at_5": round(mean(c["ndcg_at_5"] for c in cases), 4),
        "mean_elapsed_seconds": round(
            mean(c["elapsed_seconds"] for c in cases), 4
        ),
        "cases": cases,
    }


class EmbeddingRanker:
    """Cosine ranking of precomputed emoji vectors against one query."""

    def __init__(
        self,
        model: Any,
        spec: dict[str, str],
        catalog: EmojiCatalog,
        documents: list[str],
    ) -> None:
        self.model = model
        self.spec = spec
        self.ids = [item.id for item in catalog.items]
        self.vectors = model.encode(
            [spec["passage_prefix"] + text for text in documents],
            normalize_embeddings=True,
        )

    def __call__(self, text: str) -> Ranking:
        query = self.model.encode(
            [self.spec["query_prefix"] + text],
            normalize_embeddings=True,
        )[0]
        scores = self.vectors @ query
        order = np.argsort(-scores)
        return [(self.ids[index], float(scores[index])) for index in order]


def rerank_choice(text: str, shortlist: EmojiCatalog) -> Ranking:
    """One LAYA choice over opaque A-J keys, mapped back to emoji IDs."""

    request = build_choice_request(text, shortlist, option_key_mode="opaque")
    key_map = build_option_key_map(shortlist, option_key_mode="opaque")
    result = predict_choice(request, head_max_len=256)
    return [
        (key_map[key], probability)
        for key, probability in choice_ranking(result)
    ]


def rerank_noul(text: str, shortlist: EmojiCatalog) -> Ranking:
    """Independent LAYA noul probabilities for each shortlisted emoji."""

    request = build_noul_request(text, shortlist)
    return noul_ranking(predict_noul(request, head_max_len=256))


def laya_rerank(
    retrieve: Callable[[str], Ranking],
    catalog: EmojiCatalog,
    rerank: Callable[[str, EmojiCatalog], Ranking],
) -> Callable[[str], Ranking]:
    """Rerank the retriever's top-k with LAYA and keep the rest in order."""

    items_by_id = {item.id: item for item in catalog.items}

    def rank(text: str) -> Ranking:
        retrieved = retrieve(text)
        shortlist = EmojiCatalog(
            version=catalog.version,
            language=catalog.language,
            items=[items_by_id[emoji_id] for emoji_id, _ in retrieved[:RERANK_TOP_K]],
        )
        return rerank(text, shortlist) + retrieved[RERANK_TOP_K:]

    return rank


def main() -> None:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    if hasattr(sys.stderr, "reconfigure"):
        sys.stderr.reconfigure(encoding="utf-8")

    args = parse_args()
    data = load_demo_data_files(CATALOG_PATH, TESTS_PATH)
    catalog, suite = data.emojis, data.tests
    keywords = json.loads(KEYWORDS_PATH.read_text(encoding="utf-8"))["keywords"]

    from sentence_transformers import SentenceTransformer

    comparisons: dict[str, Any] = {}

    if not args.skip_laya:
        print("Rozgrzewam LAYA...", file=sys.stderr)
        predict_noul(build_noul_request("jedzenie", catalog), head_max_len=256)
        comparisons["laya-noul/label+description"] = evaluate(
            suite,
            lambda text: noul_ranking(
                predict_noul(build_noul_request(text, catalog), head_max_len=256)
            ),
        )

    best: tuple[float, str, EmbeddingRanker] | None = None
    devices: dict[str, str] = {}
    for model_key in args.models:
        spec = EMBEDDING_MODELS[model_key]
        print(f"Ładuję {spec['name']}...", file=sys.stderr)
        model = SentenceTransformer(spec["name"])
        devices[model_key] = str(model.device)
        for _ in range(3):
            model.encode(["rozgrzewka"], normalize_embeddings=True)
        for mode in DOCUMENT_MODES:
            documents = [
                document_text(item, keywords.get(item.id, []), mode)
                for item in catalog.items
            ]
            ranker = EmbeddingRanker(model, spec, catalog, documents)
            name = f"{model_key}/{mode}"
            comparisons[name] = evaluate(suite, ranker)
            score = comparisons[name]["mean_ndcg_at_5"]
            if best is None or score > best[0]:
                best = (score, name, ranker)

    if best is not None and not args.skip_laya:
        _, best_name, best_ranker = best
        for rerank_name, rerank in (("choice", rerank_choice), ("noul", rerank_noul)):
            comparisons[f"{best_name} + laya-{rerank_name}@{RERANK_TOP_K}"] = evaluate(
                suite,
                laya_rerank(best_ranker, catalog, rerank),
            )

    output = {
        "emoji_count": len(catalog.items),
        "test_cases": len(suite.cases),
        "embedding_devices": devices,
        "summary": {
            name: {
                "mean_ndcg_at_5": result["mean_ndcg_at_5"],
                "mean_elapsed_seconds": result["mean_elapsed_seconds"],
            }
            for name, result in comparisons.items()
        },
        "comparisons": comparisons,
    }
    print(json.dumps(output, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
