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
