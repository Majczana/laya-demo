# LAYA Emoji Demo

Lokalne demo technologiczne pokazujące, jak model decyzyjny LAYA może oceniać,
które emoji najlepiej pasują do wpisanego zdania.

Projekt rozwijamy małymi krokami. Obecny etap przygotowuje środowisko i granicę
między interfejsem a modelem. Logika porównująca `choice` i `noul` powstanie w
następnym kroku.

## Architektura

```text
przeglądarka -> React/Vite -> FastAPI -> LAYA
```

- `frontend/` — interfejs React + TypeScript,
- `backend/` — lokalne API FastAPI i późniejsza integracja LAYA,
- `data/` — wspólny katalog emoji oraz oczekiwanych wyników testów,
- `examples/` — skrypty uruchamiające eksperymenty `choice` i `noul`.

## Wymagania

- Node.js 22.12 lub nowszy,
- Python 3.10 lub nowszy (środowisko zostało sprawdzone na Pythonie 3.14),
- Git.

## Frontend

```bash
cd frontend
npm install
npm run dev
```

Interfejs będzie dostępny pod adresem `http://localhost:5173`.

## Backend

Windows PowerShell:

```powershell
py -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -r .\backend\requirements.lock
python -m pip install --no-deps -e .\backend
uvicorn app.main:app --reload --app-dir backend
```

macOS/Linux:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -r ./backend/requirements.lock
python -m pip install --no-deps -e ./backend
uvicorn app.main:app --reload --app-dir backend
```

Kontrola działania API: `http://localhost:8000/health`.

Przy pierwszym rzeczywistym użyciu LAYA zostaną pobrane wagi modelu z Hugging
Face. Nie zapisujemy ich w repozytorium.

## Sprawdzenie danych

Po aktywowaniu środowiska backendu uruchom loader z katalogu głównego:

```bash
python -m app.data_loader
```

Loader odczytuje oba pliki JSON, sprawdza ich strukturę oraz zależności między
nimi. Nie uruchamia jeszcze modelu LAYA.

## Podgląd zapytania `choice`

Możesz zbudować i obejrzeć zapytanie bez uruchamiania modelu:

```bash
python examples/build_choice_request.py "jedzenie zdrowe"
```

Każde emoji staje się jedną opcją w `criteria`. Kluczem jest stabilne `id`, a
wartością polska etykieta połączona z opisem semantycznym.

## Pierwsza decyzja LAYA

Jedno kontrolowane wywołanie wielojęzycznego modelu na CPU:

```bash
python examples/run_choice_once.py "jedzenie zdrowe"
```

Pierwsze uruchomienie pobiera wagi modelu. Skrypt wypisuje niezmienioną
odpowiedź LAYA razem z czasem całej operacji.

Porównanie tego samego zapytania z dwoma budżetami opcji:

```bash
python examples/compare_choice_budgets.py "jedzenie zdrowe"
```

Porównanie pełnych opisów z samymi etykietami:

```bash
python examples/compare_choice_descriptions.py "jedzenie zdrowe"
```

Porównanie semantycznych identyfikatorów z neutralnymi kluczami `A–P`:

```bash
python examples/compare_choice_keys.py "jedzenie zdrowe"
```

Porównanie polskich i angielskich opisów na wszystkich polskich przypadkach
testowych:

```bash
python examples/compare_choice_languages.py
```

Angielski katalog znajduje się w `data/emojis_eng.json`. Skrypt zachowuje te
same emoji, identyfikatory, kolejność, zapytania i ustawienia modelu, a zmienia
wyłącznie język etykiet oraz opisów.

## Porównywanie `choice` i `noul`

Oba podejścia zwracają inaczej znormalizowane prawdopodobieństwa, dlatego nie
porównujemy ich surowych wartości. W obu przypadkach sortujemy emoji malejąco
według wyniku i mierzymy jakość rankingu za pomocą NDCG@5:

- oczekiwany wynik `primary` ma trafność `2`,
- wynik `related` ma trafność `1`,
- pozostałe wyniki mają trafność `0`.

Takie porównanie sprawdza, czy właściwe emoji znalazły się wysoko, niezależnie
od tego, czy wyniki pochodzą ze wspólnego rozkładu `choice`, czy z niezależnych
prawdopodobieństw `noul`.
