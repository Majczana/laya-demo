"""Fast checks that do not load the LAYA model or call Jev.

Run from the repository root:
    python -m unittest discover -s backend/tests -t backend
"""

import json
import os
import unittest
from unittest.mock import patch

import httpx
from fastapi.testclient import TestClient

import app.decisions as decisions
import app.jev_runtime as jev_runtime
from app.data_loader import DEFAULT_DATA_DIR, load_demo_data_files, load_emoji_catalog
from app.laya_requests import build_noul_request, describe_tetris_move
from app.main import CATALOG_PATHS, app


MOVE = {"linesCleared": 0, "holes": 0, "maxHeight": 4, "bumpiness": 3, "nextLinePotential": 0}
BOARD = {"holes": 0, "maxHeight": 2, "bumpiness": 3}


class DataTests(unittest.TestCase):
    def test_polish_suite_loads_against_polish_catalog(self):
        data = load_demo_data_files(
            DEFAULT_DATA_DIR / "emojis_200_pl.json", DEFAULT_DATA_DIR / "test-cases_100.json"
        )
        self.assertEqual(len(data.emojis.items), 200)

    def test_catalogs_share_ids_in_the_same_order(self):
        ids = {
            lang: [item.id for item in load_emoji_catalog(path).items]
            for lang, path in CATALOG_PATHS.items()
        }
        self.assertEqual(ids["pl"], ids["en"])


class RequestTests(unittest.TestCase):
    def test_emoji_prompt_follows_catalog_language(self):
        polish = build_noul_request("deszcz", load_emoji_catalog(CATALOG_PATHS["pl"]))
        english = build_noul_request("rain", load_emoji_catalog(CATALOG_PATHS["en"]))
        first_pl = next(iter(polish["questions"].values()))
        first_en = next(iter(english["questions"].values()))
        self.assertIn("Czy treść użytkownika", first_pl["instructions"])
        self.assertEqual(first_pl["labels"], {"false": "nie", "true": "tak"})
        self.assertIn("Does the user's text", first_en["instructions"])

    def test_jev_gets_described_answers_with_the_same_question(self):
        catalog = load_emoji_catalog(CATALOG_PATHS["pl"])
        laya = next(iter(build_noul_request("deszcz", catalog)["questions"].values()))
        jev = next(iter(build_noul_request("deszcz", catalog, describe_answers=True)["questions"].values()))
        self.assertEqual(laya["instructions"], jev["instructions"])
        self.assertEqual(laya["labels"]["true"], "tak")
        self.assertIn("pasuje znaczeniowo", jev["labels"]["true"])

    def test_tetris_description_is_relative_to_the_board(self):
        text = describe_tetris_move(
            {"linesCleared": 2, "holes": 9, "maxHeight": 15, "bumpiness": 12, "nextLinePotential": 1},
            {"holes": 7, "maxHeight": 13, "bumpiness": 8},
        )
        self.assertEqual(
            text,
            "clears two lines, creates two new holes, raises the stack by two rows, "
            "makes the surface much rougher, the stack is near the top, "
            "the next piece can clear one line",
        )

    def test_same_board_state_gives_different_descriptions(self):
        board = {"holes": 3, "maxHeight": 12, "bumpiness": 10}
        flat = describe_tetris_move({**MOVE, "holes": 3, "maxHeight": 12, "bumpiness": 8}, board)
        rough = describe_tetris_move({**MOVE, "holes": 4, "maxHeight": 13, "bumpiness": 14}, board)
        self.assertNotEqual(flat, rough)


class ApiTests(unittest.TestCase):
    client = TestClient(app)

    def test_health_and_catalog_do_not_require_laya_warmup(self):
        health = self.client.get("/health")
        catalog = self.client.get("/catalog", params={"lang": "pl"})
        self.assertEqual(health.status_code, 200)
        self.assertEqual(health.json()["phase"], "api-ready")
        self.assertEqual(health.json()["device"], "pending")
        self.assertEqual(catalog.status_code, 200)
        self.assertEqual(len(catalog.json()["items"]), 200)

    def test_catalog_is_served_per_language(self):
        polish = self.client.get("/catalog", params={"lang": "pl"}).json()
        english = self.client.get("/catalog", params={"lang": "en"}).json()
        self.assertEqual(polish["language"], "pl")
        self.assertEqual(english["language"], "en")
        self.assertEqual(len(polish["items"]), 200)
        self.assertEqual(len(polish["items"]), len(english["items"]))

    def test_unknown_language_is_422(self):
        self.assertEqual(self.client.get("/catalog", params={"lang": "de"}).status_code, 422)
        response = self.client.post("/predict", json={"text": "hallo", "lang": "de"})
        self.assertEqual(response.status_code, 422)

    def test_invalid_model_output_is_502(self):
        with patch.object(decisions, "predict", lambda *_, **__: {"answers": {}}):
            response = self.client.post("/tetris/choose", json={"candidates": [MOVE, MOVE], "board": BOARD})
        self.assertEqual(response.status_code, 502)

    def test_tetris_picks_highest_independent_score(self):
        scores = iter([0.2, 0.9, 0.4])
        fake = lambda request, **_: {
            "answers": {qid: {"noul": next(scores)} for qid in request["questions"]}
        }
        with patch.object(decisions, "predict", fake):
            response = self.client.post("/tetris/choose", json={"candidates": [MOVE] * 3, "board": BOARD})
        self.assertEqual(response.json()["selected_index"], 1)
        self.assertEqual(response.json()["descriptions"][0], describe_tetris_move(MOVE, BOARD))
        self.assertIn("Would this move help them?", response.json()["question"])


class JevTests(unittest.TestCase):
    client = TestClient(app)

    def fake_jev(self, sent: list[dict]):
        """An HTTP client whose Jev answers every noul question in order."""

        def handler(request: httpx.Request) -> httpx.Response:
            body = json.loads(request.content)
            sent.append({"body": body, "auth": request.headers["Authorization"]})
            answers = {
                qid: {"type": "noul", "noul": 0.1 * (index + 1)}
                for index, qid in enumerate(body["questions"])
            }
            return httpx.Response(200, json={"model": body["model"], "answers": answers})

        return httpx.Client(transport=httpx.MockTransport(handler))

    def test_noul_labels_become_jev_criteria(self):
        request = build_noul_request("deszcz", load_emoji_catalog(CATALOG_PATHS["pl"]))
        questions = jev_runtime.jev_questions(request["questions"])
        first = next(iter(questions.values()))
        self.assertEqual(first["criteria"], {"false": "nie", "true": "tak"})
        self.assertNotIn("labels", first)
        # The LAYA request itself must stay unchanged.
        self.assertIn("labels", next(iter(request["questions"].values())))

    def test_tetris_with_jev_sends_same_questions(self):
        sent: list[dict] = []
        with (
            patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}),
            patch.object(jev_runtime, "get_client", lambda: self.fake_jev(sent)),
        ):
            response = self.client.post(
                "/tetris/choose", json={"candidates": [MOVE] * 3, "board": BOARD, "engine": "jev"}
            )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["engine"], "jev")
        self.assertEqual(response.json()["selected_index"], 2)
        self.assertEqual(sent[0]["auth"], "Bearer test-key")
        self.assertEqual(sent[0]["body"]["model"], jev_runtime.JEV_MODEL_NAME)
        self.assertEqual(list(sent[0]["body"]["questions"]), ["move_0", "move_1", "move_2"])

    def test_jev_without_key_is_503(self):
        with patch.dict(os.environ, {"OPENROUTER_API_KEY": ""}):
            response = self.client.post(
                "/tetris/choose", json={"candidates": [MOVE, MOVE], "board": BOARD, "engine": "jev"}
            )
        self.assertEqual(response.status_code, 503)
        self.assertIn("OPENROUTER_API_KEY", response.json()["detail"])

    def test_jev_http_error_is_502_with_message(self):
        error = {"error": {"code": 402, "message": "Insufficient credits"}}
        client = httpx.Client(transport=httpx.MockTransport(lambda _: httpx.Response(402, json=error)))
        with (
            patch.dict(os.environ, {"OPENROUTER_API_KEY": "test-key"}),
            patch.object(jev_runtime, "get_client", lambda: client),
        ):
            response = self.client.post(
                "/tetris/choose", json={"candidates": [MOVE, MOVE], "board": BOARD, "engine": "jev"}
            )
        self.assertEqual(response.status_code, 502)
        self.assertIn("Insufficient credits", response.json()["detail"])

    def test_unknown_engine_is_422(self):
        response = self.client.post("/predict", json={"text": "deszcz", "engine": "gpt"})
        self.assertEqual(response.status_code, 422)


if __name__ == "__main__":
    unittest.main()
