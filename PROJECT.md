# MojeSaldoo App - Dokumentacja Projektu

## Spis Treści
1. [Przegląd Projektu](#przegląd-projektu)
2. [Docelowe Segmenty Rynku](#docelowe-segmenty-rynku)
3. [Stack Technologiczny](#stack-technologiczny)
4. [Architektura Aplikacji](#architektura-aplikacji)
5. [Moduły Aplikacji](#moduły-aplikacji)
6. [Przepływy Biznesowe](#przepływy-biznesowe)
7. [Struktura Projektu](#struktura-projektu)
8. [Modele Danych](#modele-danych)
9. [API Endpoints](#api-endpoints)
10. [Integracje](#integracje)
11. [Plan Implementacji](#plan-implementacji)

---

## Przegląd Projektu

**MojeSaldoo** to aplikacja mobilna do zarządzania sprzedażą, zamówieniami i fakturowaniem, zintegrowana z systemem KSeF (Krajowy System e-Faktur). Aplikacja umożliwia kompleksową obsługę procesów biznesowych od przyjęcia zamówienia, przez dostawę, aż po generowanie i wysyłanie faktur elektronicznych.

### Cel Aplikacji
- Zarządzanie zamówieniami i dostawami (door-to-door)
- Generowanie dokumentów sprzedażowych (WZ, MM, faktury VAT)
- Integracja z KSeF (wysyłanie i odbieranie faktur elektronicznych)
- Analityka i raportowanie sprzedaży
- Zarządzanie magazynem i stanami produktów

---

---

## Docelowe Segmenty Rynku

MojeSaldoo celuje w **małe firmy (1–10 pracowników)** z polskiego rynku MSP, które są niedoobsługiwane przez duże systemy ERP (za drogie, za skomplikowane) i przerośnięte przez proste aplikacje do fakturowania (za mało funkcji magazynowych i produkcyjnych).

### Trzy główne segmenty

---

#### Segment A — Firmy z Van Selling (handlowiec jeździ trasą)

**Kim są:** Przedstawiciel handlowy lub właściciel jeździ busem do klientów B2B (sklepy spożywcze, kawiarnie, restauracje, punkty usługowe). Towar: napoje, artykuły spożywcze, alkohole, chemia gospodarcza, artykuły biurowe. Opodatkowanie: KPiR lub ryczałt (PKD 46.x).

**Typowy dzień pracy:**
1. Rano ładuje bus z magazynu głównego (MM: MG → van)
2. Odwiedza klientów po trasie — wystawia WZ na miejscu lub na telefonie
3. Przyjmuje zwroty od klientów (ZW powiązane z WZ)
4. Wieczorem rozlicza trasę — co wróciło, co sprzedane (MM-P: van → MG, RW odpisy)
5. Raz w tygodniu lub miesiącu fakturuje klientów na podstawie WZ-ów

**Jak używa aplikacji:**
- **Produkty + Magazyny** — katalog towaru, stany w MG i w vanie osobno
- **Zamówienia** — opcjonalnie zbiera zamówienia dzień wcześniej (telefon od klienta)
- **Van Loading (MM)** — załadunek busa przed trasą, automatyczna zmiana stanu
- **WZ** — wystawia dokument wydania u klienta; drukuje lub pokazuje na telefonie
- **ZW** — rejestruje zwroty przyjęte od klientów podczas trasy
- **Rozliczenie trasy** — wieczorne podsumowanie: sprzedane / zwrócone / odpisane
- **Fakturowanie + KSeF** — faktury do WZ-ów, wysyłka elektroniczna
- **Zakupy (PZ)** — przyjęcie towaru od dostawców z KSeF inbox
- **Raporty** — sprzedaż per klient / produkt, efektywność tras, należności

**Aktywne moduły:** Produkty, Magazyny, Klienci, Zamówienia, Dostawa/WZ, Fakturowanie, KSeF, Zakupy, Raporty

**Dlaczego MojeSaldoo pasuje:** Van selling z rozliczeniem trasy, MM, ZW i WZ to core aplikacji. Aplikacja mobilna (Capacitor iOS/Android) pozwala handlowcowi pracować na telefonie bez laptopa.

---

#### Segment B — Małe Piekarnie i Cukiernie

**Kim są:** Rodzinna piekarnia lub cukiernia, 3–10 osób. Produkcja codziennie z surowców (mąka, cukier, drożdże, jajka → pieczywo, ciasta). Część sprzedaży przez własny punkt, część dostarcza do sklepów lokalnych. Opodatkowanie: KPiR lub ryczałt (PKD 10.71).

**Typowy dzień pracy:**
1. Piekarnia: produkcja wg receptur — zużycie surowców (RW) + przyjęcie wyrobów (PW)
2. Kierowca dostarcza towar do sklepów — WZ dla każdego odbiorcy
3. Sklep oddaje wczorajszy towar — ZW (zwrot)
4. Przyjęcie dostawy od dostawcy mąki/cukru — PZ z KSeF inbox
5. Cotygodniowe fakturowanie sklepów

**Jak używa aplikacji:**
- **Produkty** — katalog surowców (mąka, cukier...) i wyrobów (chleb, bułka, drożdżówka...)
- **Receptury + Produkcja** — receptura: "z 50 kg mąki → 80 bochenków", zlecenie produkcji, automatyczne RW surowców + PW wyrobów, koszt/szt. liczony z FIFO cen surowców
- **Daty ważności** — PZ przyjmuje surowce z `expiry_date`; alerty gdy zbliża się termin
- **WZ + Van** — dostawa wyrobów do sklepów, zwroty następnego dnia
- **Zakupy (PZ + KSeF inbox)** — przyjęcie faktury od dostawcy mąki → automatyczne PZ do magazynu
- **Fakturowanie + KSeF** — faktury dla sklepów, wysyłka do KSeF
- **Raporty** — koszt wytworzenia w czasie (sezonowość mąki widoczna), marża na produkcie, rotacja surowców

**Aktywne moduły:** Produkty, Magazyny, Klienci, Zamówienia, Dostawa/WZ, Produkcja, Fakturowanie, KSeF, Zakupy, Raporty

**Dlaczego MojeSaldoo pasuje:** Moduł produkcji z FIFO kosztowaniem surowców pozwala piekarni zobaczyć realny koszt wypieku — coś czego nie ma iFirma ani inFakt. Receptury są proste (jednopokotowe BOM wystarczy dla piekarni).

---

#### Segment C — Małe Firmy Produkcyjne (przetwórstwo, rzemiosło)

**Kim są:** Producent dżemów, przetworów, świec, kosmetyków naturalnych, wyrobów rzemieślniczych. 2–8 osób. Kupuje surowce, produkuje wyroby gotowe, sprzedaje B2B (sklepy, hurt) lub B2C (marketplace, targi). Opodatkowanie: KPiR, ryczałt lub pełna księgowość.

**Typowy dzień pracy:**
1. Zlecenie produkcji na podstawie zamówień od klientów
2. Zużycie surowców wg receptury (RW) + przychód wyrobów gotowych (PW)
3. Wydanie wyrobów do klientów (WZ) lub wysyłka kurierska
4. Przyjęcie faktur od dostawców surowców (PZ z KSeF inbox)
5. Adnotacje kosztowe na fakturach zakupowych → eksport do biura rachunkowego

**Jak używa aplikacji:**
- **Produkty** — dwa katalogi: surowce (słoiki, owoce, woski) i wyroby gotowe (dżem truskawkowy 250g)
- **Receptury + Produkcja** — receptura z listą składników i wydajnością partii; tryb prosty (z receptury) lub wsadu (realne zużycie np. gdy owoce różnej jakości)
- **Koszt wytworzenia** — po zamknięciu zlecenia: automatyczny koszt/szt. z FIFO cen surowców + aktualizacja `avg_cost` gotowego wyrobu → widoczna marża w raportach
- **Zakupy (PZ)** — przyjęcie surowców od dostawców, FIFO partie z cenami
- **KSeF inbox** — pobieranie faktur zakupowych, tworzenie PZ z faktury jednym kliknięciem
- **Adnotacje kosztowe** — opisanie każdej faktury zakupowej dla biura rachunkowego
- **Fakturowanie + KSeF** — faktury do klientów B2B, wysyłka elektroniczna
- **Raporty** — marża na produkcie (avg_cost vs cena sprzedaży), koszty zakupów per dostawca, P&L miesięczny

**Aktywne moduły:** Produkty, Magazyny, Klienci, Zamówienia, Dostawa/WZ, Produkcja, Fakturowanie, KSeF, Zakupy, Adnotacje kosztowe, Raporty

**Dlaczego MojeSaldoo pasuje:** Mały producent nie potrzebuje pełnego ERP — potrzebuje prostych receptur, kosztowania produkcji i połączenia z KSeF. To dokładnie to co MojeSaldoo oferuje.

---

### Tabela dopasowania modułów

| Moduł | Van Selling | Piekarnia | Producent |
|-------|:-----------:|:---------:|:---------:|
| Produkty i magazyn | ✅ | ✅ | ✅ |
| Magazyny (multi) | ✅ MG + van | ✅ MG | ✅ MG |
| Klienci | ✅ | ✅ | ✅ |
| Zamówienia | ✅ | ✅ | ✅ |
| Dostawa i WZ | ✅ core | ✅ | ✅ |
| Fakturowanie | ✅ | ✅ | ✅ |
| KSeF | ✅ | ✅ | ✅ |
| Zakupy (PZ) | ✅ | ✅ | ✅ |
| Produkcja (receptury) | ❌ | ✅ core | ✅ core |
| Adnotacje kosztowe | opcjonalnie | opcjonalnie | ✅ |
| Raporty | ✅ | ✅ | ✅ |

---

### Co jeszcze potrzebne — luki wg segmentu

#### Krytyczne (blokują pełne użycie)

| # | Luka | Segment | Stan |
|---|------|---------|------|
| 1 | **Daty ważności na PZ** — formularz `PZCreatePage` nie ma pola `expiry_date` per linia; backend ma komentarz `# expiry per line planned in future PZ extension` | Piekarnia, Producent | ✅ Naprawione |
| 2 | **FIFO `quantity_remaining` nie jest dekrementowane przy sprzedaży WZ** — `_apply_sale_return_deltas_to_stock()` koryguje `ProductStock`, ale nie chodzi po `StockBatch` i nie zmniejsza `batch.quantity_remaining`; alerty o terminach ważności mogą pokazywać sprzedany towar | Wszyscy | ✅ Naprawione |
| 3 | **Koszt wytworzenia widoczny tylko po zakończeniu zlecenia** — brak podglądu "szacowany koszt" na recepturze przed uruchomieniem produkcji | Piekarnia, Producent | ✅ Naprawione — `RecipeItemSerializer` zwraca `ingredient_avg_cost` + `ingredient_stock_total`; lista receptur pokazuje koszt/szt. i stan surowców bez osobnego zapytania o produkty |

#### Ważne (znacznie zwiększają wartość)

| # | Luka | Segment | Stan |
|---|------|---------|------|
| 4 | **Stan surowców widoczny przy tworzeniu zlecenia produkcji** — formularz nie pokazuje aktualnego stanu magazynowego składników | Piekarnia, Producent | ✅ Naprawione — `RecipeItemSerializer` zawiera `ingredient_stock_total`; formularz zlecenia czyta stock bezpośrednio z receptury (tryb prosty i wsadu), wyróżnia czerwonym gdy za mało |
| 5 | **Planowanie produkcji z zamówień** — zestawienie "co upiec jutro na podstawie otwartych zamówień" — ile szt. danego wyrobu potrzeba → jaka ilość surowców do przygotowania | Piekarnia | ✅ Naprawione — `GET /api/production/orders/planning/` zintegrowane na jednej stronie `/production/orders`: planowanie + inline formularz zlecenia + lista zleceń. Widoczne numery zamówień na każdym wierszu, badge "w produkcji" gdy zlecenie już istnieje, wiersz znika gdy niedobór pokryty |
| 6 | **Szybkie zamówienia (szablony)** — stały klient zawsze bierze te same produkty; jedno kliknięcie zamiast wybierania od zera | Van Selling | ✅ Naprawione — baner "Poprzednie zamówienie" z rozwijaną listą produktów i ilości; "Użyj" wypełnia koszyk z ostatniego zamówienia klienta; stan koszyka persystowany w `sessionStorage` (przeżywa nawigację) |
| 7 | **Indywidualne cenniki per klient** — hurtownik ma inne ceny dla sieci A vs sklepu B | Van Selling | ❌ Brakuje |
| 8 | **Powiadomienia o przeterminowanych należnościach** — klient zalega 30+ dni — alert dla właściciela | Wszyscy | ❌ Brakuje |

#### Miło mieć (wyróżniki na rynku)

| # | Luka | Segment |
|---|------|---------|
| 9 | Offline mode (Capacitor storage + sync) — handlowiec bez zasięgu | Van Selling |
| 10 | Etykiety z kodem QR/EAN do druku na wyrobach | Producent |
| 11 | Eksport raportu kosztów do PDF/Excel dla biura rachunkowego | Producent, KPiR |
| 12 | Inwentaryzacja (spis z natury) — korekta stanów po liczeniu fizycznym | Wszyscy z magazynem | ✅ Zaimplementowane |

---

### Stan FIFO — szczegółowa analiza

FIFO jest zaimplementowane i działa dla:

| Przepływ | Stan FIFO |
|----------|-----------|
| **PZ receipt** (`apply_pz_receipt`) | ✅ Tworzy `StockBatch` per linia z `received_date` i `unit_cost`; index na `expiry_date` |
| **Produkcja** (`_consume_fifo`) | ✅ Chodzi po `StockBatch` sortując `received_date, id` (najstarsza partia pierwsza); zmniejsza `batch.quantity_remaining`; liczy koszt FIFO |
| **Anulowanie PZ** (`cancel_pz`) | ✅ Odwraca po `batch_number`; uwzględnia już zużyte partie |
| **WZ sprzedaż — finalizacja** (`complete` action, `views.py`) | ✅ Wywołuje `_deduct_fifo_batches` per linia przy finalizacji WZ (naprawione) |
| **WZ sprzedaż — korekta po dostawie** (`_apply_sale_return_deltas_to_stock`) | ✅ Wywołuje `_deduct_fifo_batches` dla dodatniego `delta_sale` (naprawione) |
| **ZW zwrot towaru** (`create_zw_from_pending_returns`) | ✅ Odtwarza `StockBatch` przy zwrocie — `unit_cost` i `expiry_date` z oryginalnej linii WZ (naprawione) |
| **MM załadunek vana** (`create_van_loading_mm`) | ⚠️ Przenosi stan `ProductStock` MG → van, ale nie przenosi `StockBatch` między magazynami — partie pozostają przypisane do MG (znane ograniczenie, nie wpływa na expiry alerts dla MG) |

---

## Stack Technologiczny

### 📋 Coding Standards & Guidelines

**IMPORTANT - Code Comments & Documentation:**
- ✅ **All code comments MUST be in English** (variables, functions, comments, documentation)
- ✅ **Variable names in English** (e.g., `userName`, not `nazwaUzytkownika`)
- ✅ **Function names in English** (e.g., `createOrder`, not `stworzZamowienie`)
- ✅ **Component names in English** (e.g., `OrderList`, not `ListaZamowien`)
- ✅ **Git commits in English** (e.g., "Add user authentication", not "Dodaj uwierzytelnianie")
- ⚠️ **Exception**: UI text and user-facing content can be in Polish (displayed to users)

**Reasoning**: English code ensures better collaboration with international developers, easier maintenance, and industry standard practices. Only user-facing text (labels, messages, etc.) should be in Polish.

### Frontend
- **Framework**: React + TypeScript
- **Styling**: Tailwind CSS
- **Mobile**: Capacitor (iOS + Android)
- **State Management**: Context API / Redux (do określenia)
- **Routing**: React Router
- **Forms**: React Hook Form + Zod (walidacja)
- **UI Components**: Headless UI / Radix UI

### Backend
- **Framework**: Django + Django REST Framework
- **Język**: Python 3.11+
- **Baza Danych**: SQLite (development) → PostgreSQL (production)
- **Autentykacja**: JWT + Certificate-based (dla KSeF)
- **API**: RESTful API

### Narzędzia i Integracje
- **KSeF API**: Integracja z systemem e-faktur
- **Kryptografia**: Certyfikaty X.509, klucze asymetryczne
- **File Storage**: System plików (certyfikaty, faktury XML)

---

## Architektura Aplikacji

### Struktura Trójwarstwowa

```
┌─────────────────────────────────────┐
│       FRONTEND APP (React)          │
│   - Capacitor Mobile Wrapper        │
│   - UI Components (Tailwind)        │
│   - State Management                │
└─────────────────┬───────────────────┘
                  │ REST API (JSON)
┌─────────────────▼───────────────────┐
│       BACKEND APP (Django)          │
│   - Business Logic                  │
│   - API Endpoints (DRF)             │
│   - Authentication & Authorization  │
│   - KSeF Integration Layer          │
└─────────────────┬───────────────────┘
                  │
┌─────────────────▼───────────────────┐
│         DATABASE (SQLite)           │
│   - Users, Products, Orders         │
│   - Invoices, Documents             │
│   - Certificates, Sessions          │
└─────────────────────────────────────┘
```

### Przepływ Danych

```
User → Frontend → API Request → Backend → Database
                                    ↓
                            KSeF API (External)
                                    ↓
                            Response → Frontend → User
```

---

## Moduły Aplikacji

### 1. ONBOARDING (Moduł 1)
**Cel**: Rejestracja użytkownika i konfiguracja dostępu do KSeF

#### Funkcjonalności:
- Utworzenie konta użytkownika
- Przesłanie certyfikatu i klucza (lub generowanie)
- Konfiguracja dostępu do KSeF (token, session)
- Opcja: Skip certyfikatu na początku

#### Przepływ:
```
Create Account → Ask for Certificates →
  ├─> Upload Certificate & Key → Send to Server → Store & Encrypt
  └─> Skip for Now → Continue without KSeF
```

#### Ekrany Figma:
- Ekran główny: "Witaj Anna" (home screen)
- Formularz logowania/rejestracji

---

### 2. INITIAL TENANCY CONFIGURATION
**Cel**: Konfiguracja początkowa biznesu (produkty, klienci)

#### Funkcjonalności:
- Utworzenie katalogu produktów
- Dodanie klientów/kontrahentów
- Konfiguracja podstawowych ustawień

#### Ekrany Figma:
- a

---

### 3. USE CASE: DOOR-TO-DOOR DELIVERIES (Moduły 2-5)
**Cel**: Obsługa cyklu sprzedaży od zamówienia do dostawy

#### STAGE 1: Stock/Product Inventory (Moduł 1)
- Aktualizacja stanów magazynowych
- Decyzja: Ręczna aktualizacja vs. Upload z KSeF

#### STAGE 2: Sales Planning (Moduł 2)
- Wybór daty dostawy
- Wybór klienta
- Wybór produktów i ilości
- Opcjonalnie: Utworzenie zamówienia zbiorczego

#### STAGE 3: Delivery (Moduł 5)
- Okno planowania kierowcy
- Wydruk WZ i produktów dla każdego sklepu
- Dodanie zwrotów — edycja WZ (nagłówek i pozycje do momentu powiązania z fakturą); po powiązaniu z fakturą dokument tylko do odczytu na ekranie ze wskazaniem numeru faktury
- Zmiana statusu WZ z Draft na Saved

#### STAGE 4: Invoicing WZ (Moduł 3)
**Dokument: MM- (Przesunięcie Międzymagazynowe)**
```
Magazyn Główny MG → Magazyn Mobilny MV → Klient/KSeF
```

#### Ekrany Figma:
- Checkout zamówienia
- Załaduj Van (produkty na vanie)
- Dokumenty WZ (lista sklepów)
- Rozlicz Van

---

### 4. INVOICING (Moduły 4 & 6)
**Cel**: Generowanie i wysyłanie faktur do KSeF

#### STAGE 4: Invoicing WZ (Moduł 4)
- Generowanie dokumentu WZ dla każdego sklepu
- Wydruk i zatwierdzenie WZ

#### STAGE 6: Invoicing KSeF (Moduł 6)
- Tworzenie faktury na podstawie wprowadzonych danych
- Przegląd i edycja danych faktury
- Wysłanie faktury XML do KSeF
- Proces autoryzacji (challenge, token, session)
- Szyfrowanie faktury
- Otrzymanie numeru referencyjnego faktury

#### Przepływ KSeF:
```
Show HTML Table → Preview Invoice → Send to KSeF →
Ask Certificate Passphrase → Generate XML →
Encode XML (base64) → Send Invoice XML to Server →

[Backend Process]
Receive Certificate → Return HTTP 204 →
Encrypt using Server Asymmetric Key →
Persist Certificate Encrypted Body →
Safe Encrypted Certificate Body as File →

[KSeF Authorization Flow]
Get Challenge → Obtain Auth Token → Create Temporary Symmetric Key →
Create Session → Encrypt Invoice → Receive Ref Number →
Send Encrypted Invoice → Receive & Process Invoice →
Return Invoice Ref Number → Store Invoice XML and Metadata
```

#### Przykład danych faktury:
```json
{
  "reference_number": "202603313-KZ-ABCI2Y",
  "invoice_number": "FV/2026/MM+",
  "shop_name": "NowliwerA1",
  "total_gross": 150.00,
  "vat_rate": "8%",
  "ksef_status": "sent to KSeF",
  "sent_at": "26DWA",
  "invoice_hash": "abc123...",
  "issue_date": "2026-04-17"
}
```

#### Ekrany Figma:
- Typ dokumentu (Faktura VAT, WZ zewnętrzne, KSeF)
- Wydanie zewnętrzne (WZ)
- Dane do faktury KSeF

---

### 5. REPORTING (Moduł 7)
**Cel**: Analiza sprzedaży i statusów faktur

#### Funkcjonalności:
- Pobieranie danych faktur z serwera
- Wyświetlanie statusu faktur (statusy KSeF + UPO)
- Lista wszystkich faktur
- Szczegóły pojedynczej faktury (data, kwota, status, QR kod)

#### Przepływ:
```
Retrieve Invoice Data →
  ├─> View Invoice Status → Receive Invoice Status
  └─> Get List of Invoices → Fetch All Invoices → View List
```

#### Dane do wyświetlenia:
- Numer referencyjny
- Status faktury
- UPO (Urzędowe Poświadczenie Odbioru)
- QR kod dla faktury
- Szczegółowe informacje

---

### 6. BUSINESS ANALYTICS (Moduł 8)
**Cel**: Analiza biznesowa — ile zarabiasz, na czym, i gdzie tracisz pieniądze

#### Dane bazowe wymagające implementacji:
- `avg_cost` + `last_cost` na modelu `Product` — średni ważony koszt zakupu (aktualizowany przy każdym PZ), koszt z ostatniego zakupu
- Oznaczenie płatności faktur klientowskich (`POST /api/invoices/{id}/mark-paid/`)
- Opcjonalne śledzenie płatności faktur dostawcy (flaga `track_supplier_payments` w `CompanyWorkflowSettings`; pola `due_date`, `paid_at`, `is_paid` na `ReceivedKSeFInvoice`)

#### Kategorie raportów (aktywowane wg włączonych modułów):

**SPRZEDAŻ** — wymaga: `orders` + `invoicing`
- Przychody w czasie (miesięcznie/tygodniowo) — trend wzrostu
- Top klienci wg przychodu, liczby zamówień, średniej wartości
- Top produkty wg przychodu i ilości
- Aging należności: 0–30 / 30–60 / 60+ dni po terminie
- Wykorzystanie limitów kredytowych klientów
- Cykl zamówienie → faktura (jak szybko fakturujesz?)

**MARŻE** — wymaga: `orders` + `purchasing`
- Marża na produkcie = przychód ze sprzedaży - `avg_cost` × sprzedana ilość
- Marża na kliencie (uwzględnia rabaty i zwroty)
- Koszty zakupów w czasie (czy koszty wejściowe rosną?)
- Top dostawcy wg wartości zakupów

**DOSTAWA** — wymaga: `delivery` + opcjonalnie `van_routes`
- Skuteczność dostaw: % na czas vs `delivery_date`
- Wskaźnik zwrotów i uszkodzeń (per produkt / klient / kierowca)
- Efektywność tras vana (carry-over, rozliczenia)

**MAGAZYN** — wymaga: `warehouses`
- Rotacja towaru (dni zapasów przy bieżącym tempie sprzedaży)
- Historia ruchów (sprzedaż vs zwroty vs korekty)
- Partie bliskie terminu ważności (`StockBatch.expiry_date`)

**KOSZTY** — wymaga: `cost_allocation`
- Koszty wg projektu/centrum kosztów
- Faktury oczekujące na adnotację/eksport do księgowości
- Analiza VAT z faktur zakupowych

**WYNIK (P&L)** — wymaga: `invoicing` + `purchasing`
- Miesięczny: przychody ze sprzedaży vs koszty zakupów = wynik brutto
- Nie wymaga receptur — działa od razu dla handlowców i producentów

#### Moduł produkcji (dla firm wytwarzających produkty):
- `Recipe` + `RecipeItem` — receptury/BOM (co i ile wchodzi w skład produktu)
- `ProductionOrder` — dwa tryby: **simple** (z receptury) i **batch** (realne zużycie)
- Koszt = FIFO ceny ze StockBatch × faktycznie zużyte ilości
- Raport: koszt/szt. w czasie (widoczna sezonowość), marża netto producenta

#### Przepływ:
```
Moduł Raporty → Wybierz kategorię (Sprzedaż / Marże / Magazyn / ...) →
  Filtry: zakres dat, klient, produkt, kierowca →
  Wykres (trend) + Tabela szczegółowa →
  Eksport CSV/Excel
```

---

## Przepływy Biznesowe

### Przepływ 1: Rejestracja i Onboarding
1. Użytkownik tworzy konto
2. Dodaje certyfikat + klucz (lub pomija)
3. System zapisuje zaszyfrowane dane certyfikatu
4. Użytkownik może rozpocząć pracę

### Przepływ 2: Przyjęcie Zamówienia
1. Użytkownik wybiera datę i klienta
2. Dodaje produkty z katalogu
3. Definiuje ilości i ceny
4. System tworzy zamówienie

### Przepływ 3: Załadunek i Dostawa
1. Kierowca otwiera okno planowania
2. System generuje WZ dla każdego klienta
3. Kierowca załadowuje produkty na van
4. Dostarcza towary i opcjonalnie dodaje zwroty
5. Zmienia status WZ na "Saved"

### Przepływ 4: Fakturowanie
1. System tworzy fakturę na podstawie WZ
2. Użytkownik przegląda dane faktury
3. System generuje XML (format KSeF)
4. Użytkownik podaje hasło do certyfikatu
5. System szyfruje fakturę i wysyła do KSeF
6. Otrzymuje numer referencyjny i UPO

### Przepływ 5: Raportowanie
1. Użytkownik otwiera moduł raportów
2. Pobiera listę faktur
3. Przegląda statusy (accepted, rejected, pending)
4. Może wyświetlić szczegóły i QR kod

---

## Struktura Projektu

### Frontend (React + Capacitor)

```
mojeSaldoo-app/
├── android/                  # Capacitor Android config
├── ios/                      # Capacitor iOS config
├── public/
│   └── assets/
│       └── icons/
├── src/
│   ├── components/
│   │   ├── ui/              # Reusable UI components
│   │   │   ├── Button.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   └── Card.tsx
│   │   ├── layout/          # Layout components
│   │   │   ├── Header.tsx
│   │   │   ├── Navigation.tsx
│   │   │   └── Sidebar.tsx
│   │   └── features/        # Feature-specific components
│   │       ├── onboarding/
│   │       ├── orders/
│   │       ├── delivery/
│   │       ├── invoicing/
│   │       └── reporting/
│   ├── pages/
│   │   ├── Home.tsx
│   │   ├── Onboarding.tsx
│   │   ├── Orders.tsx
│   │   ├── OrderCheckout.tsx
│   │   ├── VanLoading.tsx
│   │   ├── DeliveryDocuments.tsx
│   │   ├── Invoicing.tsx
│   │   └── Reports.tsx
│   ├── hooks/               # Custom React hooks
│   │   ├── useAuth.ts
│   │   ├── useOrders.ts
│   │   └── useInvoices.ts
│   ├── context/             # React Context
│   │   ├── AuthContext.tsx
│   │   └── OrderContext.tsx
│   ├── services/            # API services
│   │   ├── api.ts
│   │   ├── auth.service.ts
│   │   ├── orders.service.ts
│   │   ├── invoices.service.ts
│   │   └── ksef.service.ts
│   ├── types/               # TypeScript types
│   │   ├── user.types.ts
│   │   ├── order.types.ts
│   │   └── invoice.types.ts
│   ├── utils/               # Utility functions
│   │   ├── formatters.ts
│   │   ├── validators.ts
│   │   └── constants.ts
│   ├── styles/              # Global styles
│   │   └── globals.css
│   ├── App.tsx
│   └── main.tsx
├── capacitor.config.ts
├── tailwind.config.js
├── tsconfig.json
├── vite.config.ts
└── package.json
```

### Backend (Django)

```
backend/
├── manage.py
├── requirements.txt
├── .env
├── config/                  # Django project settings
│   ├── __init__.py
│   ├── settings.py
│   ├── urls.py
│   ├── wsgi.py
│   └── asgi.py
├── apps/
│   ├── users/               # User management
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   ├── urls.py
│   │   └── admin.py
│   ├── products/            # Product catalog
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── orders/              # Order management
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── delivery/            # Delivery & WZ
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── invoicing/           # Invoice generation
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   └── urls.py
│   ├── ksef/                # KSeF integration
│   │   ├── models.py        # KSeFSession, KSeFSentInvoice, KSeFCertificate, ReceivedKSeFInvoice
│   │   ├── views.py
│   │   ├── serializers.py
│   │   ├── crypto.py        # Full KSeF crypto layer (XAdES, AES-256-CBC, RSA-OAEP, API calls)
│   │   ├── ssapi_client.py  # Public facade: loads cert from DB, calls crypto.py
│   │   ├── xml_generator.py # FA-3 KSeF XML generation
│   │   └── urls.py
│   └── reporting/           # Analytics & Reports
│       ├── models.py
│       ├── views.py
│       ├── serializers.py
│       └── urls.py
├── media/                   # Uploaded files
│   └── certificates/
├── storage/                 # Local file storage
│   ├── invoices/
│   └── documents/
└── db.sqlite3              # SQLite database
```

---

## Backend Architecture

### **Single Django Backend**

MojeSaldoo runs on a **single Django backend**. The previously separate `ssapi-multi` Bottle server has been consolidated — all KSeF crypto, session management, and invoice tracking now live directly in Django.

### **Data Flow:**
```
Frontend (React)
    ↓
Django Backend API
    ↓               ↓
MojeSaldoo DB    KSeF API (gov.pl)
```

### **KSeF Integration — How It Works**

All KSeF communication is handled inside `apps/ksef/`:

| Component | Purpose |
|-----------|---------|
| `crypto.py` | Full KSeF crypto layer: XAdES signing, AES-256-CBC encryption, RSA-OAEP key wrap, challenge/auth/session/UPO flows |
| `ssapi_client.py` | Public API used by views — loads cert from DB, delegates to `crypto.py`, persists state to Django models |
| `xml_generator.py` | Generates FA-3 KSeF XML from `Invoice` model data |
| `models.KSeFSession` | Stores KSeF access/refresh tokens per company (replaces SSAPI's `TokenManager`) |
| `models.KSeFSentInvoice` | Tracks every submitted invoice + UPO XML (replaces SSAPI's SQLite `invoices` table) |
| `models.KSeFCertificate` | Stores Fernet-encrypted private key + certificate PEM per company |

- **Frontend handles**: ONLY JWT authentication for user login
- **Frontend NEVER**: Stores/manages KSeF tokens or certificates directly

---

## MojeSaldoo Database Schema (NEW - MVP)

### **Database Design Principles:**
- **Normalized** structure for data integrity
- **Decimal fields** for financial calculations (no floats!)
- **Soft deletes** where appropriate
- **Audit trails** (created_at, updated_at)
- **Foreign keys** with proper constraints

### **Entity Relationship Diagram:**
```
User (1) ────── (*) Product
  │
  ├────── (*) Customer
  │
  ├────── (*) Order
  │             │
  │             ├────── (*) OrderItem ──→ Product
  │             │
  │             └────── (1) DeliveryDocument
  │                              │
  │                              └────── (*) DeliveryItem
  │
  └────── (*) Invoice ──→ Order
                    │
                    └──→ SSAPI (KSeF sync)
```

### **Complete Database Schema:**

```sql
-- =====================================================
-- 1. USERS & AUTHENTICATION
-- =====================================================

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    first_name VARCHAR(100) NOT NULL,
    last_name VARCHAR(100) NOT NULL,
    company_name VARCHAR(255),
    nip VARCHAR(10) UNIQUE,
    phone_number VARCHAR(20),
    is_active BOOLEAN DEFAULT TRUE,
    is_staff BOOLEAN DEFAULT FALSE,
    ksef_certificate_uploaded BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    last_login TIMESTAMP
);

CREATE INDEX idx_users_email ON users(email);
CREATE INDEX idx_users_nip ON users(nip);


-- =====================================================
-- 2. WAREHOUSES (Magazyny)
-- =====================================================

CREATE TABLE warehouses (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Warehouse details
    code VARCHAR(10) UNIQUE NOT NULL, -- 'MG', 'MV', 'SHOP1', etc.
    name VARCHAR(255) NOT NULL,
    warehouse_type VARCHAR(20) NOT NULL, -- 'main', 'mobile', 'customer', 'external'

    -- Location
    address TEXT,
    manager_name VARCHAR(100),
    contact_phone VARCHAR(20),

    -- Settings
    is_active BOOLEAN DEFAULT TRUE,
    allow_negative_stock BOOLEAN DEFAULT FALSE, -- Can stock go below 0?
    fifo_enabled BOOLEAN DEFAULT TRUE, -- First In First Out tracking

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_warehouses_user ON warehouses(user_id);
CREATE INDEX idx_warehouses_code ON warehouses(code);
CREATE INDEX idx_warehouses_type ON warehouses(warehouse_type);


-- =====================================================
-- 3. PRODUCTS (Katalog produktów)
-- =====================================================

CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    description TEXT,
    unit VARCHAR(20) NOT NULL, -- 'szt', 'kg', 'l', 'opak'
    price_net DECIMAL(10, 2) NOT NULL,
    price_gross DECIMAL(10, 2) NOT NULL,
    vat_rate DECIMAL(5, 2) NOT NULL DEFAULT 23.00,
    sku VARCHAR(50), -- Stock Keeping Unit
    barcode VARCHAR(50),

    -- Stock management
    track_batches BOOLEAN DEFAULT TRUE, -- Enable FIFO batch tracking
    min_stock_alert DECIMAL(10, 2) DEFAULT 0,
    shelf_life_days INTEGER, -- For perishable goods

    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_products_user ON products(user_id);
CREATE INDEX idx_products_sku ON products(sku);
CREATE INDEX idx_products_active ON products(is_active);


-- =====================================================
-- 4. PRODUCT STOCK (Stan produktu w magazynie)
-- =====================================================

CREATE TABLE product_stock (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,

    -- Current quantities
    quantity_available DECIMAL(10, 2) NOT NULL DEFAULT 0,
    quantity_reserved DECIMAL(10, 2) NOT NULL DEFAULT 0, -- Reserved for orders
    quantity_total DECIMAL(10, 2) NOT NULL DEFAULT 0, -- available + reserved

    -- Alerts
    last_restocked_at TIMESTAMP,
    last_count_at TIMESTAMP, -- Last physical inventory count

    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(product_id, warehouse_id)
);

CREATE INDEX idx_product_stock_product ON product_stock(product_id);
CREATE INDEX idx_product_stock_warehouse ON product_stock(warehouse_id);


-- =====================================================
-- 5. STOCK BATCHES (Partie towaru - dla FIFO)
-- =====================================================

CREATE TABLE stock_batches (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    warehouse_id UUID NOT NULL REFERENCES warehouses(id) ON DELETE CASCADE,

    -- Batch identification
    batch_number VARCHAR(50), -- Optional batch/lot number
    received_date DATE NOT NULL, -- For FIFO - oldest first
    expiry_date DATE, -- For perishable goods

    -- Quantities
    quantity_initial DECIMAL(10, 2) NOT NULL,
    quantity_remaining DECIMAL(10, 2) NOT NULL,
    quantity_reserved DECIMAL(10, 2) NOT NULL DEFAULT 0,

    -- Cost tracking (for accounting)
    unit_cost DECIMAL(10, 2), -- Purchase price per unit

    -- Status
    status VARCHAR(20) DEFAULT 'active', -- 'active', 'depleted', 'expired', 'damaged'

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_stock_batches_product ON stock_batches(product_id);
CREATE INDEX idx_stock_batches_warehouse ON stock_batches(warehouse_id);
CREATE INDEX idx_stock_batches_received ON stock_batches(received_date); -- For FIFO
CREATE INDEX idx_stock_batches_expiry ON stock_batches(expiry_date);
CREATE INDEX idx_stock_batches_status ON stock_batches(status);


-- =====================================================
-- 6. CUSTOMERS (Klienci/Sklepy)
-- =====================================================

CREATE TABLE customers (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    company_name VARCHAR(255),
    nip VARCHAR(10),
    email VARCHAR(255),
    phone VARCHAR(20),

    -- Address
    street VARCHAR(255),
    city VARCHAR(100),
    postal_code VARCHAR(10),
    country VARCHAR(2) DEFAULT 'PL',

    -- Business details
    distance_km INTEGER, -- Distance from warehouse (for delivery planning)
    delivery_days VARCHAR(50), -- e.g., "Mon, Wed, Fri"
    payment_terms INTEGER DEFAULT 14, -- Days
    credit_limit DECIMAL(10, 2) DEFAULT 0,

    -- Status
    is_active BOOLEAN DEFAULT TRUE,
    notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_customers_user ON customers(user_id);
CREATE INDEX idx_customers_nip ON customers(nip);
CREATE INDEX idx_customers_active ON customers(is_active);


-- =====================================================
-- 4. ORDERS (Zamówienia)
-- =====================================================

CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE PROTECT,

    -- Order details
    order_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., "ZAM/2026/001"
    order_date DATE NOT NULL,
    delivery_date DATE NOT NULL,

    -- Status tracking
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft', 'confirmed', 'in_preparation', 'loaded', 'in_delivery', 'delivered', 'invoiced', 'cancelled'

    -- Financial summary
    subtotal_net DECIMAL(10, 2) NOT NULL DEFAULT 0,
    subtotal_gross DECIMAL(10, 2) NOT NULL DEFAULT 0,
    discount_percent DECIMAL(5, 2) DEFAULT 0,
    discount_amount DECIMAL(10, 2) DEFAULT 0,
    total_net DECIMAL(10, 2) NOT NULL DEFAULT 0,
    total_gross DECIMAL(10, 2) NOT NULL DEFAULT 0,

    -- Notes
    customer_notes TEXT,
    internal_notes TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    confirmed_at TIMESTAMP,
    delivered_at TIMESTAMP
);

CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_customer ON orders(customer_id);
CREATE INDEX idx_orders_number ON orders(order_number);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_orders_delivery_date ON orders(delivery_date);


-- =====================================================
-- 5. ORDER ITEMS (Pozycje zamówienia)
-- =====================================================

CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE PROTECT,

    -- Product snapshot (in case product changes later)
    product_name VARCHAR(255) NOT NULL,
    product_unit VARCHAR(20) NOT NULL,

    -- Quantities
    quantity DECIMAL(10, 2) NOT NULL,
    quantity_delivered DECIMAL(10, 2) DEFAULT 0,
    quantity_returned DECIMAL(10, 2) DEFAULT 0,

    -- Pricing
    unit_price_net DECIMAL(10, 2) NOT NULL,
    unit_price_gross DECIMAL(10, 2) NOT NULL,
    vat_rate DECIMAL(5, 2) NOT NULL,
    discount_percent DECIMAL(5, 2) DEFAULT 0,

    -- Calculated totals
    line_total_net DECIMAL(10, 2) NOT NULL,
    line_total_gross DECIMAL(10, 2) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_order_items_product ON order_items(product_id);


-- =====================================================
-- 6. DELIVERY DOCUMENTS (WZ, MM)
-- =====================================================

CREATE TABLE delivery_documents (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Document details
    document_type VARCHAR(10) NOT NULL, -- 'WZ', 'MM', 'PZ'
    document_number VARCHAR(50) UNIQUE NOT NULL, -- e.g., "WZ/2026/001"
    issue_date DATE NOT NULL,

    -- Warehouse info
    from_warehouse VARCHAR(50), -- 'MG' (Magazyn Główny), 'MV' (Magazyn Vana)
    to_warehouse VARCHAR(50),   -- 'MV', 'Customer'
    to_customer_id UUID REFERENCES customers(id) ON DELETE SET NULL,

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft', 'saved', 'approved', 'in_transit', 'delivered', 'cancelled'

    -- Returns handling
    has_returns BOOLEAN DEFAULT FALSE,
    returns_notes TEXT,

    -- Signatures & confirmations
    driver_name VARCHAR(100),
    receiver_name VARCHAR(100),
    delivered_at TIMESTAMP,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_delivery_docs_order ON delivery_documents(order_id);
CREATE INDEX idx_delivery_docs_number ON delivery_documents(document_number);
CREATE INDEX idx_delivery_docs_status ON delivery_documents(status);
CREATE INDEX idx_delivery_docs_date ON delivery_documents(issue_date);


-- =====================================================
-- 7. DELIVERY ITEMS (Pozycje WZ)
-- =====================================================

CREATE TABLE delivery_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    delivery_document_id UUID NOT NULL REFERENCES delivery_documents(id) ON DELETE CASCADE,
    order_item_id UUID NOT NULL REFERENCES order_items(id) ON DELETE PROTECT,
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE PROTECT,

    -- Quantities
    quantity_planned DECIMAL(10, 2) NOT NULL,
    quantity_actual DECIMAL(10, 2), -- Actual delivered (can differ)
    quantity_returned DECIMAL(10, 2) DEFAULT 0,

    -- Return details
    return_reason VARCHAR(255),
    is_damaged BOOLEAN DEFAULT FALSE,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_delivery_items_doc ON delivery_items(delivery_document_id);
CREATE INDEX idx_delivery_items_order_item ON delivery_items(order_item_id);


-- =====================================================
-- 8. INVOICES (Faktury - tylko dane, KSeF przez SSAPI)
-- =====================================================

CREATE TABLE invoices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE PROTECT,
    customer_id UUID NOT NULL REFERENCES customers(id) ON DELETE PROTECT,

    -- Invoice details
    invoice_number VARCHAR(50) UNIQUE NOT NULL, -- "FV/2026/001"
    issue_date DATE NOT NULL,
    sale_date DATE NOT NULL,
    due_date DATE NOT NULL,
    payment_method VARCHAR(50) DEFAULT 'transfer', -- 'transfer', 'cash', 'card'

    -- Financial summary
    subtotal_net DECIMAL(10, 2) NOT NULL,
    subtotal_gross DECIMAL(10, 2) NOT NULL,
    vat_amount DECIMAL(10, 2) NOT NULL,
    total_gross DECIMAL(10, 2) NOT NULL,

    -- KSeF integration (sync with SSAPI)
    ksef_reference_number VARCHAR(100), -- From SSAPI
    ksef_number VARCHAR(100),            -- Official KSeF number
    ksef_status VARCHAR(20) DEFAULT 'not_sent',
    -- 'not_sent', 'pending', 'sent', 'accepted', 'rejected'
    ksef_sent_at TIMESTAMP,
    ksef_error_message TEXT,
    invoice_hash VARCHAR(255), -- SHA256 hash
    upo_received BOOLEAN DEFAULT FALSE,
    qr_code_url TEXT, -- For invoice verification

    -- Status
    status VARCHAR(20) NOT NULL DEFAULT 'draft',
    -- 'draft', 'issued', 'sent', 'paid', 'overdue', 'cancelled'

    paid_at TIMESTAMP,
    cancelled_at TIMESTAMP,
    cancellation_reason TEXT,

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invoices_user ON invoices(user_id);
CREATE INDEX idx_invoices_order ON invoices(order_id);
CREATE INDEX idx_invoices_customer ON invoices(customer_id);
CREATE INDEX idx_invoices_number ON invoices(invoice_number);
CREATE INDEX idx_invoices_ksef_ref ON invoices(ksef_reference_number);
CREATE INDEX idx_invoices_status ON invoices(status);
CREATE INDEX idx_invoices_ksef_status ON invoices(ksef_status);
CREATE INDEX idx_invoices_issue_date ON invoices(issue_date);


-- =====================================================
-- 9. INVOICE ITEMS (Pozycje faktury)
-- =====================================================

CREATE TABLE invoice_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
    order_item_id UUID REFERENCES order_items(id) ON DELETE SET NULL,
    product_id UUID REFERENCES products(id) ON DELETE SET NULL,

    -- Product details (snapshot)
    product_name VARCHAR(255) NOT NULL,
    product_unit VARCHAR(20) NOT NULL,
    pkwiu VARCHAR(20), -- Classification code for KSeF

    -- Quantities & pricing
    quantity DECIMAL(10, 2) NOT NULL,
    unit_price_net DECIMAL(10, 2) NOT NULL,
    vat_rate DECIMAL(5, 2) NOT NULL,

    -- Calculated totals
    line_net DECIMAL(10, 2) NOT NULL,
    line_vat DECIMAL(10, 2) NOT NULL,
    line_gross DECIMAL(10, 2) NOT NULL,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);


-- =====================================================
-- 10. STOCK MOVEMENTS (Ruchy magazynowe)
-- =====================================================

CREATE TABLE stock_movements (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

    -- Movement details
    movement_type VARCHAR(20) NOT NULL,
    -- 'purchase', 'sale', 'return', 'adjustment', 'transfer', 'damage'

    quantity DECIMAL(10, 2) NOT NULL, -- Positive or negative
    quantity_before DECIMAL(10, 2) NOT NULL,
    quantity_after DECIMAL(10, 2) NOT NULL,

    -- References
    reference_type VARCHAR(50), -- 'order', 'delivery', 'invoice', 'manual'
    reference_id UUID,

    warehouse VARCHAR(50) DEFAULT 'MG', -- 'MG', 'MV'

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    created_by UUID REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX idx_stock_movements_product ON stock_movements(product_id);
CREATE INDEX idx_stock_movements_type ON stock_movements(movement_type);
CREATE INDEX idx_stock_movements_date ON stock_movements(created_at);


-- =====================================================
-- 11. PAYMENT RECORDS (Historia płatności)
-- =====================================================

CREATE TABLE payments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_id UUID NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,

    -- Payment details
    payment_date DATE NOT NULL,
    amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    reference_number VARCHAR(100), -- Bank transfer reference

    notes TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payments_invoice ON payments(invoice_id);
CREATE INDEX idx_payments_date ON payments(payment_date);


-- =====================================================
-- 12. AUDIT LOG (Historia zmian - opcjonalnie)
-- =====================================================

CREATE TABLE audit_log (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,

    -- Action details
    action VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete'
    entity_type VARCHAR(50) NOT NULL, -- 'order', 'invoice', 'product'
    entity_id UUID NOT NULL,

    -- Changes
    old_values JSONB,
    new_values JSONB,

    ip_address VARCHAR(45),
    user_agent TEXT,

    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_audit_log_user ON audit_log(user_id);
CREATE INDEX idx_audit_log_entity ON audit_log(entity_type, entity_id);
CREATE INDEX idx_audit_log_date ON audit_log(created_at);
```

### **Database Statistics (Expected for MVP):**
- **Users**: 1-10 (single business testing)
- **Products**: 50-200 items
- **Customers**: 10-100 shops
- **Orders**: 100-1000/month
- **Invoices**: 100-1000/month
- **Total DB size**: ~50-200 MB (SQLite)

### **Migration to PostgreSQL (Later):**
Backend developer will handle:
- Convert UUID to proper UUID type
- Add proper constraints & triggers
- Optimize indexes
- Add partitioning for large tables (orders, invoices)
- Setup replication & backups

---

## Modele Danych

### 1. User
```python
class User(AbstractUser):
    phone_number = models.CharField(max_length=20, blank=True)
    company_name = models.CharField(max_length=200, blank=True)
    nip = models.CharField(max_length=10, unique=True)
    certificate_uploaded = models.BooleanField(default=False)
    ksef_enabled = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 2. Certificate
```python
class Certificate(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    certificate_file = models.FileField(upload_to='certificates/')
    key_file = models.FileField(upload_to='certificates/')
    encrypted_body = models.TextField()  # Zaszyfrowany certyfikat
    created_at = models.DateTimeField(auto_now_add=True)
    expires_at = models.DateTimeField()
```

### 3. Product
```python
class Product(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    unit = models.CharField(max_length=50)  # szt, kg, etc.
    price = models.DecimalField(max_digits=10, decimal_places=2)
    stock_quantity = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 4. Customer
```python
class Customer(models.Model):
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    name = models.CharField(max_length=200)
    address = models.TextField()
    nip = models.CharField(max_length=10, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    distance = models.IntegerField(help_text="DZ5 - distance in km")
    created_at = models.DateTimeField(auto_now_add=True)
```

### 5. Order
```python
class Order(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('confirmed', 'Confirmed'),
        ('in_delivery', 'In Delivery'),
        ('completed', 'Completed'),
        ('cancelled', 'Cancelled'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    customer = models.ForeignKey(Customer, on_delete=models.PROTECT)
    order_date = models.DateField()
    delivery_date = models.DateField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    subtotal = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=10, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 6. OrderItem
```python
class OrderItem(models.Model):
    order = models.ForeignKey(Order, related_name='items', on_delete=models.CASCADE)
    product = models.ForeignKey(Product, on_delete=models.PROTECT)
    quantity = models.DecimalField(max_digits=10, decimal_places=2)
    unit_price = models.DecimalField(max_digits=10, decimal_places=2)
    discount = models.DecimalField(max_digits=5, decimal_places=2, default=0)
    total = models.DecimalField(max_digits=10, decimal_places=2)
```

### 7. DeliveryDocument (WZ)
```python
class DeliveryDocument(models.Model):
    TYPE_CHOICES = [
        ('WZ', 'Wydanie Zewnętrzne'),
        ('MM', 'Przesunięcie Międzymagazynowe'),
    ]
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('saved', 'Saved'),
        ('approved', 'Approved'),
    ]

    order = models.ForeignKey(Order, on_delete=models.CASCADE)
    document_type = models.CharField(max_length=2, choices=TYPE_CHOICES)
    document_number = models.CharField(max_length=50, unique=True)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    from_warehouse = models.CharField(max_length=100)  # MG, MV
    to_warehouse = models.CharField(max_length=100, blank=True)
    has_returns = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 8. Invoice
```python
class Invoice(models.Model):
    STATUS_CHOICES = [
        ('draft', 'Draft'),
        ('sent', 'Sent to KSeF'),
        ('accepted', 'Accepted'),
        ('rejected', 'Rejected'),
    ]

    user = models.ForeignKey(User, on_delete=models.CASCADE)
    order = models.ForeignKey(Order, on_delete=models.PROTECT)
    invoice_number = models.CharField(max_length=50, unique=True)
    reference_number = models.CharField(max_length=100, blank=True)  # KSeF ref
    issue_date = models.DateField()
    shop_name = models.CharField(max_length=200)
    total_gross = models.DecimalField(max_digits=10, decimal_places=2)
    vat_rate = models.DecimalField(max_digits=5, decimal_places=2)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='draft')
    xml_content = models.TextField(blank=True)
    invoice_hash = models.CharField(max_length=255, blank=True)
    upo_received = models.BooleanField(default=False)
    sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 9. KSeFSession
```python
class KSeFSession(models.Model):
    company = models.OneToOneField(Company, on_delete=models.CASCADE)
    access_token_body = models.TextField(blank=True)      # KSeF access token
    refresh_token_body = models.TextField(blank=True)     # KSeF refresh token
    access_valid_until = models.DateTimeField(null=True, blank=True)
    refresh_valid_until = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

### 10. KSeFSentInvoice
```python
class KSeFSentInvoice(models.Model):
    """Tracks every invoice submitted to KSeF — replaces the old SSAPI SQLite table."""
    company = models.ForeignKey(Company, on_delete=models.CASCADE)
    reference_number = models.CharField(max_length=255, unique=True)   # KSeF ref from send
    session_reference_number = models.CharField(max_length=255)        # needed for status poll
    invoice_hash = models.CharField(max_length=255, blank=True)
    issue_date = models.CharField(max_length=20, blank=True)           # P_1 from FA-3 XML
    shop = models.CharField(max_length=255, blank=True)                # buyer name
    total_gross_cents = models.IntegerField(default=0)
    ksef_number = models.CharField(max_length=255, blank=True)         # official KSeF number
    invoice_number = models.CharField(max_length=255, blank=True)
    status_code = models.IntegerField(null=True, blank=True)
    status_description = models.TextField(blank=True)
    upo_xml = models.TextField(blank=True)                             # UPO XML stored after acceptance
    upo_hash = models.CharField(max_length=255, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
```

---

## API Endpoints

### Authentication
```
POST   /api/auth/register/          # Rejestracja
POST   /api/auth/login/             # Logowanie (JWT)
POST   /api/auth/logout/            # Wylogowanie
POST   /api/auth/upload-certificate/ # Upload certyfikatu
```

### Products
```
GET    /api/products/               # Lista produktów
POST   /api/products/               # Dodaj produkt
GET    /api/products/{id}/          # Szczegóły produktu
PUT    /api/products/{id}/          # Edycja produktu
DELETE /api/products/{id}/          # Usuń produkt
POST   /api/products/update-stock/  # Aktualizuj stan magazynowy
```

### Customers
```
GET    /api/customers/              # Lista klientów
POST   /api/customers/              # Dodaj klienta
GET    /api/customers/{id}/         # Szczegóły klienta
PUT    /api/customers/{id}/         # Edycja klienta
DELETE /api/customers/{id}/         # Usuń klienta
```

### Orders
```
GET    /api/orders/                 # Lista zamówień
POST   /api/orders/                 # Utwórz zamówienie
GET    /api/orders/{id}/            # Szczegóły zamówienia
PUT    /api/orders/{id}/            # Edycja zamówienia
DELETE /api/orders/{id}/            # Usuń zamówienie
POST   /api/orders/{id}/confirm/    # Potwierdź zamówienie
```

### Delivery
```
GET    /api/delivery/documents/     # Lista dokumentów WZ
POST   /api/delivery/documents/     # Utwórz WZ
GET    /api/delivery/documents/{id}/ # Szczegóły WZ
PUT    /api/delivery/documents/{id}/ # Edycja WZ (zwroty)
POST   /api/delivery/documents/{id}/save/ # Zapisz WZ (zmiana statusu)
```

### Invoicing
```
GET    /api/invoices/                          # Lista faktur
POST   /api/invoices/                          # Utwórz fakturę
GET    /api/invoices/{id}/                     # Szczegóły faktury
PATCH  /api/invoices/{id}/                     # Edycja faktury (draft)
DELETE /api/invoices/{id}/                     # Usuń fakturę (tylko draft)
POST   /api/invoices/{id}/issue/               # Wystaw fakturę (draft → issued)
POST   /api/invoices/{id}/mark-paid/           # Oznacz jako zapłaconą
GET    /api/invoices/{id}/preview/             # Podgląd danych faktury (JSON)
GET    /api/invoices/{id}/xml/                 # Pobierz FA-3 KSeF XML
POST   /api/invoices/{id}/send-to-ksef/        # Wyślij do KSeF (wymaga aktywnej sesji)
GET    /api/invoices/{id}/ksef-status/         # Odśwież status z KSeF (poll)
GET    /api/invoices/{id}/upo/                 # Pobierz UPO XML (po akceptacji)
POST   /api/invoices/generate-from-order/{id}/ # Generuj fakturę z zamówienia
```

### KSeF Integration
```
GET    /api/ksef/session/                   # Sprawdź status sesji KSeF
POST   /api/ksef/session/                   # Zaloguj się do KSeF (challenge → auth → tokeny)
GET    /api/ksef/inbox/                     # Lista odebranych faktur (z cache DB)
POST   /api/ksef/inbox/sync/                # Synchronizuj nowe faktury z KSeF
GET    /api/ksef/inbox/{ksefNumber}/        # Szczegóły odebranej faktury
GET    /api/ksef/inbox/{ksefNumber}/parse/  # Parsuj XML → linie do PZ
GET    /api/ksef/inbox/{ksefNumber}/download/ # Pobierz XML faktury
```

### Reporting
```
GET    /api/reports/invoices/       # Lista faktur z statusami
GET    /api/reports/sales/          # Raport sprzedaży
GET    /api/reports/inventory/      # Raport magazynowy
```

---

## Integracje

### KSeF API

#### Endpointy KSeF (sandbox):
- **Base URL**: `https://ksef-test.mf.gov.pl/api/`
- **Dokumentacja**: https://www.podatki.gov.pl/ksef/

#### Proces autoryzacji:
1. **GET** `/challenge` - Pobranie challenge
2. **POST** `/auth/token` - Autoryzacja (certyfikat + challenge)
3. **POST** `/session/init` - Inicjalizacja sesji

#### Wysyłanie faktury:
1. **POST** `/invoices/send` - Wysłanie faktury (XML + szyfrowanie)
2. **GET** `/invoices/status/{ref}` - Sprawdzenie statusu
3. **GET** `/invoices/upo/{ref}` - Pobranie UPO

#### Format XML faktury (KSeF):
```xml
<Faktura xmlns="http://crd.gov.pl/wzor/2021/11/29/11089/">
  <Naglowek>
    <KodFormularza>FA(2)</KodFormularza>
    <DataWytworzeniaFa>2026-04-17</DataWytworzeniaFa>
  </Naglowek>
  <Podmiot1>
    <NIP>1234567890</NIP>
    <Nazwa>Firma Sp. z o.o.</Nazwa>
  </Podmiot1>
  <Podmiot2>
    <NIP>0987654321</NIP>
    <Nazwa>Sklep ABC</Nazwa>
  </Podmiot2>
  <Fa>
    <FaWiersz>
      <NrWierszaFa>1</NrWierszaFa>
      <Nazwa>Kartacze</Nazwa>
      <PKWIU>10.89.19.0</PKWIU>
      <Ilosc>30</Ilosc>
      <CenaJedn>10.00</CenaJedn>
      <WartoscBrutto>300.00</WartoscBrutto>
    </FaWiersz>
  </Fa>
</Faktura>
```

---

## Plan Implementacji

### Faza 1: Setup & Infrastructure (Tydzień 1-2)
- [x] Setup projektu React + Vite + TypeScript
- [x] Konfiguracja Tailwind CSS
- [x] Setup Capacitor (iOS + Android)
- [x] Setup Django + DRF
- [x] Konfiguracja SQLite
- [x] Setup autentykacji JWT
- [ ] Struktura folderów (frontend + backend)

### Faza 2: Onboarding & Auth (Tydzień 2-3)
- [ ] Ekran rejestracji
- [ ] Ekran logowania
- [ ] Upload certyfikatu
- [ ] Szyfrowanie i zapis certyfikatu (backend)
- [ ] Protected routes (frontend)

### Faza 3: Product & Customer Management (Tydzień 3-4)
- [x] CRUD produktów
- [x] CRUD klientów
- [ ] Zarządzanie stanami magazynowymi
- [x] Lista produktów z wyszukiwaniem

### Faza 4: Order Management (Tydzień 4-5)
- [ ] Tworzenie zamówienia (wybór daty, klienta)
- [ ] Dodawanie produktów do zamówienia
- [ ] Kalkulator cen i rabatów
- [ ] Checkout zamówienia
- [ ] Lista zamówień

### Faza 5: Delivery & WZ (Tydzień 5-6)
- [ ] Okno planowania dostawy
- [ ] Generowanie WZ dla każdego klienta
- [ ] Załadunek produktów (van loading)
- [ ] Obsługa zwrotów
- [ ] Zmiana statusu WZ (Draft → Saved)

### Faza 6: Invoicing (Tydzień 6-8)
- [ ] Tworzenie faktury na podstawie WZ
- [ ] Formularz danych faktury
- [ ] Podgląd faktury (HTML)
- [ ] Generowanie XML faktury
- [ ] Integracja z KSeF API
- [ ] Proces autoryzacji (challenge, token, session)
- [ ] Szyfrowanie faktury
- [ ] Wysyłanie faktury do KSeF
- [ ] Otrzymanie numeru referencyjnego

### Faza 7: Reporting (Tydzień 8-9)
- [ ] Lista faktur z statusami
- [ ] Szczegóły faktury
- [ ] Pobieranie UPO z KSeF
- [ ] Generowanie QR kodu
- [ ] Raporty sprzedażowe

### Faza 10: Business Analytics

#### Krok 1: Dane bazowe (backend)
- [x] Dodaj `avg_cost`, `last_cost`, `avg_cost_updated_at` do modelu `Product`
- [x] Aktualizuj `avg_cost` w `apply_pz_receipt()` — ważona średnia po każdym przyjęciu
- [x] Dodaj endpoint `POST /api/invoices/{id}/mark-paid/` — oznaczenie faktury jako zapłaconej
- [x] Dodaj `track_supplier_payments` do `CompanyWorkflowSettings` (opcjonalne)
- [x] Dodaj `due_date`, `paid_at`, `is_paid` do `ReceivedKSeFInvoice` (gdy flaga włączona)

#### Krok 2: Raporty backend
- [x] `GET /api/reports/profit-loss/` — P&L miesięczny (przychody vs koszty zakupów)
- [x] `GET /api/reports/product-margin/` — marża per produkt (sprzedaż - avg_cost)
- [x] `GET /api/reports/payment-aging/` — aging należności (0–30 / 30–60 / 60+ dni)
- [x] `GET /api/reports/supplier-costs/` — koszty zakupów per dostawca / miesiąc

#### Krok 3: Frontend
- [x] Przycisk "Oznacz jako zapłacono" na szczegółach faktury klientowskiej
- [x] Strona raportu P&L (wykres słupkowy miesięczny)
- [x] Strona marży na produktach (tabela: produkt / avg_cost / cena sprzedaży / marża %)
- [x] Strona aging należności
- [x] Strona koszty zakupów per dostawca
- [x] Eksport CSV (aging należności + koszty zakupów)

#### Krok 4: Moduł produkcji (firmy wytwarzające)
- [x] Model `Recipe` + `RecipeItem` — receptury/BOM (składniki na partię)
- [x] Model `ProductionOrder` — zlecenie produkcyjne, dwa tryby:
  - **Tryb prosty** (`mode=simple`): użytkownik podaje tylko ilość gotowego wyrobu → system oblicza zużycie z receptury × FIFO
  - **Tryb wsadu** (`mode=batch`): użytkownik podaje realne zużycie surowców → system liczy koszt z faktycznego wsadu (wlicza odpady automatycznie)
- [x] Model `ProductionOrderInput` — realne wejście surowców (tylko tryb wsadu)
- [x] Przy zamknięciu zlecenia: automatyczne RW (zużycie składników) + PW (przyjęcie wyrobów) + aktualizacja `Product.avg_cost` gotowego wyrobu
- [x] FIFO pricing: koszt liczy się po cenach z `StockBatch.unit_cost` (od najstarszej partii)
- [x] Raport rentowności produkcji: koszt/szt. w czasie (sezonowość kosztów widoczna od razu)
- [x] **Szacowany koszt na recepturze** — `RecipeItemSerializer` zwraca `ingredient_avg_cost` + `ingredient_stock_total`; lista receptur pokazuje koszt/szt. i stan surowca bez osobnego zapytania
- [x] **Stan surowców przy tworzeniu zlecenia** — formularz zlecenia czyta `ingredient_stock_total` z receptury (zarówno tryb prosty jak i wsad); oznacza czerwonym gdy niewystarczający
- [x] **Planowanie produkcji z zamówień** — `GET /api/production/orders/planning/`; zintegrowane na stronie `/production/orders` (jedna strona: planowanie + inline formularz + lista zleceń):
  - numery zamówień ZAM/... widoczne bezpośrednio na wierszu planowania
  - badge "w produkcji: X szt" gdy istnieje szkic zlecenia dla danej receptury (niebieski = pokrywa niedobór, pomarańczowy = częściowe)
  - wiersz planowania znika gdy niedobór w pełni pokryty przez istniejące zlecenia
  - formularz zlecenia z planu: receptura zablokowana, ilość prefillowana z niedoboru, notatki auto-uzupełniane numerami zamówień
  - zmiana surowców w trybie wsadu: dropdown na każdym wierszu, dodawanie/usuwanie składników, stan magazynowy widoczny dla wszystkich (z receptury lub z `product.stock_total`)
- [x] **Szybkie zamówienia z poprzedniego zamówienia** — baner na stronie nowego zamówienia po wyborze klienta; rozwijana lista produktów/ilości; "Użyj" kopiuje pozycje do koszyka; stan koszyka + klient + data persystowane w `sessionStorage`

### Faza 8: Mobile & Testing (Tydzień 9-10)
- [ ] Testowanie na iOS
- [ ] Testowanie na Android
- [ ] Optymalizacja UI mobilnego
- [ ] Obsługa offline (opcjonalnie)
- [ ] Testy jednostkowe (backend)
- [ ] Testy E2E (frontend)

### Faza 9: Deployment (Tydzień 10-11)
- [ ] Migracja na PostgreSQL
- [ ] Deploy backendu (Railway, Heroku, VPS)
- [ ] Build mobilny (App Store + Google Play)
- [ ] Dokumentacja użytkownika
- [ ] Przekazanie projektu backendowcowi

---

## Notatki Techniczne

### Bezpieczeństwo
- **Certyfikaty**: Przechowywanie zaszyfrowane w bazie + filesystem
- **Hasła**: Hasło do certyfikatu nigdy nie jest zapisywane, tylko używane runtime
- **API**: HTTPS only, JWT tokens z expiracją
- **KSeF**: Wszystkie zapytania przez backend (nie bezpośrednio z frontu)

### Performance
- Lazy loading komponentów (React.lazy)
- Paginacja list (produkty, zamówienia, faktury)
- Caching API responses (React Query lub SWR)
- Optymalizacja obrazów (Capacitor Asset optimization)

### Możliwości rozwoju (przyszłość)
- [ ] Korekty do faktur i PZ i Wz
- [ ] Synchronizacja offline
- [ ] Powiadomienia push (statusy KSeF)
- [ ] Eksport raportów do PDF/Excel
- [ ] Możliwośc zrobienia backup dokumentów na dysk
- [ ] Integracja z drukarkami fiskalny
- [ ] Multi-tenancy (wiele firm na jednym koncie)
- [ ] OCR do skanowania dokumentów
- [ ] API webhooks (powiadomienia o statusach)

### KSeF Inbox — TODO
- [x] **KSeF product mapping** (`KSeFProductMapping` model: seller_nip + invoice_line_name → internal Product).
  Allows auto-matching invoice lines to warehouse products on repeated imports from the same supplier.
  When a user manually picks a product for an invoice line, remember the mapping for next time.
- [x] **PZ from KSeF invoice** — create a goods receipt directly from a received KSeF invoice:
  - [x] Backend: `GET /api/ksef/inbox/{ksefNumber}/parse/` — downloads XML, parses `FaWiersz` lines,
    auto-matches products by name, tries to match supplier by NIP.
  - [x] Frontend: `KSeFInboxPZPage` (`/ksef/inbox/:ksefNumber/pz`) — shows invoice header, supplier info,
    warehouse picker, per-line product selector with inline quick-create, editable qty/unit_cost,
    split lines for multi-warehouse, partial acceptance tracking, submits to `POST /api/delivery/create-pz/`.
  - [x] Auto-creates or patches supplier from invoice data on PZ creation.
  - [x] "Utwórz PZ" button per row in KSeF Inbox list.
- [x] **KSeF Inbox DB cache** — all downloaded invoices saved to `ReceivedKSeFInvoice`; never re-downloaded.
  - [x] Inbox page loads instantly from DB; explicit "Synchronizuj z KSeF" button fetches new ones.
  - [x] XML stored in `xml_content`; line items cached in `ReceivedKSeFInvoiceLine` — expand is instant after first load, no session needed.
  - [x] Seller address fields (`seller_address_l1/l2`, `seller_country`) stored in DB from parsed XML.
- [ ] **KSeF correction invoice (faktura korygująca) → PZ-KOR guided flow**
  - Blocked on: receiving a real correction invoice via KSeF to verify data format (`TypFaktury`, `FakturaRef/NrKSeF`).
  - Desired flow: correction invoice in inbox → "Utwórz PZ-KOR" button → auto-finds original PZ via referenced invoice → pre-fills PZ-KOR form → creates PZ-KOR linked to correction invoice.
  - Backend needs: parse `TypFaktury` (KOR vs VAT) and `FakturaRef` (original invoice KSeF number) from XML.
  - Frontend needs: detect correction invoices in inbox, extend `MatchPzPanel` to also show `PZ-KOR` documents, or add dedicated guided flow.

---

## Kontakt i Wsparcie

### Zespół
- **Frontend Developer**: [Twoje Imię]
- **Backend Developer**: [Backend Developer]

### Dokumentacja KSeF
- https://www.podatki.gov.pl/ksef/
- https://www.gov.pl/web/kas/krajowy-system-e-faktur

### Helpdesk
- Email: support@mojesaldoo.pl
- Slack: #mojesaldoo-dev

---

**Ostatnia aktualizacja**: 2026-06-20
**Wersja dokumentu**: 1.0
