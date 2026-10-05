# Comprehensive Specification: MojeSaldoo Apple-Inspired Light System

> Aktualny wygląd pól, selectów, przycisków i kart jest w [`design.md`](design.md). Przy rozbieżności (kolor primary, kapsułki, wysokość pól) wygrywa `design.md`. Ten dokument zostaje jako starszy szkic kierunku.



## 1. Executive Summary & Design Philosophy

Projekt zakłada transformację MojeSaldoo w aplikację biznesową klasy **Craft-First SaaS** (wzorowaną na standardach Apple, Linear, Vercel). 

### Główne Filary UX/UI:
1. **Light-First High Contrast:** Maksymalna czytelność w trudnych warunkach oświetleniowych (w aucie, w drodze do klienta, na magazynie przy mocnym słońcu).
2. **Thumb-Driven Mobile UX:** Przeniesienie 80% kluczowych interakcji w zasięg dolnej strefy kciuka.
3. **Micro-Feedback & Fluidity:** Natychmiastowa reakcja interfejsu na gesty i dotyk (stany *Active*, delikatna haptyka, animacje o ostrej krzywej wygaszania).
4. **Data-Density Control:** Możliwość przełączania widoków z kompaktowego (magazyn/listy) na kardowy (szybki podgląd w terenie).

---

## 2. Global Design System Tokens

### 2.1 Color Matrix (Light Mode / High Outdoor Visibility)

| Token Name | Hex / CSS Value | Zastosowanie |
| :--- | :--- | :--- |
| `--bg-base` | `#F6F8FA` | Tło całej aplikacji (subtelna, niemęcząca oczu chłodna biel) |
| `--surface-card` | `#FFFFFF` | Tło kart, tabel, arkuszy edycji |
| `--surface-glass` | `rgba(255, 255, 255, 0.82)` | Paski nawigacyjne i modale (z `backdrop-filter: blur(20px)`) |
| `--border-subtle` | `rgba(15, 23, 42, 0.08)` | Standardowe ramki i podziały sekcji (`1px`) |
| `--border-active` | `rgba(0, 102, 255, 0.4)` | Stan skupienia (Focus) na polach tekstowych |
| `--text-main` | `#090D16` | Główny tekst, nagłówki, kwoty faktur (kontrast 16:1) |
| `--text-muted` | `#62728D` | Etykiety, daty, opisy pól |
| `--accent-apple` | `#0066FF` | Główne przyciski akcji, aktywne tabby |
| `--badge-success-bg` | `#E6F4EA` | Tło statusu: *Opłacona / Na stanie* |
| `--badge-success-txt` | `#137333` | Tekst statusu: *Opłacona / Na stanie* |
| `--badge-warning-bg` | `#FEF7E0` | Tło statusu: *Oczekująca / Niski stan* |
| `--badge-warning-txt` | `#B06000` | Tekst statusu: *Oczekująca / Niski stan* |
| `--badge-danger-bg` | `#FCE8E6` | Tło statusu: *Przeterminowana / Brak w magazynie* |
| `--badge-danger-txt` | `#C5221F` | Tekst statusu: *Przeterminowana / Brak w magazynie* |

### 2.2 Typografia i Zastrzeżenia Danych

* **Font Primary:** `Geist`, `Inter` lub `-apple-system, BlinkMacSystemFont`.
* **Proporcje i Optyka:**
  * **Wartości finansowe:** Oznaczone właściwością `font-variant-numeric: tabular-nums`. Uniemożliwia to "przeskakiwanie" cyfr przy zmianie danych lub sortowaniu.
  * **Światło międzyliterowe (Tracking):** Nagłówki h1-h3 posiadają `letter-spacing: -0.025em`.
* **Rozmiary dla Mobile:**
  * Kwota główna faktury / sumy dziennej: `28px` / `Bold`.
  * Nazwa kontrahenta na karcie: `16px` / `SemiBold`.
  * Etykiety pomocnicze: `13px` / `Medium`.

---

## 3. Komponenty UI & Inżynieria Interfejsu

### 3.1 Pływający Pasek Nawigacyjny (Floating Island Navbar)
Zamiast sztywnego paska przyklejonego do samej góry ekranu mobilnego:
* Navigation Bar unosi się `12px` od górnej krawędzi i posiada zaokrąglenie `24px`.
* Tło wykonane w technologii White Glass (`rgba(255,255,255,0.82)` + `backdrop-blur(16px)`).
* Posiada subtelny, wielowarstwowy cień:
  ```css
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.03), 0 10px 15px -3px rgba(0, 0, 0, 0.05);