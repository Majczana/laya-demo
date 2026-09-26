# LAYA experiments

Most scripts in this folder use only the local LAYA `multilingual` checkpoint;
the `compare_*_prompts.py` and `compare_emoji_engines.py` scripts can also call
Jev, which needs `OPENROUTER_API_KEY` in `.env`.
Run them from the repository root after activating the Python environment.

| Goal | Command |
| --- | --- |
| Inspect a `choice` request without running the model | `python examples/build_choice_request.py "healthy food"` |
| Run one choice prediction | `python examples/run_choice_once.py "healthy food"` |
| Compare `choice` with independent `noul` questions | `python examples/compare_choice_noul.py` |
| Compare descriptions and labels in `choice` | `python examples/compare_choice_descriptions.py` |
| Compare option keys | `python examples/compare_choice_keys.py` |
| Compare token budgets | `python examples/compare_choice_budgets.py` |
| Compare description language | `python examples/compare_choice_languages.py` |
| Compare descriptions and labels in `noul` | `python examples/compare_noul_descriptions.py` |
| Compare the 16 and 100 emoji catalogs | `python examples/compare_noul_catalog_sizes.py` |
| Benchmark CPU/GPU speed | `python examples/benchmark_noul_device.py --device cuda --catalog-size 100` |
| Check Tetris move ratings on strictly better/worse pairs | `python examples/evaluate_tetris_moves.py` |
| Compare Tetris questions, move descriptions and candidate counts in headless games (LAYA or Jev) | `python examples/compare_tetris_prompts.py --engine laya` |
| Compare LAYA and Jev on the emoji test phrases: ranking, calibration and question variants | `python examples/compare_emoji_engines.py --show-top` |
| Emoji Rain diagnostics for both models: typing prefixes, threshold sweep, single mistakes (scores cached in `work/`) | `python examples/diagnose_emoji_typing.py --collect`, then `python examples/diagnose_emoji_typing.py` |

Evaluation cases are in `data/test-cases.json` and `data/test-cases_100.json`.
They measure ranking for complete phrases, so they do not yet describe quality
for unfinished words in the interactive demo.

Test phrases are Polish. The experiments load the Polish catalogs by default
(`emojis_pl.json`, `emojis_100_pl.json`). In the last run on 13 complete
phrases and 100 emoji, `noul` reached a mean NDCG@5 of `0.7297` with Polish
instructions and tak/nie labels, `0.6993` with English instructions on the same
Polish catalog, and `0.4316` with the English catalog (`emojis_100.json`, used
by the app's English mode). An English test set is still needed to judge the
English mode on English input. These are small development samples, not
finished product evaluations.
