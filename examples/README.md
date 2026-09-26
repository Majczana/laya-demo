# Skrypty eksperymentalne

W tym katalogu znajdują się skrypty uruchamiające dwa rodzaje eksperymentów:

1. jedno pytanie `choice` ze wszystkimi emoji jako opcjami,
2. osobne pytanie `noul` dla każdego emoji.

Oba skrypty będą korzystać z tych samych danych w `data/emojis.json` oraz
`data/test-cases.json`. Dzięki temu porównamy jakość wyników i czas odpowiedzi,
zamiast oceniać oba podejścia na różnych przykładach.

## Podgląd zapytania `choice`

Z katalogu głównego projektu uruchom:

```bash
python examples/build_choice_request.py "jedzenie zdrowe"
```

Skrypt wypisuje gotowe zapytanie, ale nie ładuje ani nie uruchamia modelu.

## Pierwsza decyzja modelu

Uruchom pojedynczy przypadek na wielojęzycznym checkpointcie:

```bash
python examples/run_choice_once.py "jedzenie zdrowe"
```

Pierwsze wywołanie pobiera wagi modelu i dlatego trwa dłużej. Kolejne
wywołania korzystają z lokalnej pamięci podręcznej.

## Porównanie budżetu opcji

Uruchom ten sam tekst z `head_max_len` równym 256 i 512:

```bash
python examples/compare_choice_budgets.py "jedzenie zdrowe"
```

Skrypt najpierw rozgrzewa model, a następnie porównuje oba rankingi w tym samym
procesie. Nie zmienia opisów ani kolejności emoji.

## Porównanie długości kryteriów

Porównaj pełne opisy z samymi polskimi etykietami:

```bash
python examples/compare_choice_descriptions.py "jedzenie zdrowe"
```

Budżet i kolejność emoji pozostają bez zmian.

## Porównanie kluczy opcji

Porównaj semantyczne identyfikatory z neutralnymi kluczami `A–P`:

```bash
python examples/compare_choice_keys.py "jedzenie zdrowe"
```

Pełne polskie opisy, budżet i kolejność emoji pozostają bez zmian.

## Porównanie języka opisów

Porównaj katalog polski z angielskim na wszystkich 13 polskich frazach:

```bash
python examples/compare_choice_languages.py
```

Zmieniają się tylko etykiety i opisy. Identyfikatory, emoji, kolejność,
zapytania, budżet oraz model pozostają takie same.

## Porównanie `choice` i `noul`

Uruchom oba podejścia na wszystkich przypadkach testowych:

```bash
python examples/compare_choice_noul.py
```

Skrypt porównuje średnie NDCG@5, czas działania, liczbę tokenów oraz ranking
dla przypadku „jedzenie zdrowe”. Wszystkie 16 pytań `noul` trafia do modelu w
jednym wywołaniu i używa polskich etykiet odpowiedzi `nie`/`tak`.

## Benchmark CPU i GPU

Po zainstalowaniu opcjonalnego wariantu PyTorch CUDA porównaj urządzenia w
osobnych procesach:

```powershell
python examples/benchmark_noul_device.py --device cpu
python examples/benchmark_noul_device.py --device cuda
python examples/benchmark_noul_device.py --device cuda --catalog-size 100
```

Skrypt oddziela czas pierwszego załadowania modelu od czasu dziesięciu
rozgrzanych predykcji i raportuje faktycznie użyte urządzenie.

Na referencyjnym RTX 3060 Ti średni czas rozgrzanej predykcji spadł z
`0,3336 s` na CPU do `0,0336 s` na CUDA, czyli około `9,9×`.

## Porównanie wielkości katalogu

Porównaj ten sam wariant `noul` dla 16 i 100 emoji:

```powershell
python examples/compare_noul_catalog_sizes.py
```

Skrypt sprawdza, czy większy katalog zachowuje oryginalne emoji, czy oba zbiory
używają tych samych fraz, a następnie porównuje NDCG@5, czas, tokeny i ranking
„jedzenie zdrowe”. Oczekiwane odpowiedzi są rozszerzone o nowe trafne emoji.

W pierwszym pomiarze katalog 100 emoji osiągnął NDCG@5 `0,7297`. Rozgrzana
predykcja trwała średnio `2,6654 s` na CPU i `0,1430 s` na RTX 3060 Ti.

## Porównanie embeddingów z LAYA

Eksperyment korzysta z `sentence-transformers` z zależności backendu.

Słowa kluczowe emoji z polskich adnotacji Unicode CLDR generuje:

```bash
python examples/build_cldr_keywords.py
```

Skrypt zapisuje `data/emoji_keywords_cldr_pl.json`. Porównanie uruchom poleceniem:

```bash
python examples/compare_embedding_retrieval.py
```

Skrypt mierzy NDCG@5 na 100 emoji i 13 frazach dla:

- LAYA `noul` z etykietą i opisem (obecny backend),
- `intfloat/multilingual-e5-large` i `sdadas/mmlw-retrieval-roberta-large`
  z dokumentami: sama etykieta, etykieta z CLDR, etykieta z opisem oraz
  etykieta z opisem i CLDR,
- najlepszego wariantu embeddingów z rerankingiem top 10 przez LAYA: jednym
  pytaniem `choice` z neutralnymi kluczami `A–J` albo osobnymi pytaniami `noul`.

W pierwszym pomiarze na Apple GPU (MPS):

| wariant | NDCG@5 | czas zapytania |
|---|---|---|
| LAYA `noul`, etykieta + opis (obecny backend) | 0,7308 | 1,029 s |
| e5-large, etykieta | 0,4377 | 0,039 s |
| e5-large, etykieta + CLDR | 0,7934 | 0,038 s |
| e5-large, etykieta + opis | 0,8601 | 0,038 s |
| e5-large, etykieta + opis + CLDR | 0,8586 | 0,038 s |
| mmlw-roberta-large, etykieta | 0,6132 | 0,026 s |
| mmlw-roberta-large, etykieta + CLDR | 0,7575 | 0,026 s |
| mmlw-roberta-large, etykieta + opis | **0,8654** | 0,026 s |
| mmlw-roberta-large, etykieta + opis + CLDR | 0,8514 | 0,025 s |
| mmlw + reranking LAYA `choice` top 10 | 0,6266 | 0,113 s |
| mmlw + reranking LAYA `noul` top 10 | 0,8277 | 0,201 s |

Zbiór testowy ma tylko 13 pełnych fraz, a interfejs wysyła też niedokończone
słowa, więc wyniki są wskazówką, a nie ostatecznym rozstrzygnięciem.
