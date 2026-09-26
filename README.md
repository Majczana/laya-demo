# LAYA demos

Two small demos of one local
[LAYA](https://huggingface.co/convaiinnovations/laya) model using the
`multilingual` checkpoint:

| Demo | What LAYA does |
| --- | --- |
| Emoji Rain | Scores 200 independent `noul` associations while you type. |
| Tetris | Rates up to four legal piece placements with independent `noul` questions. |

Open `http://localhost:5173`. Model results are experimental.

The whole app has a Polish/English switch in the header (Polish by default;
the choice is remembered in the browser). In Emoji Rain the language also
selects the backend catalog and prompt: `data/emojis_200_pl.json` with Polish
instructions and tak/nie labels, or `data/emojis_200.json` with English ones.
Both catalogs list the same emoji IDs in the same order. On the Polish test
phrases the Polish setup scores NDCG@5 0.7297 against 0.4316 for the English
catalog. The Tetris prompt stays in English in both modes: it is internal, and
the Polish version scored at chance level (23–31/60) in
`examples/evaluate_tetris_moves.py`.

## Run locally

**Quick start (Windows):** double-click `start.cmd` in the repository folder.
On the first run it creates `.venv` and installs the backend and frontend
dependencies. It then opens the backend (with `--reload`) and the frontend in
their own windows, skipping any that already run on ports 8000 or 5173, and
opens `http://localhost:5173`. Close both windows to stop the demo.

Manual start:

Open two terminals in the repository folder. On the first run, install the
dependencies.

**Terminal 1 — backend (Windows PowerShell)**

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r .\backend\requirements.lock
python -m pip install --no-deps -e .\backend
uvicorn app.main:app --reload --app-dir backend
```

**Terminal 2 — frontend**

```powershell
cd frontend
npm install
npm run dev
```

On later runs, skip environment creation and installation: activate `.venv` in
the first terminal and start `uvicorn`; in the second terminal run `npm run
dev` from the `frontend` folder.

On macOS/Linux, use `python3 -m venv .venv` and
`source .venv/bin/activate`; the remaining commands are the same.

The API starts immediately and the catalog is available while LAYA is cold.
The first prediction can take longer because it downloads and loads the LAYA
weights. API health: `http://localhost:8000/health`. LAYA runs locally and
needs no API key.

## Jev (comparison model)

The header has a LAYA / Jev switch. Both demos send exactly the same
questions to the selected model, so you can flip back and forth and compare
the answers; the choice is remembered in the browser. Jev
([TypeSafe](https://docs.typesafe.ai/introduction)) is called through the
[OpenRouter Decisions API](https://openrouter.ai/docs/guides/community/jev)
and needs an OpenRouter key. Put it in `.env` in the repository root (the file
is git-ignored) and restart the backend:

```text
OPENROUTER_API_KEY=sk-or-v1-...
```

A real environment variable takes precedence over `.env`. Optional:
`JEV_MODEL` (default `typesafe/jev-1.13`) and `JEV_API_URL` (default
`https://openrouter.ai/api/alpha/decisions`). Without a key the Jev button is
disabled. Jev is billed per input token; one Emoji Rain request carries 200
questions, and the backend caches recent phrases per model so switching back
does not pay again.

In Emoji Rain both models get the same question. The yes/no answer
descriptions differ because the two APIs read them differently: LAYA gets the
short labels tak/nie (yes/no), Jev gets `criteria` that say when the answer is
true or false (NDCG@5 about 0.73 -> 0.78–0.80 for Jev; the same descriptions
lowered LAYA's). The two models score on different scales, so each has its own
lift threshold, remembered separately: **LAYA 85%, Jev 45%**. Two more rules
apply to both: nothing is sent before 3 characters, and if more than 20 emoji
pass the threshold the page shows “no clear match” instead of lifting them.

`examples/diagnose_emoji_typing.py` measured this on the 13 test phrases, every
prefix typed on the way to them, and 21 extra phrases with hand-picked expected
emoji (typos, missing diacritics, emotions, negation, indirect associations,
gibberish). On the 34 complete phrases:

| At the default thresholds | LAYA 85% | Jev 45% |
| --- | --- | --- |
| Emoji lifted per phrase | 1.8 | 3.2 |
| Lifted emoji that are right | 70% | 60% |
| Expected emoji found | 47% | 75% |
| Phrases with nothing lifted | 8 of 32 | 1 of 32 |
| Ranking (AUC, 13 test phrases) | 0.89 | 0.97 |

- **Thresholds:** LAYA's best F1 is at 85%; below that it quickly adds wrong
  emoji. Jev scores cautiously: with LAYA's old 75% it lifted about one emoji
  per phrase. Its best F1 is at 55%, but that left four phrases, “jedzenie”
  (food) among them, with nothing lifted, so the default is 45%.
- **Typing:** after one or two letters Jev in particular guesses from the
  letters (“ub” -> bread, burger), hence the 3-character minimum. Mid-word
  prefixes still lift wrong emoji now and then for both models (LAYA: “coś na
  desz” -> strawberry; Jev: “chcę tw” -> T-shirt, keyboard); quality rises
  steadily as the phrase is completed.
- **Gibberish:** In the earlier 100-item benchmark, LAYA scored almost every
  emoji near 100% for “asdfgh” or “xyz 123” (44–86 of 100 above the threshold,
  while real phrases reached at most 7), which the “no clear match” rule caught.
  Jev lifted nothing for them.
- **LAYA's typical mistakes:** confident unrelated emoji (“mecz”, match -> city
  0.91, metro 0.84, cheese 0.72; “wkurzyłem się”, I got angry -> surprise 0.95;
  “pies na spacerze”, dog on a walk -> mountains 0.89, no dog), broad phrases
  scored near zero (“ubrania”, clothes: gloves 0.01, hat 0.03) and missing
  diacritics (“ide na basen” -> guitar).
- **Jev's typical mistakes:** the house emoji for anything near home or travel
  (“lecę na wakacje”, flying on holiday -> house 0.95), typos (“jedznie” ->
  tiredness, keyboard; LAYA handles it) and weak indirect links (“zoo” -> lion
  0.15).

The expected emoji of the extra phrases were chosen by hand, and Jev's answers
vary slightly between runs, so small differences are noise.

## Architecture

```text
browser → React / Vite → FastAPI → LAYA multilingual (local)
                                  → Jev via OpenRouter (optional)
```

- `frontend/` — the start page and both demos,
- `backend/` — the local API and LAYA question construction,
- `data/` — the 200-item emoji catalogs (Polish and English) and evaluation cases,
- `examples/` — experiments with `choice` and `noul` question types.

The API exposes `POST /predict` (`{"text", "lang", "engine"}`) for emoji and
`POST /tetris/choose` (`{"candidates", "engine"}`, answering with the scores and
the move descriptions sent to the model) for Tetris. The emoji catalog is available through
`GET /catalog?lang=pl|en`; `GET /health` reports the model and the device it
runs on. Both demos use the same local LAYA checkpoint. LAYA scores 200 emoji in one
batch of independent questions; the demo slider sets the display threshold,
75% by default. `noul` scores are not a correctness guarantee.

### Tetris

The game starts immediately. The game engine enumerates legal placements and
ranks them with its own heuristic (lines, holes, stack height, bumpiness, nearly
complete rows and the next-piece clear potential). The model gets the top 4, the
top 8 or all of them (the “Candidates” setting, 4 by default) and rates each move
with its own `noul` question (“A Tetris player wants to clear lines and avoid
holes and a tall stack. Would this move help them? The move …”); the best-rated
move is played, and on a tie the engine's order decides. Moves are described in
words, relative to the board before the move: lines cleared, new holes, how much
the stack rises, whether the surface gets flatter or rougher, a warning near the
top and the next piece's clear potential. In earlier tests LAYA ignored raw
numbers and picked by option position.

`examples/compare_tetris_prompts.py` plays six seeded headless games (up to 250
pieces each; the same piece sequences for every variant) with a Python port of
the engine. Mean lines per game:

| Variant | LAYA | Jev |
| --- | --- | --- |
| Earlier absolute description (“leaves two covered holes, the stack gets tall”), 4 candidates | 20.5 (60% tied scores) | 69.3 (32% ties) |
| **Relative description (current), 4 candidates** | **40.2** (15% ties) | **97.2** (4% ties) |
| Relative description, 8 candidates | 9.5 | – |
| Relative description, all candidates | 3.3 | 94.5 |
| Stricter question (“Is this a good Tetris move? A good move …”), relative, 4 | 5.7 | 97.0 |
| References: engine's top move 96.7 · random of top 4: 3.7 · random of all: 0.0 | | |

Jev reached the 250-piece cap in every game with the relative description,
even when choosing among all moves without the engine's shortlist. LAYA gains
most from the relative description, loses most of its advantage once it has
more than four candidates, and did much worse with the stricter question, so
the question stays as it was. `examples/evaluate_tetris_moves.py` checks the
question on pairs where one move is strictly better, and
`frontend/scripts/benchmark-tetris.mts` plays the same comparison through the
backend.

Tetris is a model test with no manual control. Each piece waits at the top
until the selected model answers, so a slower model (Jev over the network) does
not lose moves to gravity. After the choice the piece rotates, slides and falls
one step at a time to the chosen landing; if its path is blocked, it is placed
directly there. The speed slider (1–10) sets the delay per step, from 300 ms to
9 ms, and is the only thing that sets the pace: levels only affect scoring.
Pause and New game are the only controls. Switching the model starts a new
game, so each game is played by one model.

The decision log on the left lists every move: time, piece, model, response
time, the chosen column and rotation with its score, the scores of all
candidates, the steps taken (↻ rotations, ← → columns, ↓ rows) and the lines
cleared. The model panel shows the current candidates with their scores, the
word description each one was sent with, and the question template; the chosen
landing is outlined on the board. The scores are not calibrated win
probabilities, and equal descriptions often get equal scores, in which case the
engine's shortlist order decides.

Finished, stopped and model-switched games are listed under “Recent games in
this session” (score, lines, pieces, mean response time and mean score, plus the
mean lines per model). The list is kept in `sessionStorage`, so it survives a
reload of the tab. The game includes scoring, levels, combos, back-to-back
Tetris bonuses, a next-piece preview and a seven-bag piece randomizer.

## Tests

Fast checks that do not load the model:

```powershell
python -m unittest discover -s backend/tests -t backend
```

## Device

LAYA automatically selects the available device. Set `LAYA_DEVICE=cpu` or
`LAYA_DEVICE=cuda` before starting the backend. Optional PyTorch CUDA build for
Windows/NVIDIA:

```powershell
python -m pip install --force-reinstall --no-deps -r .\backend\requirements-cuda.lock
```

Experiment details and reproduction commands are in
[examples/README.md](examples/README.md).
