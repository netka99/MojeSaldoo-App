# Frontend — Design System & Conventions

Aktualny wygląd pól, selectów, przycisków i kart jest w **`design.md`** w katalogu głównym repozytorium. Przy rozbieżności wygrywa `design.md`. Ten plik zostaje jako skrót dla pracy we `frontend/`.

## Filozofia UI: iOS Settings style

Jasne tło strony, białe karty z cieniem, etykieta nad polem. Użytkownik często ma 50+ lat i pracuje na telefonie. Tekst pól to `text-sm`, jak reszta interfejsu. 44 px to wysokość wiersza listy, nie wysokość pola.

---

## Tło strony

```css
--background: 240 11% 96%;   /* #F2F2F7 — dokładnie iOS light mode */
```

Zdefiniowane w `src/index.css` (`:root`) i `tailwind.config.js` (`surface`).
Nie zmieniaj tła na `bg-white` ani `bg-slate-50` na poziomie strony.

---

## Karty (kontenery sekcji)

```tsx
<section className="rounded-2xl border border-slate-200 bg-white shadow-apple-sm md:rounded-3xl">
```

- **Tło:** `bg-white`
- **Border:** `border-slate-200` — widoczna linia oddzielająca od tła strony
- **Cień:** `shadow-apple-sm` (zdefiniowany w `src/index.css`)
- **Zaokrąglenie:** `rounded-2xl` mobile, `rounded-3xl` desktop
- **Gap między kartami:** `gap-3` (nie `gap-5` — zbyt luźne)

### Cienie kart (src/index.css)
```css
.shadow-apple-sm    { box-shadow: 0 1px 3px rgba(0,0,0,0.08), 0 4px 12px rgba(0,0,0,0.10); }
.shadow-apple-md    { box-shadow: 0 2px 6px rgba(0,0,0,0.10), 0 8px 24px rgba(0,0,0,0.14); }
.shadow-apple-float { box-shadow: 0 4px 12px rgba(0,0,0,0.12), 0 16px 48px rgba(0,0,0,0.18); }
```

---

## Nagłówki sekcji wewnątrz kart

Ikona w kwadracie `h-7 w-7 rounded-lg bg-primary/10 text-primary` plus tytuł `text-sm font-semibold text-slate-900`.

Nie używaj `text-[11px] uppercase tracking-wider` ani samego szarego tytułu bez ikony.

---

## Wiersze w kartach (iOS list rows)

```tsx
<div className="divide-y divide-slate-100">
  <div className="flex items-center justify-between gap-3 px-4 py-2.5 md:px-6">
    <div>
      <p className="text-sm font-medium text-slate-800">Etykieta</p>
      <p className="text-xs text-slate-400">Podpis opcjonalny</p>
    </div>
    <div className="relative shrink-0">
      {/* kontrolka po prawej */}
    </div>
  </div>
</div>
```

- **Padding wiersza:** `py-2.5` (kompaktowy, min. 44px przez font+padding)
- **Separator:** `divide-y divide-slate-100` wewnątrz karty
- **Etykieta:** `text-sm font-medium text-slate-800`
- **Podpis:** `text-xs text-slate-400` (bezpośrednio pod etykietą, bez `mt-0.5`)

---

## Ujednolicony system kontrolek

Szczegóły i przykłady: `design.md` w katalogu głównym. Skrót:

- klasy: `field-ios`, `field-ios-tall`, `field-ios-sm`, `select-pill`, `date-pill` w `src/index.css`
- kształt: `rounded-lg`, wysokość ok. 36 px (`py-2 text-sm leading-5`)
- tło `#F2F2F7`, ramka `#AEAEB2`, tekst `text-slate-900`, placeholder `text-slate-500`
- focus: białe tło, ramka `primary`, `ring-2 ring-primary/30`
- etykieta nad polem: `mb-1.5 text-sm font-medium text-slate-800`
- `select-pill` i `date-pill` to pola, nie kapsułki. Nie wracaj do `rounded-full`

Nie używaj na polach `rounded-full`, cienia inset, `min-h-11`, tekstu 17 px, `bg-slate-50` ani `border-slate-200`.

---

## Accordeony wewnątrz kart

```tsx
<div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-apple-sm">
  <button className="flex w-full items-center justify-between px-4 py-3.5 text-left hover:bg-slate-50/60">
    <div className="flex items-center gap-2">
      <span className="text-sm font-medium text-slate-700">Tytuł</span>
      {hasValue && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">ustawione</span>}
    </div>
    <svg ...chevron className={cn('h-4 w-4 shrink-0 text-slate-400 transition-transform', open && 'rotate-180')} />
  </button>
  {open && (
    <div className="divide-y divide-slate-200 border-t border-slate-200">
      ...
    </div>
  )}
</div>
```

- Tytuł accordeonu: ikona w kwadracie `bg-primary/10` + `text-sm font-semibold text-slate-900` (jak tytuł sekcji)
- Badge stanu: `rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary`
- Separator po otwarciu: `border-t border-slate-200` + `divide-y divide-slate-200`
- Hover: `hover:bg-slate-50/60`

---

## Grupowanie accordeonów (Dodatkowe opcje)

Jedna biała karta, `divide-y divide-slate-100`. Wszystkie wiersze startują zwinięte. Badge stanu po prawej, tylko gdy coś jest ustawione.

Nie wkładaj ich w szare pudło `bg-[#E9EAED]` ani w kartę w karcie.

---

## Typografia

| Zastosowanie | Klasy |
|---|---|
| Tytuł strony | `text-base font-bold text-slate-900 md:text-xl` |
| Tytuł sekcji i akordeonu | ikona `h-7 w-7 rounded-lg bg-primary/10` + `text-sm font-semibold text-slate-900` |
| Podtytuł sekcji i podpowiedź pod polem | `text-xs text-slate-500` |
| Etykieta pola | `mb-1.5 text-sm font-medium text-slate-800`, bez ikony |
| Ważna wartość (numer faktury) | `text-base font-semibold text-primary` na `bg-primary/10` |
| Badge/tag | `text-xs font-semibold text-primary` |

**Nigdy nie używaj:**
- `text-[11px] uppercase tracking-wide` dla etykiet wierszy
- `text-xs text-muted-foreground uppercase` dla nagłówków accordeonów
- `font-bold` dla nagłówków sekcji wewnątrz kart

---

## Kolory primary

```
primary: #5856D6  (indigo)
primary/10: tło ikon sekcji i badge'y
primary/30: focus ring pól
```

---

## Przyciski akcji

### Główny CTA
```tsx
<button className="rounded-2xl bg-primary px-5 py-2.5 text-sm font-semibold text-white">
```

### Drugorzędny
```tsx
<button className="rounded-2xl border border-primary/50 px-4 py-2.5 text-sm font-semibold text-primary">
```

### Link-style
```tsx
<button className="text-sm font-medium text-primary hover:underline">
```
