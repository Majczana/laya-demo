# LAYA Emoji Demo

Lokalne demo technologiczne pokazujące, jak model decyzyjny LAYA może oceniać,
które emoji najlepiej pasują do wpisanego zdania.

Projekt rozwijamy małymi krokami. Obecny etap obejmuje działającą lokalnie
integrację LAYA oraz kontrolowane eksperymenty porównujące `choice` i `noul`.

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

### Urządzenie obliczeniowe

Domyślne `LAYA_DEVICE=auto` pozwala LAYA wybrać dostępne GPU, a przy jego braku
automatycznie używa CPU. Wymuszenie urządzenia w PowerShell:

```powershell
$env:LAYA_DEVICE = "cpu"
$env:LAYA_DEVICE = "cuda"
```

Podstawowy plik zależności pozostaje przenośny. Użytkownik Windows z kartą
NVIDIA i odpowiednim sterownikiem może po jego instalacji zastąpić PyTorch
wariantem CUDA 13.2:

```powershell
python -m pip install --force-reinstall --no-deps `
  -r .\backend\requirements-cuda.lock
python -c "import torch; print(torch.cuda.is_available())"
```

Druga komenda powinna wypisać `True`. Wariant CUDA nie jest wymagany do
uruchomienia repozytorium na komputerze bez karty NVIDIA.

## Sprawdzenie danych

Po aktywowaniu środowiska backendu uruchom loader z katalogu głównego:

```bash
python -m app.data_loader
```

Loader odczytuje oba pliki JSON, sprawdza ich strukturę oraz zależności między
nimi. Nie uruchamia jeszcze modelu LAYA.

Rozszerzony katalog `data/emojis_100.json` zawiera 100 emoji. Zachowuje
wszystkie elementy katalogu podstawowego i dodaje kandydatów z obszarów takich
jak jedzenie, odzież, pogoda, sport, kultura, transport, zwierzęta, technologia,
miejsca i emocje. Katalogi obsługują od 1 do 100 unikalnych emoji.

## Podgląd zapytania `choice`

Możesz zbudować i obejrzeć zapytanie bez uruchamiania modelu:

```bash
python examples/build_choice_request.py "jedzenie zdrowe"
```

Każde emoji staje się jedną opcją w `criteria`. Kluczem jest stabilne `id`, a
wartością polska etykieta połączona z opisem semantycznym.

## Pierwsza decyzja LAYA

Jedno kontrolowane wywołanie wielojęzycznego modelu na urządzeniu wybranym
przez `LAYA_DEVICE`:

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

Porównanie jednego pytania `choice` z 16 niezależnymi pytaniami `noul`:

```bash
python examples/compare_choice_noul.py
```

Wariant `noul` ocenia każde emoji niezależnie, ale wszystkie pytania przekazuje
modelowi razem w jednym wywołaniu.

W eksperymencie na 13 przypadkach polskich opisów wariant `noul` korzystający
z polskich etykiet odpowiedzi `nie`/`tak` osiągnął średnie NDCG@5 równe
`0,8889`, a `choice` — `0,5795`. Jest przy tym wolniejszy i zużywa więcej
tokenów, co skrypt pokazuje razem z jakością.

Benchmark `noul` na wybranym urządzeniu:

```powershell
python examples/benchmark_noul_device.py --device cpu
python examples/benchmark_noul_device.py --device cuda
python examples/benchmark_noul_device.py --device cuda --catalog-size 100
```

Pierwszy pomiar obejmuje załadowanie modelu, a statystyki `warm_seconds`
obejmują dziesięć kolejnych predykcji po rozgrzaniu.

Pomiar referencyjny na RTX 3060 Ti dla 16 pytań `noul`:

| Urządzenie | Średni czas po rozgrzaniu |
| --- | ---: |
| CPU | `0,3336 s` |
| CUDA | `0,0336 s` |

GPU było około `9,9×` szybsze i wykorzystało około `1528 MB` pamięci. Czas
pierwszego wywołania wynosił około `5,2 s` na obu urządzeniach, ponieważ
obejmuje wczytanie i zbudowanie modelu. Ranking pięciu najlepszych emoji
pozostał taki sam.

Porównanie jakości i kosztu katalogów 16 oraz 100 emoji:

```powershell
python examples/compare_noul_catalog_sizes.py
```

Skrypt używa tych samych 13 fraz testowych. Plik `data/test-cases_100.json`
rozszerza jednak listy oczekiwanych odpowiedzi, ponieważ np. marchew i
truskawka również są poprawnymi wynikami dla „jedzenie zdrowe”.

Pierwszy pomiar rozszerzonego katalogu:

| Katalog | NDCG@5 | Tokeny | CPU | RTX 3060 Ti |
| --- | ---: | ---: | ---: | ---: |
| 16 emoji | `0,8889` | `1112` | `0,3336 s` | `0,0336 s` |
| 100 emoji | `0,7297` | `7256` | `2,6654 s` | `0,1430 s` |

Dla 100 emoji GPU było około `18,6×` szybsze od CPU i wykorzystało około
`1685 MB` VRAM. Dla frazy „jedzenie zdrowe” pierwsze cztery miejsca zajęły
brokuły, truskawka, marchew i jabłko. Spadek średniej jakości stanowi bazę do
późniejszego strojenia opisów i pytań na trudniejszym katalogu.

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
