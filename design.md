# Wygląd formularzy — wzór do ujednolicenia stron

Ten plik jest aktualnym standardem pól, selectów, przycisków i kart. Wzorzec pochodzi ze strony **Nowa faktura** (`frontend/src/pages/InvoiceManualPage.tsx`). Klasy pól są w `frontend/src/index.css`.

Przy rozbieżności z `design.md.md` albo ze starszym opisem kapsułek w `frontend/CLAUDE.md` **wygrywa ten plik**.

Użytkownik ma często 50+ lat i pracuje na telefonie. Tekst ma być czytelny jak reszta interfejsu, nie powiększony „pod niedowidzących”. Kontrast jest ważniejszy niż wysokość pola.

---

## Kolory

| Rola | Wartość |
|---|---|
| Tło strony | `#F2F2F7` (`--background`) |
| Karta | biała, `border-slate-200`, `shadow-apple-sm` |
| Primary | `#5856D6` |
| Wypełnienie pola | `#F2F2F7` |
| Ramka pola | `#AEAEB2` |
| Tekst w polu | `text-slate-900` |
| Placeholder | `text-slate-500` |
| Etykieta nad polem | `text-sm font-medium text-slate-800` |
| Focus | tło białe, ramka `primary`, pierścień `ring-2 ring-primary/30` |

Nie używaj na polach `bg-slate-50`, `border-slate-200`, szarego insetu ani półprzezroczystego szkła.

---

## Karta sekcji

```tsx
<section className="rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
```

Karty jedna pod drugą, `gap-3`. Nie układaj płatności i podsumowania obok siebie.

---

## Tytuły, podtytuły, ikony

Każdy poziom ma jeden wygląd. Tytuł sekcji nie może wyglądać jak etykieta pola.

| Poziom | Klasy | Kiedy |
|---|---|---|
| Tytuł strony | `text-base font-bold tracking-tight text-slate-900 md:text-xl` | Nazwa ekranu, np. „Ręcznie — Nowa Faktura” |
| Podtytuł strony | `text-xs text-slate-500` | Jedna linia pod tytułem strony |
| Tytuł sekcji | ikona w kwadracie + `text-sm font-semibold text-slate-900` | „Klient”, „Numer faktury”, „Płatność i dostawa”, nagłówek akordeonu |
| Podtytuł sekcji | `text-xs text-slate-500`, zaraz pod tytułem | Krótkie wyjaśnienie, np. że sekcja nie jest wymagana |
| Etykieta pola | `mb-1.5 block text-sm font-medium text-slate-800` | Nad inputem, selectem i datą. Bez ikony |
| Podpowiedź pod polem | `mt-1.5 text-xs text-slate-500` | „Nadany automatycznie”, „Zastąpi datę terminu w KSeF” |
| Ważna wartość | `text-base font-semibold text-primary` na `rounded-lg bg-primary/10 px-2.5 py-1` | Numer faktury. To nie jest pole |

Nie używaj `text-[10px]`, `text-[11px]`, `uppercase` ani `tracking-wider` w tytułach i podpisach. Nie rób tytułu sekcji stylem etykiety (`font-medium text-slate-800` bez ikony).

### Tytuł sekcji

Każda karta i każdy akordeon zaczyna się tak samo: ikona, obok tytuł. Odstęp `gap-2.5`.

```tsx
<div className="flex items-center gap-2.5">
  <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary" aria-hidden>
    {/* inline SVG, h-4 w-4, fill none, stroke currentColor, strokeWidth 1.8 */}
  </span>
  <h2 className="text-sm font-semibold text-slate-900">Numer faktury</h2>
</div>
```

Ikona jest lokalnym SVG. Nie dodawaj `lucide-react` tylko po to, żeby mieć ikonę. Kwadrat jest zawsze `h-7 w-7 rounded-lg bg-primary/10 text-primary`. Samo `h-4 w-4 text-primary` przy tytule, bez kwadratu, jest za słabe.

Podtytuł sekcji stoi pod tytułem, w tej samej kolumnie co tekst, nie pod ikoną:

```tsx
<div className="flex items-center gap-2.5">
  <span className="...ikonowy kwadrat..." />
  <div>
    <h2 className="text-sm font-semibold text-slate-900">Dodatkowe opcje</h2>
    <p className="text-xs text-slate-500">Nie są wymagane do wystawienia faktury</p>
  </div>
</div>
```

### Etykieta i podpowiedź

Etykieta jest nad polem i nie ma ikony. Podpowiedź jest pod polem, nie w jednej linii z etykietą.

```tsx
<label className="mb-1.5 block text-sm font-medium text-slate-800">Opis terminu płatności</label>
<input className="field-ios w-full" />
<p className="mt-1.5 text-xs text-slate-500">Zastąpi datę terminu w KSeF</p>
```

### Ważna wartość, która nie jest polem

Numer faktury zostaje tekstem. Pole pojawia się dopiero po kliknięciu ołówka obok.

```tsx
<span className="truncate rounded-lg bg-primary/10 px-2.5 py-1 text-base font-semibold tracking-tight text-primary">
  FV/2026/0166
</span>
<button type="button" aria-label="Zmień numer faktury" className="flex h-8 w-8 items-center justify-center rounded-lg text-primary hover:bg-primary/10">
  {/* ołówek */}
</button>
```

Ołówek jest w kolorze primary i widać go od razu. Nie chowaj go do hovera.

---

## Pola, selecty, daty

Wspólne klasy. Nie składaj wyglądu pola z gołych klas Tailwinda na każdej stronie.

| Klasa | Kiedy |
|---|---|
| `field-ios` | Zwykłe pole na szerokość karty |
| `field-ios-tall` | Textarea (`py-2.5`) |
| `field-ios-sm` | Małe pole w wierszu pozycji (cena) |
| `select-pill` | Select. Nazwa została, kształt to pole, nie kapsułka |
| `date-pill` | Data. Ten sam kształt co select |

Wygląd (już w CSS):

- wysokość około 36 px: `py-2`, `text-sm`, `leading-5`
- `rounded-lg`, nie `rounded-full` i nie `rounded-xl`
- bez `min-h-11` — 44 px to wysokość wiersza listy, nie pola tekstowego
- bez cienia w środku pola
- tekst `text-sm`, taki jak etykiety. Nie podnoś go do 17 px

Etykieta stoi **nad** polem, z `mb-1.5`. Nie rozciągaj krótkiego pola na całą szerokość karty i nie dawaj etykiety po lewej, a pola po prawej, jeśli między nimi zostaje pusta dziura.

```tsx
<label className="block">
  <span className="mb-1.5 block text-sm font-medium text-slate-800">Metoda płatności</span>
  <div className="relative">
    <select className="select-pill w-full">...</select>
    <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-500">
      {/* chevron h-4 w-4 */}
    </span>
  </div>
</label>
```

Data sprzedaży i podobne pary: select o naturalnej szerokości (`sm:w-56`) obok daty (`sm:w-52`). Dwa pola „od–do” nie rozciągają się na resztę wiersza.

Pole z ikoną szukania: `field-ios pl-9`, ikona `absolute left-3`.

Lista podpowiedzi **nie otwiera się sama** przy wejściu na stronę. `autoFocus` może zostać. Lista po kliknięciu w pole albo po wpisaniu tekstu.

---

## Przyciski

Tekst przycisku: `text-sm font-semibold`. Kształt: `rounded-2xl`.

| Rola | Klasy |
|---|---|
| Główna akcja | `bg-primary text-primary-foreground hover:bg-primary/90` plus `px-5 py-2.5` |
| Drugorzędna | `border border-primary/50 text-primary hover:bg-primary/5` plus `px-4 py-2.5` |
| Cofnij | `border border-border text-foreground hover:bg-muted` plus `px-4 py-2.5` |
| Wyłączony | `cursor-not-allowed bg-muted text-muted-foreground` |
| Usuń wiersz | `h-8 w-8 rounded-lg bg-destructive/10 text-destructive` |
| Krok ilości | minus na białym z ramką `#AEAEB2`; plus `bg-primary text-white`, ok. 28–32 px |

Pasek akcji na dole formularza zostaje na dole ekranu (nad dolną nawigacją na telefonie). W tym pasku jest tylko kwota brutto i przyciski. Rozbicie netto / VAT / słownie zostaje w karcie podsumowania, nie powtarza się na dole.

---

## Wiersz pozycji

```tsx
<div className="rounded-xl border border-[#AEAEB2] bg-[#F2F2F7] p-3">
```

- nazwa: `text-sm font-semibold text-slate-900`
- SKU i magazyn: `text-xs text-slate-600`
- cena: `field-ios-sm bg-white`, wyrównana do prawej
- VAT: biała plakietka albo `select-pill bg-white`, tekst `text-sm`
- kwota pozycji: `text-sm font-semibold tabular-nums text-slate-900`
- netto pod kwotą: `text-xs text-slate-600`

Nie stawiaj białego wiersza na białej karcie bez ramki.

---

## Podsumowanie kwoty

W jednej karcie, pełna szerokość:

- wiersze netto i VAT: etykieta `text-sm text-slate-500`, kwota `text-sm font-medium tabular-nums`
- pas „Do zapłaty”: `bg-primary/5`, kwota `text-3xl font-bold text-primary`
- pod spodem zdanie „Słownie: …” w `text-sm text-slate-600`

Bez zielonej kropki i bez statusu „poprawne przeliczenie”. Użytkownik ma widzieć, ile zapłacić, i jak kwota brzmi na fakturze.

---

## Sekcje opcjonalne

Pola, bez których da się wystawić dokument, siedzą w **jednej** białej karcie. Startują zwinięte, także puste konto bankowe.

- podpis pod tytułem: `text-xs text-slate-500`, np. „Nie są wymagane do wystawienia faktury”
- nagłówek akordeonu jak nagłówek sekcji: ikona w `h-7 w-7 rounded-lg bg-primary/10`, tytuł `text-sm font-semibold text-slate-900`
- otwarta treść na białym tle, `gap-4`, etykieta nad polem na pełną szerokość — tak jak karta płatności
- między akordeonami linia `border-slate-200`, nie szare pudło w środku karty
- po prawej, gdy zwinięte i coś jest ustawione: badge `rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary`
- chevron `h-4 w-4 text-slate-400`, obrót 180° gdy otwarte

Nie wkładaj accordionów w szare pudło `#E9EAED` ani karty w kartę.

---

## Nagłówek strony formularza

Tytuł strony (np. „Ręcznie — Nowa Faktura”) **przewija się razem z formularzem**. Nie przyklejaj go do góry ekranu: zasłania wtedy karty.

Pasek z przyciskami zostaje na dole. Na telefonie kończy się nad dolnym menu (`83px`). Na desktopie zaczyna się za bocznym menu (`left-64`, szerokość `w-64`).

Nie dawaj animacji wejścia strony z `transform`. Przesunięcie łapie `position: fixed` i pasek jedzie ze scrollem.

---

## Czego nie przenosić

- kapsułek `rounded-full` i szarego insetu na inputach
- pól dwa razy wyższych niż tytuł sekcji
- tekstu w polu większego niż `text-sm`
- etykiety po lewej i krótkiego pola po prawej
- dwóch kolumn „płatność obok podsumowania”
- drugiego pełnego podsumowania w stopce
- listy klientów otwartej od razu po wejściu
- przyklejonego tytułu, który przecina kartę
- koloru primary innego niż `#5856D6`
- tytułu sekcji bez ikony w kwadracie albo w stylu etykiety pola
- podpisów w `text-[10px]` i `text-[11px]`
- numeru dokumentu schowanego w polu tekstowym, skoro da się go pokazać jako wartość i edytować ołówkiem

---

## Jak poprawić kolejną stronę

1. Tło strony zostaw `#F2F2F7`. Sekcje zamień na białe karty `rounded-2xl` / `md:rounded-3xl`, `shadow-apple-sm`, `gap-3`.
2. Tytuł sekcji: ikona w kwadracie `h-7 w-7 bg-primary/10` i `text-sm font-semibold text-slate-900`. Etykieta pola zostaje `text-sm font-medium text-slate-800`, bez ikony.
3. Input, select i datę przełącz na `field-ios`, `select-pill`, `date-pill`. Etykieta nad polem, podpowiedź pod polem w `text-xs text-slate-500`.
4. Przyciski główne i drugorzędne ustaw jak w tabeli wyżej.
5. Opcje, bez których zapis się uda, zwiń w jedną kartę.
6. Nie zmieniaj przy tym logiki zapisu, walidacji ani nazw pól.
