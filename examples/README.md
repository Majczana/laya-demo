# Skrypty eksperymentalne

W tym katalogu zapiszemy skrypty uruchamiające dwa eksperymenty:

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
