# MojeSaldoo — Analiza Procesu Order → Delivery → Invoice
*Wygenerowano: 2026-05-29 | Porównanie z systemami klasy Comarch ERP XL / WF-Mag / Subiekt GT*

---

## ARCHITEKTURA MODUŁOWOŚCI (decyzja 2026-05-29)

### Stan obecny systemu modułów

Infrastruktura `CompanyModule` **istnieje** ale jest **dekoracyjna** — flagi `is_enabled` są zapisywane w bazie ale żaden widok ich nie sprawdza. Każda firma może wywołać każdy endpoint niezależnie od ustawień modułów.

**Finalna lista 11 modułów (zaktualizowana w `backend/apps/users/models.py`):**

```python
# Rdzeń — dla firm handlowych zazwyczaj zawsze włączony
"products"    → katalog produktów, stany magazynowe
"customers"   → baza klientów
"warehouses"  → magazyny, stany, ruchy
"orders"      → zamówienia od klientów
"delivery"    → WZ (wydania) + ZW (zwroty)
"invoicing"   → faktury FV

# Opcjonalne — zależnie od modelu biznesowego
"van_routes"  → trasy vana, MM załadunek, rozliczenie trasy
"purchasing"  → zakupy od dostawców, PZ, model Supplier
"production"  → własna produkcja (PW/RW) — workflow planowany, flaga już teraz

# Integracje
"ksef"        → e-fakturowanie KSeF
"reporting"   → raporty i analityka
```

**Dlaczego 11 i nie więcej:**
- Moduł = cały obszar biznesowy którego dany typ firmy **w ogóle nie używa**
- Cechy wewnątrz obszaru (FIFO, limity kredytowe, daty ważności) = opcje per produkt/klient, nie moduły
- Granularność większa niż 11 = over-engineering dla MVP SaaS

### Profile firm i które moduły włączają

| Typ firmy | products | warehouses | orders | delivery | invoicing | van_routes | purchasing | production | ksef |
|-----------|:--------:|:----------:|:------:|:--------:|:---------:|:----------:|:----------:|:----------:|:----:|
| **Producent jedzenia** (własna produkcja → WZ do klientów) | ✅ | ✅ | ✅ | ✅ | ✅ | ❓ | ❌ | ✅ | ❓ |
| **Dystrybutor z vanem** (kupuje PZ → sprzedaje z vana) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ❓ |
| **Hurtownia/sklep** (kupuje PZ → sprzedaje z magazynu) | ✅ | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ | ❌ | ❓ |
| **Firma usługowa** (brak towaru fizycznego) | ❌ | ❌ | ✅ | ❌ | ✅ | ❌ | ❌ | ❌ | ❓ |

`❓` = opcjonalne (firma decyduje), `❌` = wyłączone, `✅` = włączone

**Uwaga `production`:** Workflow PW/RW jeszcze nie zaimplementowany. Flaga `production` istnieje już teraz żeby producent mógł mieć profil `production=ON, purchasing=OFF` — implementacja workflow przyjdzie w kolejnym MVP bez zmiany architektury modułów.

### Co oznacza wyłączenie modułu

| Moduł | Gdy wyłączony: Backend | Gdy wyłączony: Frontend |
|-------|----------------------|------------------------|
| `van_routes` | `/api/van-routes/` zwraca HTTP 403 | Brak "Trasy" w nawigacji, brak MM-loading flow |
| `purchasing` | `/api/suppliers/` i `/api/delivery/create-pz/` zwracają HTTP 403 | Brak "Dostawcy" w nawigacji, brak przycisku "Nowe PZ" |
| `delivery` | `/api/delivery/` zwraca HTTP 403 | Brak "Dostawy" w nawigacji |
| `invoicing` | `/api/invoices/` zwraca HTTP 403 | Brak "Faktury" w nawigacji |
| `warehouses` | `/api/warehouses/` zwraca HTTP 403 | Brak "Magazyny" |
| `ksef` | Akcje KSeF zablokowane | Brak przycisku "Wyślij do KSeF" |

### Plan egzekwowania modułów (co zaimplementować)

**Krok M1 — Dodaj brakujące klucze do MODULE_CHOICES:**

W `backend/apps/users/models.py`:
```python
MODULE_CHOICES = [
    ("products",    "Products & Inventory"),
    ("customers",   "Customers"),
    ("warehouses",  "Warehouse Management"),
    ("orders",      "Orders"),
    ("delivery",    "Delivery & WZ Documents"),
    ("invoicing",   "Invoicing"),
    ("ksef",        "KSeF Integration"),
    ("reporting",   "Reporting & Analytics"),
    ("van_routes",  "Van Routes & Mobile Delivery"),   # NOWE
    ("purchasing",  "Purchasing & Suppliers (PZ)"),    # NOWE
]
```
Następnie: `python manage.py makemigrations users && python manage.py migrate`

**Krok M2 — Permission class `ModuleRequired`:**

Utwórz `backend/apps/users/permissions.py` (lub dodaj do istniejącego):
```python
from rest_framework.permissions import BasePermission
from .models import CompanyModule


def company_has_module(company, module_key: str) -> bool:
    """Sprawdza czy firma ma włączony dany moduł."""
    return CompanyModule.objects.filter(
        company=company,
        module=module_key,
        is_enabled=True,
    ).exists()


class ModuleRequired(BasePermission):
    """
    Użycie w ViewSet:
        module_required = 'van_routes'
        permission_classes = [IsAuthenticated, ModuleRequired]

    Zwraca HTTP 403 jeśli firma nie ma włączonego modułu.
    """
    message = "Ten moduł nie jest aktywny dla Twojej firmy."

    def has_permission(self, request, view):
        module_key = getattr(view, 'module_required', None)
        if not module_key:
            return True  # ViewSet nie wymaga modułu — przepuść
        company = getattr(request.user, 'current_company', None)
        if not company:
            return False
        return company_has_module(company, module_key)
```

**Krok M3 — Przypisz moduły do ViewSetów:**

```python
# backend/apps/van_routes/views.py
class VanRouteViewSet(viewsets.ModelViewSet):
    module_required = 'van_routes'
    permission_classes = [IsAuthenticated, ModuleRequired]
    # ... reszta bez zmian

# backend/apps/suppliers/views.py (nowy)
class SupplierViewSet(viewsets.ModelViewSet):
    module_required = 'purchasing'
    permission_classes = [IsAuthenticated, ModuleRequired]

# backend/apps/delivery/views.py — akcja create-pz
# W metodzie create_pz() dodaj na początku:
if not company_has_module(company, 'purchasing'):
    return Response(
        {'detail': 'Moduł zakupów (PZ) nie jest aktywny dla tej firmy.'},
        status=status.HTTP_403_FORBIDDEN
    )

# backend/apps/invoices/views.py
class InvoiceViewSet(viewsets.ModelViewSet):
    module_required = 'invoicing'
    permission_classes = [IsAuthenticated, ModuleRequired]
```

**Krok M4 — Frontend: hook `useModules()` + ukrywanie nawigacji:**

```typescript
// frontend/src/query/use-modules.ts
export const useModules = () => {
  return useQuery({
    queryKey: ['company-modules'],
    queryFn: () => companyService.getModules(),  // GET /api/companies/{id}/modules/
  });
};

// Pomocniczy hook:
export const useHasModule = (moduleKey: string): boolean => {
  const { data: modules } = useModules();
  return modules?.find(m => m.module === moduleKey)?.is_enabled ?? false;
};
```

```tsx
// frontend/src/components/layout/Sidebar.tsx lub Navigation.tsx
const hasVanRoutes = useHasModule('van_routes');
const hasPurchasing = useHasModule('purchasing');
const hasInvoicing = useHasModule('invoicing');

// W nawigacji:
{hasVanRoutes && <NavLink to="/van-routes">Trasy Van</NavLink>}
{hasPurchasing && <NavLink to="/suppliers">Dostawcy</NavLink>}
{hasPurchasing && <NavLink to="/delivery/pz/new">Nowe PZ</NavLink>}
{hasInvoicing && <NavLink to="/invoices">Faktury</NavLink>}
```

**Krok M5 — Seeding modułów przy tworzeniu firmy:**

Funkcja `_ensure_company_modules()` już istnieje w `backend/apps/users/views.py` i jest wywoływana przy listowaniu modułów. Sprawdź czy jest też wywoływana przy TWORZENIU firmy:
```python
# W widoku tworzenia firmy (CompanyCreateView lub rejestracja):
company = Company.objects.create(...)
_ensure_company_modules(company)
# Lub od razu włącz podstawowe moduły dla nowej firmy:
for key in ['products', 'customers', 'orders', 'delivery', 'invoicing']:
    CompanyModule.objects.filter(company=company, module=key).update(is_enabled=True)
```

### Matryca zależności między modułami

Niektóre moduły wymagają innych:

```
purchasing   → wymaga: products, warehouses
van_routes   → wymaga: delivery, products, warehouses
delivery     → wymaga: products, warehouses
invoicing    → wymaga: orders, customers
orders       → wymaga: products, customers
ksef         → wymaga: invoicing
```

Gdy użytkownik próbuje włączyć `van_routes` a `delivery` jest wyłączone — system powinien ostrzec lub włączyć automatycznie.

---

## ZAKRES MVP (decyzja 2026-05-29)

Dokumenty w zakresie bieżącego MVP:

| Symbol | Nazwa | Stan |
|--------|-------|------|
| **PZ** | Przyjęcie Zewnętrzne | ❌ Wymaga pełnej implementacji |
| **WZ** | Wydanie Zewnętrzne | ✅ Zaimplementowane |
| **ZW** | Zwrot | ⚠️ Częściowe — wymaga naprawy cofnięcia stanu |
| **MM** | Przesunięcie Magazynowe | ✅ Zaimplementowane |
| **FV** | Faktura VAT | ✅ Zaimplementowane |

Dokumenty odłożone do kolejnych MVP (nie implementujemy teraz):

| Symbol | Nazwa | Powód odłożenia |
|--------|-------|-----------------|
| FV-KOR | Faktura Korygująca | Wymaga FV-KOR flow, KSeF corrections — osobny sprint |
| RW | Rozchód Wewnętrzny | Potrzebny dopiero przy zużyciu wewnętrznym |
| PW | Przychód Wewnętrzny | Dopiero przy produkcji własnej |
| LW | Likwidacja Wewnętrzna | Tymczasowo przez DAMAGE w reconciliation |
| INW | Inwentaryzacja | Duże zadanie — osobny sprint |
| ZD | Zamówienie do Dostawcy | Dopiero gdy moduł zakupów |
| PRO | Proforma | Dopiero gdy B2B z zaliczkami |
| PZO | Protokół Zdawczo-Odbiorczy | Dopiero gdy wymagane przez klientów |

---

## SPIS TREŚCI

1. [Mapa obecnego systemu](#1-mapa-obecnego-systemu)
2. [Istniejące dokumenty i ich przepływ](#2-istniejące-dokumenty-i-ich-przepływ)
3. [Brakujące dokumenty magazynowe](#3-brakujące-dokumenty-magazynowe)
4. [Krytyczne dziury w kontroli stanu magazynowego](#4-krytyczne-dziury-w-kontroli-stanu-magazynowego)
5. [Dziury w przepływie zamówień](#5-dziury-w-przepływie-zamówień)
6. [Dziury w fakturowaniu](#6-dziury-w-fakturowaniu)
7. [Dziury UI i widoczność](#7-dziury-ui-i-widoczność)
8. [Model docelowy — jak powinno wyglądać](#8-model-docelowy--jak-powinno-wyglądać)
9. [Priorytety napraw i rozbudowy](#9-priorytety-napraw-i-rozbudowy)
10. [Szczegółowy plan implementacji per priorytet](#10-szczegółowy-plan-implementacji-per-priorytet)
11. [PLAN DZIAŁANIA — Szczegółowe zadania dla LLM](#11-plan-działania--szczegółowe-zadania-dla-llm)

---

## 1. MAPA OBECNEGO SYSTEMU

### Przepływ główny

```
[ZAMÓWIENIE — ZAM]
    draft → confirmed → in_preparation → loaded → in_delivery → delivered → invoiced → cancelled
    │
    │ confirm()
    │  └─ Waliduje stock w głównym magazynie
    │  └─ quantity_available → quantity_reserved (ProductStock)
    │  └─ Tworzy StockMovement(RESERVATION)
    │
    ▼
[WZ — Wydanie Zewnętrzne]  ← generowane z zamówienia
    draft → saved → in_transit → delivered → cancelled
    │
    │ complete()
    │  └─ quantity_actual per line (ile faktycznie wydano)
    │  └─ quantity_returned per line (ile wróciło)
    │  └─ Aktualizuje OrderItem.quantity_delivered
    │  └─ Tworzy StockMovement(SALE)
    │
    ▼
[ZW — Zwrot]  ← tworzony z return items przy complete WZ
    draft → saved → delivered

[MM — Przesunięcie Magazynowe]  ← van loading
    główny magazyn → van (MOBILE warehouse)
    └─ Tworzy StockMovement(TRANSFER)

[VanRoute]
    PLANNED → LOADING → IN_PROGRESS → SETTLING → CLOSED
    └─ start_loading() tworzy MM
    └─ close() po reconciliation

[FV — Faktura VAT]  ← generowana z zamówienia lub WZ
    draft → issued → sent → paid | overdue | cancelled
    └─ billable_quantity = quantity_delivered if > 0 else ordered
    └─ due_date = issue_date + customer.payment_terms
    └─ Blokuje WZ: is_locked_by_invoice() = True
```

### Stany magazynowe (ProductStock per warehouse)

```
quantity_available   — gotowe do alokacji
quantity_reserved    — zarezerwowane przez potwierdzone zamówienia
quantity_total       — available + reserved (computed)
```

### Ruchy magazynowe (StockMovement.movement_type)

```
PURCHASE       — przyjęcie towaru (używane przy adjust_stock)
SALE           — rozchód przy dostawie
RETURN         — zwrot
ADJUSTMENT     — ręczna korekta
TRANSFER       — przesunięcie MM
DAMAGE         — uszkodzenie / likwidacja
RESERVATION    — blokada przy potwierdzeniu zamówienia
UNRESERVATION  — zwolnienie blokady przy anulowaniu
```

---

## 2. ISTNIEJĄCE DOKUMENTY I ICH PRZEPŁYW

| Symbol | Nazwa | Model | Status workflow | Numer | Uwagi |
|--------|-------|-------|-----------------|-------|-------|
| **ZAM** | Zamówienie | Order | ✅ Pełny | ZAM/2026/0001 | 8 statusów, changelog |
| **WZ** | Wydanie Zewnętrzne | DeliveryDocument | ✅ Pełny | WZ/2026/0001 | 5 statusów |
| **MM** | Przesunięcie Magazynowe | DeliveryDocument | ✅ Działa | MM/2026/0001 | główny → van |
| **ZW** | Zwrot | DeliveryDocument | ⚠️ Częściowy | ZW/2026/0001 | brak FV-KOR |
| **PZ** | Przyjęcie Zewnętrzne | DeliveryDocument (typ) | ❌ Brak workflow | PZ/2026/0001 | typ zdefiniowany, logika = 0 |
| **FV** | Faktura VAT | Invoice | ✅ Pełny | FV/2026/0001 | KSeF fields gotowe |

---

## 3. BRAKUJĄCE DOKUMENTY MAGAZYNOWE

### 3.1 PZ — Przyjęcie Zewnętrzne (KRYTYCZNE)

**Co to jest:** Dokument potwierdzający przyjęcie towaru od dostawcy do magazynu.

**Obecny stan:** `document_type = 'PZ'` istnieje w modelu DeliveryDocument ale nie ma:
- Żadnego workflow (view action, serializer)
- Powiązania z dostawcą (brak modelu Supplier)
- Ceny zakupu na linii (brak `unit_cost` na DeliveryItem)
- Automatycznego zwiększenia stanu po "deliver" dokumentu

**Konsekwencja:** Każde wejście towaru to ręczna korekta `adjust_stock` bez źródła, dostawcy ani ceny zakupu. Nie można odtworzyć historii skąd pochodzi towar.

**Wymagane zmiany:**
```
Backend:
- Model: Supplier (nazwa, NIP, adres, kontakt)
- DeliveryItem: dodać pole unit_cost (cena zakupu)
- DeliveryDocument: dodać pole from_supplier FK(Supplier) nullable
- services.py: apply_pz_receipt() — po complete PZ zwiększa quantity_available + tworzy StockBatch
- View action: POST /api/delivery/{id}/receive/ (dla PZ documents)

Frontend:
- SupplierCreatePage, SuppliersPage
- DeliveryCreatePage: tryb PZ (wybór dostawcy zamiast klienta)
- DeliveryDocumentDetailPage: akcja "Przyjmij towar" dla PZ
```

---

### 3.2 FV-KOR — Faktura Korygująca (KRYTYCZNE prawnie)

**Co to jest:** Korekta do wystawionej faktury, obowiązkowa przy zwrocie towaru lub zmianie ceny.

**Obecny stan:** Całkowity brak. ZW tworzy dokument zwrotu ale nie generuje korekty faktury.

**Konsekwencja:** Niezgodność z przepisami podatkowymi. Przy zwrocie towaru po fakturze nie ma dokumentu który zmniejsza VAT należny.

**Wymagane zmiany:**
```
Backend:
- Model: InvoiceCorrection (lub dodać typ 'correction' do Invoice)
  - original_invoice FK(Invoice)
  - correction_reason
  - zw_document FK(DeliveryDocument) nullable
  - items (InvoiceCorrectionItem z quantity_diff, price_diff)
  - ksef_correction_fields
- View: POST /api/invoices/{id}/create-correction/
- Service: generate_correction_from_zw(zw_document)

Frontend:
- InvoiceDetailPage: przycisk "Wystaw korektę" (aktywny gdy status=issued/paid i jest ZW)
- InvoiceCorrectionPage: formularz korekty z pozycjami
```

---

### 3.3 INW — Inwentaryzacja / Remanent (WAŻNE)

**Co to jest:** Spis z natury — fizyczne przeliczenie stanów magazynowych i rozliczenie różnic.

**Obecny stan:** Całkowity brak. Nie możesz zweryfikować czy system zgadza się z rzeczywistością.

**Konsekwencja:** Bez inwentaryzacji błędy kumulują się niewidzialnie. Nie możesz zamknąć roku obrachunkowego.

**Wymagane zmiany:**
```
Backend:
- Model: InventoryCount
  - warehouse FK
  - count_date
  - status: draft → in_progress → completed → approved
  - counted_by, approved_by
- Model: InventoryCountItem
  - inventory_count FK
  - product FK
  - system_quantity (snapshot at start)
  - counted_quantity (wpisywane przez magazyniera)
  - difference (computed)
  - adjustment_movement FK(StockMovement) — tworzony po zatwierdzeniu
- Service: create_inventory_count(warehouse) — snapshot stanów
- Service: apply_inventory_adjustments(inventory_count) — tworzy ADJUSTMENT movements dla różnic

Frontend:
- InventoryCountPage: lista inwentaryzacji
- InventoryCountDetailPage: tabela produkt × system × liczony × różnica
- Eksport do Excel/PDF
```

---

### 3.4 LW — Likwidacja Wewnętrzna (PRZYDATNE)

**Co to jest:** Formalny dokument odpisu towaru (uszkodzony, przeterminowany, zużyty).

**Obecny stan:** `movement_type = DAMAGE` istnieje w StockMovement ale jest tworzony tylko w van reconciliation. Brak samodzielnego dokumentu LW.

**Wymagane zmiany:**
```
Backend:
- Dodać dedykowany endpoint: POST /api/delivery/write-off/
  - Przyjmuje: warehouse, items (product, quantity, reason)
  - Tworzy DeliveryDocument(type=LW) lub osobny model WriteOff
  - Tworzy StockMovement(DAMAGE) per item

Frontend:
- Przycisk "Likwidacja" w WarehouseDetailPage
- Formularz z pozycjami i przyczyną
```

---

### 3.5 Proforma / FZ — Faktura Zaliczkowa (PRZYDATNE)

**Co to jest:** Proforma to nie-księgowy dokument pro-forma do zapłaty zaliczki. FZ to faktura zaliczkowa po otrzymaniu zaliczki.

**Obecny stan:** Całkowity brak.

**Wymagane zmiany:**
```
Backend:
- Invoice: dodać type field: 'invoice' | 'proforma' | 'advance' | 'correction'
- Proforma: nie ma numeru FV, nie idzie do KSeF
- Advance: FZ/{year}/{seq}, zalicza się na poczet końcowej FV
- FV końcowa: odejmuje wpłacone zaliczki

Frontend:
- InvoiceCreatePage: wybór typu dokumentu
- InvoiceDetailPage: "Przekształć proformę w FV" action
```

---

### 3.6 MM-P — Przesunięcie Powrotne / Van → Magazyn

**Co to jest:** Zwrot niesprzedanego towaru z vana do magazynu głównego na koniec trasy.

**Obecny stan:** Tworzony w `apply_van_reconciliation()` jako MM z logiką odwrotną, ale nie ma dedykowanego type ani jasnej etykiety w UI.

**Problem:** MM na liście dokumentów wygląda tak samo jak MM załadunkowe — nie widać który to "powrót".

**Wymagane zmiany:**
```
Backend:
- DeliveryDocument: dodać subtype lub direction field
  albo osobny movement_direction: 'outbound' | 'return'
- Albo osobny document_type: 'MM_RETURN'

Frontend:
- Lista dokumentów: rozróżnienie MM ↓ (załadunek) i MM ↑ (zwrot)
```

---

## 4. KRYTYCZNE DZIURY W KONTROLI STANU MAGAZYNOWEGO

### 4.1 Stany rezerwacji są "ślepe" w UI

**Problem:** `ProductStock.quantity_reserved` mówi ile jest zarezerwowane ale nie dla kogo.

**Brak w systemie:** Nie możesz zobaczyć "10 szt zarezerwowane → ZAM/2026/0012 (5 szt) + ZAM/2026/0015 (5 szt)".

**Fix:**
```python
# Nowy endpoint
GET /api/products/{id}/reservations/
→ Lista: order_id, order_number, customer, quantity_reserved, delivery_date

# Lub widok w WarehouseDetailPage z rozwinięciem per produkt
```

---

### 4.2 `allow_negative_stock` — bomba zegarowa

**Problem:** Flaga pozwala wystawiać WZ na towar którego nie ma. Możesz sprzedać -3 szt.

**Konsekwencja:** Inwentaryzacja pokaże duże niedobory, stan finansowy jest fałszywy.

**Fix:**
```python
# W DeliveryDocument.complete() i OrderViewSet.confirm():
if not warehouse.allow_negative_stock:
    for item in items:
        if stock.quantity_available < item.quantity_actual:
            raise ValidationError(f"Niewystarczający stan: {product.name}")

# Lub: "soft block" — manager musi zatwierdzić overdraft
# Model: StockOverrideRequest z approval workflow
```

---

### 4.3 FIFO nie jest używany przy wydaniu towaru

**Problem:** `StockBatch` i `track_batches` istnieją w modelu ale `apply_delivery_document_line_updates()` nie dekrementuje partii FIFO.

**Konsekwencja:**
- Towary z datami ważności mogą być wydawane w złej kolejności
- Nie wiesz którą partię wysłałeś do którego klienta
- Brak tracku przy reklamacji "z której dostawy był ten towar"

**Fix:**
```python
# services.py — rozszerzyć apply_delivery_document_line_updates()
def deduct_fifo_batches(product, warehouse, quantity):
    """Dekrementuje partie FIFO (najstarsza data ważności pierwsza)"""
    batches = StockBatch.objects.filter(
        product=product, warehouse=warehouse, quantity_remaining__gt=0
    ).order_by('expiry_date', 'received_date')
    
    remaining = quantity
    for batch in batches:
        if remaining <= 0:
            break
        deduct = min(batch.quantity_remaining, remaining)
        batch.quantity_remaining -= deduct
        batch.save()
        remaining -= deduct
        # Zapisz batch_number na DeliveryItem dla tracku
```

---

### 4.4 Daty ważności — brak alertów

**Problem:** `Product.shelf_life_days` i `StockBatch.expiry_date` istnieją ale zero logiki alertów.

**Brak:**
- Produkty z partiami wygasającymi w ciągu X dni
- Blok na wydanie towaru przeterminowanego
- Raport "co wygasa w tym tygodniu"

**Fix:**
```python
# Nowy endpoint
GET /api/products/expiring-soon/?days=7
→ Lista partii z expiry_date <= today + 7 days

# Na dashboardzie: widget "Wygasające partie"
```

---

### 4.5 Van reconciliation nie weryfikuje bilansowania

**Problem:** `apply_van_reconciliation()` przyjmuje `quantity_actual_remaining` (co zostało w vanie) ale nie weryfikuje:
- Czy `loaded - sold - remaining = 0`?
- Czy `damaged + returned + sold + remaining = loaded`?

**Konsekwencja:** Możliwe "znikanie" towaru bez śladu.

**Fix:**
```python
# W services.py apply_van_reconciliation():
loaded = sum(mm_doc.items quantity)
sold = sum(wz_items quantity_actual)
returned = sum(zw_items quantity)
remaining_reported = sum(reconciliation_data quantity_actual_remaining)
damaged = sum(reconciliation_data quantity_writeoff)

balance = loaded - sold - returned - remaining_reported - damaged
if abs(balance) > Decimal('0.001'):
    raise ValidationError(f"Niezbilansowana trasa: różnica {balance} szt")
```

---

## 5. DZIURY W PRZEPŁYWIE ZAMÓWIEŃ

### 5.1 Brak statusu `partially_delivered`

**Problem:** Zamówienie 10 szt, dostarczone 8 szt → order.status = `delivered` (?) lub zostaje `in_delivery`.

**Konsekwencja:** Nie widać że są jeszcze 2 szt do dostarczenia. Zamówienie może zostać zapomniane.

**Fix:**
```python
# Order model — dodać status:
ORDER_STATUS = [
    ('draft', 'Szkic'),
    ('confirmed', 'Potwierdzone'),
    ('in_preparation', 'W przygotowaniu'),
    ('loaded', 'Załadowane'),
    ('in_delivery', 'W dostawie'),
    ('partially_delivered', 'Częściowo dostarczone'),  # NOWE
    ('delivered', 'Dostarczone'),
    ('invoiced', 'Zafakturowane'),
    ('cancelled', 'Anulowane'),
]

# W apply_delivery_document_line_updates() po complete:
total_ordered = sum(order_items.quantity)
total_delivered = sum(order_items.quantity_delivered)
if total_delivered < total_ordered:
    order.status = 'partially_delivered'
else:
    order.status = 'delivered'
```

---

### 5.2 Wiele WZ do jednego zamówienia — brak kontroli w UI

**Problem:** Model pozwala wiele WZ per zamówienie (partial deliveries) ale:
- OrderDetailPage nie pokazuje listy wszystkich WZ
- DeliveryDocumentsPage nie grupuje po zamówieniu
- Nie ma sumy "zamówiono 10, dostarczone WZ-1: 6, WZ-2: 4"

**Fix (UI):**
```tsx
// OrderDetailPage.tsx — sekcja dokumentów powiązanych
<Section title="Dokumenty WZ">
  {order.delivery_documents.map(wz => (
    <WzRow key={wz.id} doc={wz} />
  ))}
  <SummaryRow
    label="Łącznie dostarczone"
    value={`${totalDelivered} / ${totalOrdered} ${unit}`}
  />
</Section>
```

---

### 5.3 Synchronizacja WZ z zamówieniem po edycji

**Problem:** Endpoint `sync-from-order` istnieje ale nie jest jasne kiedy jest wywoływany automatycznie.

**Scenariusz:** Klient edytuje zamówienie po wygenerowaniu WZ (dodaje produkt). WZ nie ma nowej pozycji.

**Fix:**
```python
# W OrderViewSet.update() / partial_update():
# Jeśli zamówienie w statusie confirmed/in_preparation:
# Automatycznie wywołaj sync_wz_from_order() dla wszystkich powiązanych draft WZ
# Lub: warn user że WZ wymaga synchronizacji
```

---

### 5.4 Zwrot (ZW) nie cofa stanu rezerwacji

**Do weryfikacji:** Gdy ZW jest completed, czy `quantity_returned` wraca do `quantity_available`?

Sprawdź w `services.py`:
```python
# W apply_delivery_document_line_updates() przy ZW:
# Czy jest: stock.quantity_available += item.quantity_returned ?
# Czy jest StockMovement(RETURN) tworzony?
# Czy order.items.quantity_returned jest aktualizowany?
```

---

## 6. DZIURY W FAKTUROWANIU

### 6.1 Możliwość podwójnej faktury (KRYTYCZNE)

**Problem:** `Invoice.order` to FK bez `unique=True`. Można wygenerować 2 faktury dla tego samego zamówienia.

**Fix:**
```python
# models.py
class Invoice(models.Model):
    order = models.OneToOneField(
        Order,
        on_delete=models.PROTECT,
        related_name='invoice',
        null=True, blank=True
    )
    # Lub: unique_together = [('company', 'order')]
```

*Uwaga: zmiana na OneToOne jest breaking change — sprawdź czy partial delivery wymaga wielu FV per zamówienie. Jeśli tak, zostaw FK ale dodaj constraint biznesowy w serializer/view.*

---

### 6.2 WZ-FV link opcjonalny łamie zasadę wydania przed fakturą

**Problem:** `Invoice.delivery_document` jest nullable. Można wystawić FV bez WZ.

**Zasada:** Towar musi wyjść z magazynu (WZ) zanim zostanie zafakturowany.

**Fix:**
```python
# W InvoiceViewSet.issue() action:
if not invoice.delivery_document and not invoice.order.delivery_documents.filter(
    status='delivered'
).exists():
    raise ValidationError(
        "Nie można wystawić faktury — brak dostarczonego dokumentu WZ dla tego zamówienia."
    )
```

---

### 6.3 `billable_quantity` może fakturować za niedostarczone

**Problem:**
```python
def billable_quantity(order_item):
    return order_item.quantity_delivered if order_item.quantity_delivered > 0 else order_item.quantity
```

Jeśli `quantity_delivered = 0` (bo WZ nie zostało jeszcze zakończone lub delivery nie było) → fakturuje za zamówioną ilość, nie dostarczoną.

**Fix:**
```python
def billable_quantity(order_item):
    # Jeśli order ma completed WZ — użyj quantity_delivered
    # Jeśli nie ma WZ w ogóle — użyj quantity (zamówiona)
    # Jeśli WZ jest w trakcie — blokuj fakturowanie
    has_completed_wz = order_item.order.delivery_documents.filter(status='delivered').exists()
    if has_completed_wz:
        return order_item.quantity_delivered  # nawet jeśli 0 = nie dostarczone
    return order_item.quantity
```

---

## 7. DZIURY UI I WIDOCZNOŚĆ

### 7.1 WarehouseDetailPage — brak stanów produktów

**Obecny stan:** Strona istnieje, prawdopodobnie pokazuje tylko metadata magazynu (nazwa, kod, typ, adres).

**Powinno być:**
```
Magazyn: MG — Główny
┌─────────────────┬──────────┬──────────────┬──────────────┐
│ Produkt         │ Dostępne │ Zarezerwowane│ Razem        │
├─────────────────┼──────────┼──────────────┼──────────────┤
│ Mleko 3.2%      │ 240 szt  │ 60 szt       │ 300 szt  ⚠️  │
│ Jogurt naturalny│ 80 szt   │ 20 szt       │ 100 szt      │
│ Śmietana 18%    │ 5 szt    │ 0 szt        │ 5 szt    🔴  │
└─────────────────┴──────────┴──────────────┴──────────────┘
⚠️ = poniżej min_stock_alert    🔴 = krytycznie niski
```

---

### 7.2 Brak historii ruchów per produkt

**Obecny stan:** `StockMovement` model istnieje, bogaty w dane. Zero UI.

**Powinno być w ProductDetailPage/ProductEditPage:**
```
Historia ruchów — Mleko 3.2% — Magazyn Główny
┌────────────┬─────────────┬──────────┬───────────┬──────────────────────┐
│ Data       │ Typ         │ Ilość    │ Po ruchu  │ Źródło               │
├────────────┼─────────────┼──────────┼───────────┼──────────────────────┤
│ 2026-05-29 │ RESERVATION │ -60 szt  │ 240/60    │ ZAM/2026/0023        │
│ 2026-05-28 │ SALE        │ -120 szt │ 300/0     │ WZ/2026/0018         │
│ 2026-05-27 │ PURCHASE    │ +500 szt │ 420/0     │ adjust_stock         │
└────────────┴─────────────┴──────────┴───────────┴──────────────────────┘
```

---

### 7.3 Brak dashboardu operacyjnego

**Powinno być na stronie głównej (`/dashboard`):**
```
DZISIAJ — 2026-05-29
┌─────────────────────┬─────────────────────┬─────────────────────┐
│ 📦 DO POTWIERDZENIA │ 🚛 DO DOSTARCZENIA  │ 💰 ZALEGŁE FAKTURY  │
│ 3 zamówienia        │ 5 WZ w in_transit   │ 4 faktury overdue   │
│ [→ Zamówienia]      │ [→ Dostawy]         │ [→ Faktury]         │
├─────────────────────┴─────────────────────┴─────────────────────┤
│ ⚠️ NISKIE STANY (poniżej min_stock_alert)                       │
│ Śmietana 18% — MG: 5 szt (min: 20)                             │
│ Kefir 2% — MG: 2 szt (min: 10)                                  │
├──────────────────────────────────────────────────────────────────┤
│ 🚐 TRASY VAN (dziś)                                             │
│ Trasa Południe — Jan Kowalski — IN_PROGRESS — 8/12 przystanków  │
└──────────────────────────────────────────────────────────────────┘
```

---

### 7.4 Brak widoku klienta 360°

**CustomerDetailPage powinien mieć zakładki:**
```
[Dane]  [Zamówienia]  [Dostawy]  [Faktury]  [Zwroty]  [Saldo]

Zakładka SALDO:
  Limit kredytowy:        10 000 zł
  Otwarte faktury:         3 450 zł  ← klikalne
  Zaległe (>30 dni):         890 zł  ← czerwone
  Dostępny kredyt:         6 550 zł
```

---

### 7.5 Brak alertów stanów minimalnych w liście produktów

**ProductsPage powinien mieć:**
- Filtr "pokaż tylko poniżej minimum"
- Ikona ⚠️ przy produkcie z niskim stanem
- Kolumna "Stan / Min" zamiast samego stanu

---

### 7.6 VanRoute — brak per-stop statusu

**Obecny stan:** VanRoute ma listę zamówień (M2M) ale żadnego "czy stop X jest dostarczone".

**Problem:** Kierowca nie może oznaczyć poszczególnych przystanków jako dostarczone.

**Fix:**
```python
# Model: VanRouteStop
class VanRouteStop(models.Model):
    route = models.ForeignKey(VanRoute, on_delete=CASCADE, related_name='stops')
    order = models.ForeignKey(Order, on_delete=PROTECT)
    sequence = models.PositiveIntegerField()  # kolejność
    status = models.CharField(choices=['pending', 'delivered', 'skipped', 'failed'])
    wz_document = models.ForeignKey(DeliveryDocument, null=True)
    notes = models.TextField(blank=True)
    completed_at = models.DateTimeField(null=True)
```

---

## 8. MODEL DOCELOWY — JAK POWINNO WYGLĄDAĆ

```
┌─────────────────────────────────────────────────────────────────┐
│                        ZAKUPY / DOSTAWA                         │
│                                                                 │
│  Dostawca → ZD (zamów do dostawcy) → PZ (przyjmij) → Magazyn   │
│                                         └─ StockBatch (FIFO)   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MAGAZYN GŁÓWNY                            │
│                                                                 │
│  ProductStock: available / reserved / in_transit                │
│  StockBatch: batch_no / expiry / unit_cost / FIFO               │
│  Alerty: min_stock_alert | expiry w 7 dni                       │
│  Kontrola: brak ujemnych stanów (hard block)                    │
│  Inwentaryzacja: INW dokument → korekty ADJUSTMENT              │
└─────────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌───────────────────┐ ┌──────────────────┐
│  SPRZEDAŻ        │ │  VAN ROUTE        │ │  ZWROTY          │
│                  │ │                   │ │                  │
│  ZAM (order)     │ │  VanRoute         │ │  ZW (return)     │
│    draft         │ │    PLANNED        │ │    draft         │
│    confirmed     │ │    LOADING        │ │    saved         │
│    part_delivered│ │    IN_PROGRESS    │ │    delivered     │
│    delivered     │ │    SETTLING       │ │       │          │
│    invoiced      │ │    CLOSED         │ │       ▼          │
│       │          │ │       │           │ │  FV-KOR          │
│       ▼          │ │       │           │ │  (jeśli FV była) │
│  WZ (delivery)   │ │  MM ↓ (załadunek)│ └──────────────────┘
│    draft         │ │  WZ per stop      │
│    in_transit    │ │  ZW per returns   │
│    delivered     │ │  MM ↑ (powrót)    │
└──────────────────┘ └───────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────┐
│                       FAKTUROWANIE                              │
│                                                                 │
│  Proforma → zaliczka FZ → FV końcowa → FV-KOR (korekta)       │
│                                                                 │
│  Kontrole:                                                      │
│  ✓ 1 FV per ZAM (lub explicite partial)                        │
│  ✓ WZ musi być delivered przed FV issue                        │
│  ✓ billable_qty = delivered qty (nie ordered)                  │
│  ✓ FV-KOR obowiązkowa przy ZW po FV                           │
│  ✓ KSeF send przy issue                                        │
└─────────────────────────────────────────────────────────────────┘
```

---

## 9. PRIORYTETY NAPRAW I ROZBUDOWY

### 🔴 KRYTYCZNE — Dziury finansowe / prawne

| # | Problem | Ryzyko | Trudność |
|---|---------|--------|----------|
| 1 | Podwójna faktura możliwa (brak unique constraint) | Finansowe | Niska |
| 2 | FV-KOR brak — zwroty po fakturze bez korekty | Prawne (VAT) | Wysoka |
| 3 | PZ workflow brak — nie wiesz skąd pochodzi towar | Kontrola | Średnia |
| 4 | ZW nie weryfikuje cofnięcia stanu magazynowego | Finansowe | Niska |
| 5 | WZ możliwe bez powiązanego zamówienia (FV bez dostawy) | Prawne | Niska |

### 🟠 WAŻNE — Widoczność i kontrola

| # | Problem | Ryzyko | Trudność |
|---|---------|--------|----------|
| 6 | Brak widoku stanów w WarehouseDetailPage | Operacyjne | Niska |
| 7 | Brak historii ruchów per produkt w UI | Operacyjne | Niska |
| 8 | Stan `partially_delivered` brakuje | Operacyjne | Niska |
| 9 | Stany rezerwacji "ślepe" — nie wiadomo dla kogo | Operacyjne | Niska |
| 10 | allow_negative_stock — brak hard block | Magazynowe | Niska |

### 🟡 PRZYDATNE — Efektywność operacyjna

| # | Problem | Ryzyko | Trudność |
|---|---------|--------|----------|
| 11 | Dashboard operacyjny "co robię dziś" | Efektywność | Średnia |
| 12 | Customer 360° view | Efektywność | Średnia |
| 13 | Min stock alerts widoczne w UI | Magazynowe | Niska |
| 14 | FIFO faktycznie używany przy WZ | Jakość danych | Średnia |
| 15 | Daty ważności — alerty i blok przy wydaniu | Magazynowe | Średnia |
| 16 | Van reconciliation — weryfikacja bilansu | Magazynowe | Niska |
| 17 | VanRouteStop — per-stop status dla kierowcy | Operacyjne | Średnia |

### 🔵 DŁUGOTERMINOWE — Pełny WMS

| # | Feature | Trudność |
|---|---------|----------|
| 18 | INW — inwentaryzacja / spis z natury | Wysoka |
| 19 | Dostawcy (Supplier) + ZD (zamówienia do dostawców) | Wysoka |
| 20 | Proforma + faktura zaliczkowa FZ | Wysoka |
| 21 | LW — likwidacja wewnętrzna jako osobny dokument | Średnia |
| 22 | Wielofakturowość na jedno zamówienie (partial) | Wysoka |
| 23 | Raport obrotów / COGS z batch unit_cost | Wysoka |

---

## 10. SZCZEGÓŁOWY PLAN IMPLEMENTACJI PER PRIORYTET

### KROK 1 — Unikalność faktury (1-2h)

```python
# backend/apps/invoices/models.py
class Invoice(models.Model):
    order = models.ForeignKey(
        Order, on_delete=models.PROTECT,
        null=True, blank=True, related_name='invoices'
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'order'],
                condition=models.Q(status__in=['draft', 'issued', 'sent', 'paid']),
                name='unique_active_invoice_per_order'
            )
        ]
```

---

### KROK 2 — Weryfikacja ZW → stock cofnięcie (2-3h)

Sprawdzić i ewentualnie naprawić w `services.py`:
```python
# apply_delivery_document_line_updates() dla document_type == 'ZW':
# Po complete, dla każdego DeliveryItem gdzie quantity_actual > 0:
stock = ProductStock.get_or_create_for(item.product, zw_doc.to_warehouse)
stock.quantity_available += item.quantity_actual
stock.save()

StockMovement.objects.create(
    product=item.product,
    warehouse=zw_doc.to_warehouse,
    movement_type='RETURN',
    quantity=item.quantity_actual,
    quantity_before=stock.quantity_available - item.quantity_actual,
    quantity_after=stock.quantity_available,
    reference_type='delivery_document',
    reference_id=str(zw_doc.id),
    notes=f"Zwrot z {zw_doc.document_number}"
)
```

---

### KROK 3 — Status `partially_delivered` (2-3h)

```python
# backend/apps/orders/models.py — dodać status
# backend/apps/delivery/services.py — po complete WZ:
def update_order_status_after_delivery(order):
    items = order.items.all()
    total_qty = sum(i.quantity for i in items)
    delivered_qty = sum(i.quantity_delivered for i in items)
    
    if delivered_qty == 0:
        pass  # zostaje in_delivery
    elif delivered_qty < total_qty:
        order.status = 'partially_delivered'
    else:
        order.status = 'delivered'
        order.delivered_at = timezone.now()
    order.save()
```

---

### KROK 4 — WarehouseDetailPage ze stanami (3-4h)

```python
# Nowy endpoint
GET /api/warehouses/{id}/stock/
→ Lista ProductStock gdzie warehouse=id
  + product.name, product.sku, product.min_stock_alert
  + is_below_minimum (computed)

# Filtr: ?below_minimum=true
```

```tsx
// frontend/src/pages/WarehouseDetailPage.tsx
// Dodać sekcję StockTable z kolumnami:
// Produkt | SKU | Dostępne | Zarezerwowane | Razem | Min | Status
```

---

### KROK 5 — Historia ruchów per produkt (2-3h)

```python
# Endpoint już istnieje w StockMovementViewSet:
GET /api/products/{id}/movements/?warehouse={id}&ordering=-created_at

# Jeśli brak — dodać:
@action(detail=True, methods=['get'], url_path='movements')
def movements(self, request, pk=None):
    product = self.get_object()
    movements = StockMovement.objects.filter(
        product=product, company=request.company
    ).order_by('-created_at')
    # filtr opcjonalny: ?warehouse=, ?type=, ?date_from=, ?date_to=
```

```tsx
// W ProductEditPage.tsx — dodać zakładkę "Historia ruchów"
// Tabela: Data | Typ | Magazyn | Ilość | Stan po | Źródło (klikalne)
```

---

### KROK 6 — Blokada ujemnego stanu (1-2h)

```python
# backend/apps/orders/models.py — Order.confirm():
for item in self.items.all():
    stock = ProductStock.get_or_create_for(item.product, main_warehouse)
    if stock.quantity_available < item.quantity:
        if not main_warehouse.allow_negative_stock:
            raise ValidationError(
                f"Niewystarczający stan dla {item.product.name}: "
                f"dostępne {stock.quantity_available}, wymagane {item.quantity}"
            )
```

---

### KROK 7 — Dashboard operacyjny (4-6h)

```python
# Nowy endpoint
GET /api/dashboard/summary/
→ {
    orders_pending_confirmation: count,
    wz_in_transit: count,
    invoices_overdue: count + total_amount,
    van_routes_today: [{id, driver, status, stops_done/total}],
    low_stock_alerts: [{product, warehouse, available, minimum}],
    expiring_soon: [{product, batch, expiry_date, quantity}]
  }
```

---

### KROK 8 — Customer 360° (4-6h)

```python
# Rozszerzyć CustomerViewSet o actions:
GET /api/customers/{id}/orders/        # historia zamówień
GET /api/customers/{id}/invoices/      # historia faktur
GET /api/customers/{id}/balance/       # saldo: open + overdue + credit_limit
GET /api/customers/{id}/deliveries/    # historia WZ
```

---

## PODSUMOWANIE DZIUR W JEDNYM ZDANIU

> Twój system poprawnie obsługuje **rdzeń transakcji** (ZAM → WZ → FV) ale brakuje mu **odporności** (brak blokad, brak korekt), **widoczności** (stany magazynowe niewidoczne, historia niewidoczna) i **pełnego cyklu zakupowego** (PZ, dostawcy, inwentaryzacja). Priorytetem są blokady finansowe (podwójna FV, FV-KOR) i widoczność stanów (WarehouseDetail, historia ruchów) — reszta to rozbudowa funkcjonalna.

---

## 11. PLAN DZIAŁANIA — Szczegółowe zadania dla LLM

> Ten rozdział to wykonawczy plan wdrożenia zmian. Każde zadanie jest opisane tak, żeby inny agent LLM mógł je zrealizować bez dodatkowego kontekstu. Zadania są numerowane i uporządkowane od najważniejszych. Każde zawiera: **kontekst**, **pliki do odczytu**, **dokładne zmiany**, **kryteria weryfikacji**.

---

### FAZA 0 — PZ: Przyjęcie Zewnętrzne (pełna implementacja)

> PZ to jedyna droga kontrolowanego wejścia towaru do magazynu. Bez PZ każdy zakup to ręczna korekta `adjust_stock` bez dostawcy, bez ceny zakupu, bez dokumentu. To fundament pod cały flow magazynowy — implementuj przed resztą.

---

#### ZADANIE 0.1 — Model: Supplier (Dostawca)

**Kontekst:**
PZ musi być powiązane z dostawcą. Teraz w systemie nie istnieje model dostawcy. Dostawca to odpowiednik `Customer` ale po stronie zakupowej — ma NIP, adres, kontakt, warunki płatności.

**Plik do utworzenia lub rozbudowy:**
Sprawdź czy istnieje `backend/apps/suppliers/` lub `backend/apps/customers/models.py`. Jeśli nie ma osobnej aplikacji suppliers — utwórz nową aplikację Django:

```bash
python manage.py startapp suppliers
# Dodaj 'apps.suppliers' do INSTALLED_APPS w backend/config/settings.py
```

**Model `Supplier` (`backend/apps/suppliers/models.py`):**

```python
import uuid
from django.db import models


class Supplier(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.ForeignKey(
        'users.Company', on_delete=models.CASCADE, related_name='suppliers'
    )
    name = models.CharField(max_length=255)           # nazwa firmy dostawcy
    nip = models.CharField(max_length=20, blank=True) # NIP dostawcy
    email = models.EmailField(blank=True)
    phone = models.CharField(max_length=50, blank=True)
    street = models.CharField(max_length=255, blank=True)
    city = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=20, blank=True)
    country = models.CharField(max_length=100, default='Polska')
    payment_terms = models.PositiveIntegerField(
        default=14, help_text="Dni do płatności"
    )
    notes = models.TextField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        constraints = [
            models.UniqueConstraint(
                fields=['company', 'nip'],
                condition=models.Q(nip__gt=''),
                name='unique_supplier_nip_per_company'
            )
        ]

    def __str__(self):
        return self.name
```

**Serializer (`backend/apps/suppliers/serializers.py`):**

```python
from rest_framework import serializers
from .models import Supplier


class SupplierSerializer(serializers.ModelSerializer):
    class Meta:
        model = Supplier
        fields = [
            'id', 'name', 'nip', 'email', 'phone',
            'street', 'city', 'postal_code', 'country',
            'payment_terms', 'notes', 'is_active',
            'created_at', 'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']

    def create(self, validated_data):
        validated_data['company'] = self.context['request'].user.current_company
        return super().create(validated_data)


class SupplierListSerializer(serializers.ModelSerializer):
    """Slim serializer do dropdownów i list."""
    class Meta:
        model = Supplier
        fields = ['id', 'name', 'nip', 'city', 'is_active']
```

**ViewSet (`backend/apps/suppliers/views.py`):**

```python
from rest_framework import viewsets, filters
from rest_framework.permissions import IsAuthenticated
from .models import Supplier
from .serializers import SupplierSerializer, SupplierListSerializer


class SupplierViewSet(viewsets.ModelViewSet):
    permission_classes = [IsAuthenticated]
    filter_backends = [filters.SearchFilter, filters.OrderingFilter]
    search_fields = ['name', 'nip', 'city']
    ordering_fields = ['name', 'created_at']
    ordering = ['name']

    def get_queryset(self):
        return Supplier.objects.filter(
            company=self.request.user.current_company,
            is_active=True,
        )

    def get_serializer_class(self):
        if self.action == 'list':
            return SupplierListSerializer
        return SupplierSerializer
```

**URL (`backend/apps/suppliers/urls.py`):**

```python
from rest_framework.routers import DefaultRouter
from .views import SupplierViewSet

router = DefaultRouter()
router.register(r'suppliers', SupplierViewSet, basename='supplier')
urlpatterns = router.urls
```

**Zarejestruj w `backend/config/urls.py`:**
```python
path('api/', include('apps.suppliers.urls')),
```

**Migracja:**
```bash
python manage.py makemigrations suppliers
python manage.py migrate
```

**Kryteria weryfikacji:**
- [ ] `GET /api/suppliers/` zwraca listę dostawców firmy
- [ ] `POST /api/suppliers/` tworzy dostawcę przypisanego do current_company
- [ ] `PUT /api/suppliers/{id}/` aktualizuje dostawcę
- [ ] Dostawcy innych firm nie są widoczne (company scope)

---

#### ZADANIE 0.2 — Model: Rozszerzenie DeliveryDocument i DeliveryItem o pola PZ

**Kontekst:**
`DeliveryDocument` już ma `document_type = 'PZ'` jako opcję ale brakuje:
- `from_supplier` — kto dostarcza
- `unit_cost` na linii — cena zakupu (potrzebna do FIFO/COGS)
- `expected_delivery_date` — planowana data dostawy (opcjonalnie)

**Plik:** `backend/apps/delivery/models.py`

**Zmiana 1 — Dodaj FK do Supplier na `DeliveryDocument`:**

Znajdź model `DeliveryDocument` i dodaj pole po `to_customer`:
```python
from_supplier = models.ForeignKey(
    'suppliers.Supplier',
    on_delete=models.SET_NULL,
    null=True, blank=True,
    related_name='delivery_documents',
    help_text="Wypełniane dla dokumentów PZ — kto dostarcza towar"
)
```

**Zmiana 2 — Dodaj `unit_cost` na `DeliveryItem`:**

Znajdź model `DeliveryItem` i dodaj:
```python
unit_cost = models.DecimalField(
    max_digits=10, decimal_places=4,
    null=True, blank=True,
    help_text="Cena zakupu netto per jednostka — wypełniana przy PZ"
)
```

**Migracja:**
```bash
python manage.py makemigrations delivery
python manage.py migrate
```

**Kryteria weryfikacji:**
- [ ] `DeliveryDocument` ma pole `from_supplier_id` w bazie
- [ ] `DeliveryItem` ma pole `unit_cost` w bazie
- [ ] Istniejące WZ/MM/ZW nie są naruszane (pola nullable)

---

#### ZADANIE 0.3 — Service: `apply_pz_receipt()` — logika przyjęcia towaru

**Kontekst:**
To główna logika PZ. Po zakończeniu dokumentu PZ (zmiana statusu na `delivered`) musi:
1. Zwiększyć `ProductStock.quantity_available` w magazynie docelowym
2. Utworzyć `StockBatch` jeśli produkt ma `track_batches=True`
3. Zapisać `StockMovement(PURCHASE)` dla każdej linii
4. Zaktualizować status zamówienia na `invoiced` jeśli PZ powiązane z ZD (przyszłość — pomiń na razie)

**Plik:** `backend/apps/delivery/services.py`

**Dodaj funkcję:**

```python
from decimal import Decimal
from django.utils import timezone
from apps.products.models import ProductStock, StockBatch, StockMovement


def apply_pz_receipt(pz_document):
    """
    Wywoływana po zmianie statusu PZ na 'delivered'.
    Przyjmuje towar do magazynu: zwiększa stany, tworzy partie FIFO, zapisuje ruchy.

    Parametry:
      pz_document: DeliveryDocument z document_type='PZ' i status='delivered'

    Zasady:
    - to_warehouse na PZ = magazyn do którego przyjmujemy towar
    - quantity_actual na DeliveryItem = faktycznie przyjęta ilość
      (może różnić się od quantity_planned jeśli dostawca dostarczył inną ilość)
    - unit_cost na DeliveryItem = cena zakupu netto per szt
    - Jeśli product.track_batches=True: tworzy StockBatch z batch_number i expiry_date
    """
    if pz_document.document_type != 'PZ':
        raise ValueError(
            f"apply_pz_receipt() wywołana dla dokumentu typu "
            f"{pz_document.document_type}, oczekiwano 'PZ'"
        )
    if pz_document.status != 'delivered':
        raise ValueError(
            f"apply_pz_receipt() wywołana dla dokumentu w statusie "
            f"{pz_document.status}, oczekiwano 'delivered'"
        )

    warehouse = pz_document.to_warehouse
    if warehouse is None:
        raise ValueError(
            f"PZ {pz_document.document_number} nie ma ustawionego to_warehouse"
        )

    for item in pz_document.items.all():
        # Użyj quantity_actual (ile faktycznie przyjęto), fallback na quantity_planned
        received_qty = item.quantity_actual if item.quantity_actual else item.quantity_planned
        if received_qty <= Decimal('0'):
            continue

        # 1. Zaktualizuj stan magazynowy
        stock = ProductStock.get_or_create_for(item.product, warehouse)
        qty_before = stock.quantity_available
        stock.quantity_available += received_qty
        stock.save(update_fields=['quantity_available'])

        # 2. Utwórz partię FIFO jeśli produkt śledzi partie
        if item.product.track_batches:
            # batch_number generowany automatycznie jeśli brak
            batch_number = (
                f"PZ-{pz_document.document_number}-{item.product.sku or item.product.id}"
            )
            StockBatch.objects.create(
                product=item.product,
                warehouse=warehouse,
                company=pz_document.company,
                batch_number=batch_number,
                received_date=pz_document.issue_date or timezone.now().date(),
                expiry_date=None,  # TODO: dodać pole expiry_date na DeliveryItem w przyszłości
                quantity_initial=received_qty,
                quantity_remaining=received_qty,
                unit_cost=item.unit_cost or Decimal('0'),
            )

        # 3. Zapisz ruch magazynowy
        StockMovement.objects.create(
            product=item.product,
            warehouse=warehouse,
            company=pz_document.company,
            movement_type='PURCHASE',
            quantity=received_qty,               # dodatnie — towar wchodzi
            quantity_before=qty_before,
            quantity_after=stock.quantity_available,
            reference_type='delivery_document',
            reference_id=str(pz_document.id),
            notes=(
                f"Przyjęcie PZ {pz_document.document_number}"
                + (f" od {pz_document.from_supplier.name}" if pz_document.from_supplier else "")
            ),
        )
```

**Kryteria weryfikacji funkcji:**
- [ ] Po wywołaniu: `ProductStock.quantity_available` wzrasta o `quantity_actual`
- [ ] `StockMovement` z `movement_type='PURCHASE'` istnieje dla każdej linii
- [ ] `quantity_before + received_qty == quantity_after` w StockMovement
- [ ] Dla produktów z `track_batches=True`: `StockBatch` tworzony z `quantity_remaining = received_qty`
- [ ] Dla produktów bez `track_batches`: brak StockBatch (bez błędów)
- [ ] Wywołanie dla dokumentu innego niż PZ rzuca `ValueError`

---

#### ZADANIE 0.4 — View: Akcje dla dokumentów PZ w `DeliveryDocumentViewSet`

**Kontekst:**
`DeliveryDocumentViewSet` obsługuje wszystkie typy dokumentów (WZ/MM/ZW/PZ) ale akcje takie jak `complete` wywołują logikę WZ. Przy PZ należy wywołać `apply_pz_receipt()` zamiast logiki wydania.

**Plik:** `backend/apps/delivery/views.py`

**Zmiana 1 — Rozróżnienie typów w akcji `complete`:**

Znajdź akcję `complete` w `DeliveryDocumentViewSet`. Dodaj rozgałęzienie:
```python
@action(detail=True, methods=['post'])
def complete(self, request, pk=None):
    document = self.get_object()

    if document.document_type == 'PZ':
        # Logika przyjęcia towaru
        # Walidacja: document musi być w statusie in_transit lub saved
        if document.status not in ['saved', 'in_transit']:
            return Response(
                {'detail': f"Nie można zakończyć PZ w statusie '{document.status}'."},
                status=status.HTTP_400_BAD_REQUEST
            )
        # Aktualizacja quantity_actual na liniach jeśli przesłane w body
        # (opcjonalne — jeśli body zawiera items z quantity_actual)
        serializer = DeliveryCompleteSerializer(data=request.data)
        if serializer.is_valid():
            # Zaktualizuj linie
            for item_data in serializer.validated_data.get('items', []):
                DeliveryItem.objects.filter(
                    id=item_data['id'], delivery_document=document
                ).update(quantity_actual=item_data['quantity_actual'])

        # Zmień status
        document.status = 'delivered'
        document.save(update_fields=['status'])

        # Wywołaj logikę przyjęcia towaru
        apply_pz_receipt(document)

        return Response(DeliveryDocumentSerializer(document).data)

    else:
        # Istniejąca logika WZ/MM/ZW — bez zmian
        # ... (reszta istniejącego kodu complete)
        pass
```

**Zmiana 2 — Endpoint do tworzenia PZ (`create-pz` action):**

Dodaj dedykowaną akcję tworzenia PZ (czytelniejszą niż generyczne POST /delivery/):

```python
@action(detail=False, methods=['post'], url_path='create-pz')
def create_pz(self, request):
    """
    Tworzy dokument PZ (Przyjęcie Zewnętrzne) w statusie draft.

    Wymagane pola w body:
      - to_warehouse: UUID magazynu docelowego (MAIN lub inny)
      - issue_date: data dokumentu
      - from_supplier: UUID dostawcy (opcjonalne ale zalecane)
      - items: lista pozycji
          - product: UUID produktu
          - quantity_planned: planowana ilość
          - unit_cost: cena zakupu netto (opcjonalne)
          - notes: notatka do linii (opcjonalne)

    Przykład body:
    {
      "to_warehouse": "uuid-magazynu",
      "issue_date": "2026-05-29",
      "from_supplier": "uuid-dostawcy",
      "items": [
        {"product": "uuid-produktu", "quantity_planned": 100, "unit_cost": "4.50"},
        {"product": "uuid-produktu2", "quantity_planned": 50}
      ]
    }
    """
    company = request.user.current_company

    # Walidacja warehouse
    try:
        warehouse = Warehouse.objects.get(
            id=request.data.get('to_warehouse'), company=company
        )
    except Warehouse.DoesNotExist:
        return Response(
            {'to_warehouse': 'Nie znaleziono magazynu.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Walidacja supplier (opcjonalna)
    supplier = None
    supplier_id = request.data.get('from_supplier')
    if supplier_id:
        try:
            from apps.suppliers.models import Supplier
            supplier = Supplier.objects.get(id=supplier_id, company=company)
        except Supplier.DoesNotExist:
            return Response(
                {'from_supplier': 'Nie znaleziono dostawcy.'},
                status=status.HTTP_400_BAD_REQUEST
            )

    items_data = request.data.get('items', [])
    if not items_data:
        return Response(
            {'items': 'PZ musi mieć co najmniej jedną pozycję.'},
            status=status.HTTP_400_BAD_REQUEST
        )

    # Utwórz dokument
    pz = DeliveryDocument.objects.create(
        company=company,
        document_type='PZ',
        status='draft',
        to_warehouse=warehouse,
        from_supplier=supplier,
        issue_date=request.data.get('issue_date'),
        notes=request.data.get('notes', ''),
    )

    # Utwórz linie
    for item_data in items_data:
        try:
            product = Product.objects.get(
                id=item_data['product'], company=company
            )
        except Product.DoesNotExist:
            pz.delete()
            return Response(
                {'items': f"Produkt {item_data['product']} nie istnieje."},
                status=status.HTTP_400_BAD_REQUEST
            )

        DeliveryItem.objects.create(
            delivery_document=pz,
            product=product,
            quantity_planned=item_data.get('quantity_planned', 0),
            quantity_actual=Decimal('0'),
            unit_cost=item_data.get('unit_cost') or None,
            notes=item_data.get('notes', ''),
        )

    return Response(
        DeliveryDocumentSerializer(pz).data,
        status=status.HTTP_201_CREATED
    )
```

**Zarejestruj URL jeśli potrzeba** — `DeliveryDocumentViewSet` używa routera więc `create-pz` action pojawi się automatycznie pod `/api/delivery/create-pz/`.

**Kryteria weryfikacji:**
- [ ] `POST /api/delivery/create-pz/` tworzy PZ w statusie `draft` z liniami
- [ ] `POST /api/delivery/{id}/complete/` dla PZ wywołuje `apply_pz_receipt()` i zmienia status na `delivered`
- [ ] Po complete PZ: stany magazynowe wzrastają o `quantity_actual`
- [ ] `POST /api/delivery/{id}/complete/` dla WZ NIE wywołuje `apply_pz_receipt()` (rozgałęzienie działa)

---

#### ZADANIE 0.5 — Serializer: Pola PZ w `DeliveryDocumentSerializer`

**Kontekst:**
`DeliveryDocumentSerializer` i `DeliveryItemSerializer` muszą obsługiwać nowe pola: `from_supplier`, `unit_cost`.

**Plik:** `backend/apps/delivery/serializers.py`

**Zmiana w `DeliveryDocumentSerializer`:**

Dodaj pole `from_supplier_name` (read-only display) i `from_supplier` (write):
```python
from_supplier_name = serializers.CharField(
    source='from_supplier.name', read_only=True, default=None
)
```

Dodaj `from_supplier` i `from_supplier_name` do `fields` w `Meta`.

**Zmiana w `DeliveryItemSerializer`:**

Dodaj pole `unit_cost` do `fields` w `Meta`. Upewnij się że nie jest `read_only` — przy tworzeniu PZ chcemy je zapisywać.

**Kryteria weryfikacji:**
- [ ] `GET /api/delivery/{id}/` dla PZ zwraca `from_supplier_name`
- [ ] `POST /api/delivery/create-pz/` z `unit_cost` na linii zapisuje wartość
- [ ] `GET /api/delivery/{id}/` dla WZ zwraca `from_supplier_name: null` bez błędów

---

#### ZADANIE 0.6 — Frontend: Typy TypeScript dla PZ i Supplier

**Kontekst:**
Nowe encje wymagają typów TypeScript w frontendzie.

**Plik 1 — Nowy plik `frontend/src/types/supplier.types.ts`:**

```typescript
export interface Supplier {
  id: string;
  name: string;
  nip: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  postal_code: string;
  country: string;
  payment_terms: number;
  notes: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface SupplierListItem {
  id: string;
  name: string;
  nip: string;
  city: string;
  is_active: boolean;
}

export interface SupplierCreatePayload {
  name: string;
  nip?: string;
  email?: string;
  phone?: string;
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string;
  payment_terms?: number;
  notes?: string;
}
```

**Plik 2 — Zaktualizuj `frontend/src/types/delivery.types.ts`:**

Dodaj do interfejsu `DeliveryDocument`:
```typescript
from_supplier?: string | null;    // UUID dostawcy (write)
from_supplier_name?: string | null; // nazwa dostawcy (read)
```

Dodaj do interfejsu `DeliveryItem`:
```typescript
unit_cost?: string | null;   // cena zakupu jako string (Decimal z backendu)
```

Dodaj payload dla tworzenia PZ:
```typescript
export interface PZCreatePayload {
  to_warehouse: string;          // UUID magazynu
  issue_date: string;            // YYYY-MM-DD
  from_supplier?: string;        // UUID dostawcy (opcjonalne)
  notes?: string;
  items: PZCreateItem[];
}

export interface PZCreateItem {
  product: string;               // UUID produktu
  quantity_planned: number;
  unit_cost?: string;            // cena zakupu netto
  notes?: string;
}
```

**Kryteria weryfikacji:**
- [ ] TypeScript nie zgłasza błędów typów przy tworzeniu PZ
- [ ] `from_supplier_name` jest opcjonalne (nullable) — WZ nie mają dostawcy

---

#### ZADANIE 0.7 — Frontend: Serwis dla Supplier

**Plik:** `frontend/src/services/supplier.service.ts` (nowy plik)

```typescript
import api from './api';
import { Supplier, SupplierListItem, SupplierCreatePayload } from '../types/supplier.types';

export const getSuppliers = async (): Promise<SupplierListItem[]> => {
  const response = await api.get('/suppliers/');
  return response.data;
};

export const getSupplier = async (id: string): Promise<Supplier> => {
  const response = await api.get(`/suppliers/${id}/`);
  return response.data;
};

export const createSupplier = async (payload: SupplierCreatePayload): Promise<Supplier> => {
  const response = await api.post('/suppliers/', payload);
  return response.data;
};

export const updateSupplier = async (id: string, payload: Partial<SupplierCreatePayload>): Promise<Supplier> => {
  const response = await api.patch(`/suppliers/${id}/`, payload);
  return response.data;
};
```

**Dodaj metody PZ do `frontend/src/services/delivery.service.ts`:**

```typescript
import { PZCreatePayload } from '../types/delivery.types';

export const createPZ = async (payload: PZCreatePayload): Promise<DeliveryDocument> => {
  const response = await api.post('/delivery/create-pz/', payload);
  return response.data;
};
```

---

#### ZADANIE 0.8 — Frontend: React Query hooki dla Supplier i PZ

**Plik:** Dodaj do istniejącego pliku hooków lub utwórz `frontend/src/query/use-suppliers.ts`:

```typescript
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { getSuppliers, createSupplier } from '../services/supplier.service';
import { SupplierCreatePayload } from '../types/supplier.types';

export const useSuppliers = () =>
  useQuery({
    queryKey: ['suppliers'],
    queryFn: getSuppliers,
  });

export const useCreateSupplier = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: SupplierCreatePayload) => createSupplier(payload),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['suppliers'] }),
  });
};
```

---

#### ZADANIE 0.9 — Frontend: Strona tworzenia PZ (`DeliveryCreatePage` — tryb PZ)

**Kontekst:**
`DeliveryCreatePage.tsx` prawdopodobnie tworzy WZ. Należy albo:
- Dodać tryb PZ do istniejącej strony (query param `?type=PZ`)
- Lub stworzyć osobną stronę `PZCreatePage.tsx`

Rekomendacja: **osobna strona** `PZCreatePage.tsx` — czytelniejsza UX, inna logika (dostawca zamiast klienta).

**Plik do odczytu:** `frontend/src/pages/DeliveryCreatePage.tsx` — wzorzec do skopiowania struktury.

**Nowy plik `frontend/src/pages/PZCreatePage.tsx`:**

Formularz powinien zawierać:
1. **Nagłówek:** "Nowe Przyjęcie Zewnętrzne (PZ)"
2. **Pole Magazyn docelowy** — dropdown MAIN/MOBILE warehouses (Select z `useWarehouses`)
3. **Pole Dostawca** — dropdown (Select z `useSuppliers`) + przycisk "Dodaj nowego dostawcę" (modal lub link do SuppliersPage)
4. **Pole Data dokumentu** — DatePicker, default dzisiaj
5. **Pole Notatki** — textarea opcjonalnie
6. **Tabela pozycji** — dynamiczne dodawanie wierszy:
   - Kolumna: Produkt (autocomplete/Select z products)
   - Kolumna: Ilość planowana (number input)
   - Kolumna: Cena zakupu netto (number input, opcjonalne)
   - Kolumna: Notatka (text input, opcjonalne)
   - Kolumna: Usuń wiersz (przycisk ×)
   - Przycisk "Dodaj pozycję"
7. **Przycisk Zapisz** → `createPZ()` → redirect do `DeliveryDocumentDetailPage` dla nowego PZ

**Zarejestruj route w `App.tsx`:**
```tsx
<Route path="/delivery/pz/new" element={<PZCreatePage />} />
```

**Kryteria weryfikacji:**
- [ ] Formularz waliduje: magazyn wymagany, min. 1 pozycja, ilość > 0
- [ ] Po submit: PZ tworzone w statusie `draft`, redirect do szczegółów
- [ ] Dropdown dostawcy pokazuje listę z bazy, obsługuje brak dostawców (pusty stan)
- [ ] Cena zakupu jest opcjonalna — brak nie blokuje zapisu

---

#### ZADANIE 0.10 — Frontend: Obsługa PZ w `DeliveryDocumentDetailPage`

**Kontekst:**
`DeliveryDocumentDetailPage.tsx` obsługuje WZ/MM/ZW. Dla PZ potrzebne są inne akcje i etykiety.

**Plik do odczytu:** `frontend/src/pages/DeliveryDocumentDetailPage.tsx`

**Zmiany warunkowe w zależności od `document.document_type`:**

```tsx
// Tytuł dokumentu:
const docTypeLabel = {
  WZ: 'Wydanie Zewnętrzne',
  PZ: 'Przyjęcie Zewnętrzne',
  MM: 'Przesunięcie Magazynowe',
  ZW: 'Zwrot',
}[document.document_type] ?? document.document_type;

// Kolumna "Magazyn" w nagłówku:
// WZ: "Z magazynu" → "Do klienta"
// PZ: "Od dostawcy" → "Do magazynu"
// MM: "Z magazynu" → "Do magazynu"
// ZW: "Od klienta" → "Do magazynu"

// Etykieta dostawcy/klienta:
{document.document_type === 'PZ' && document.from_supplier_name && (
  <div>
    <strong>Dostawca:</strong> {document.from_supplier_name}
  </div>
)}

// Kolumna "Cena zakupu" w tabeli pozycji (tylko dla PZ):
{document.document_type === 'PZ' && (
  <th>Cena zakupu netto</th>
)}

// Akcja "Przyjmij towar" (complete) — tylko dla PZ:
{document.document_type === 'PZ' && document.status !== 'delivered' && (
  <button onClick={handleCompletePZ}>
    Przyjmij towar (zakończ PZ)
  </button>
)}

// Akcja "Zakończ dostawę" — tylko dla WZ:
{document.document_type === 'WZ' && document.status === 'in_transit' && (
  <button onClick={handleCompleteWZ}>
    Zakończ dostawę
  </button>
)}
```

**Kryteria weryfikacji:**
- [ ] PZ wyświetla etykietę "Przyjęcie Zewnętrzne" w tytule
- [ ] PZ wyświetla dostawcę (jeśli jest)
- [ ] PZ wyświetla kolumnę "Cena zakupu netto" w tabeli pozycji
- [ ] Przycisk "Przyjmij towar" widoczny dla PZ w statusach `draft`, `saved`, `in_transit`
- [ ] Przycisk "Zakończ dostawę" NIE pojawia się dla PZ
- [ ] Po kliknięciu "Przyjmij towar": status zmienia się na `delivered`, stany rosną

---

#### ZADANIE 0.11 — Frontend: Strony zarządzania dostawcami

**Nowe strony:**

**`frontend/src/pages/SuppliersPage.tsx`** — lista dostawców:
- Tabela: Nazwa | NIP | Miasto | Telefon | Akcje
- Przycisk "Dodaj dostawcę" → link do `SupplierCreatePage`
- Wyszukiwarka po nazwie/NIP

**`frontend/src/pages/SupplierCreatePage.tsx`** — formularz tworzenia:
- Pola: Nazwa (wymagane), NIP, Email, Telefon, Adres, Warunki płatności (dni), Notatki
- Po submit: redirect do SuppliersPage

**Zarejestruj routes w `App.tsx`:**
```tsx
<Route path="/suppliers" element={<SuppliersPage />} />
<Route path="/suppliers/new" element={<SupplierCreatePage />} />
```

**Dodaj do nawigacji** (`frontend/src/components/layout/Navigation.tsx` lub `Sidebar.tsx`):
```tsx
<NavLink to="/suppliers">Dostawcy</NavLink>
```

**Kryteria weryfikacji:**
- [ ] Lista dostawców dostępna pod `/suppliers`
- [ ] Formularz tworzenia dostępny pod `/suppliers/new`
- [ ] Po utworzeniu: dostawca pojawia się na liście
- [ ] Link w nawigacji/sidebarze

---

#### ZADANIE 0.12 — Weryfikacja pełnego flow PZ end-to-end

**Scenariusz testowy do wykonania po implementacji zadań 0.1–0.11:**

```
Krok 1: Sprawdź stan początkowy
  GET /api/warehouses/{MG_id}/stock/
  → Zapamiętaj quantity_available dla produktu X = Q_before

Krok 2: Utwórz dostawcę
  POST /api/suppliers/
  body: {"name": "Mleczarnia Kowalski", "nip": "1234567890"}
  → Zapamiętaj supplier_id

Krok 3: Utwórz PZ
  POST /api/delivery/create-pz/
  body: {
    "to_warehouse": "{MG_id}",
    "issue_date": "2026-05-29",
    "from_supplier": "{supplier_id}",
    "items": [{"product": "{produkt_X_id}", "quantity_planned": 100, "unit_cost": "4.50"}]
  }
  → Zapamiętaj pz_id
  → Sprawdź: status = "draft"

Krok 4: Zakończ PZ (przyjmij towar)
  POST /api/delivery/{pz_id}/complete/
  body: {"items": [{"id": "{item_id}", "quantity_actual": 95}]}
  (dostawca przywiózł 95 zamiast 100)
  → Sprawdź: status = "delivered"

Krok 5: Zweryfikuj stan magazynowy
  GET /api/warehouses/{MG_id}/stock/
  → quantity_available dla produktu X = Q_before + 95  ✓

Krok 6: Zweryfikuj ruch magazynowy
  GET /api/products/stock-movements/?product={produkt_X_id}
  → Pierwszy ruch: movement_type="PURCHASE", quantity=95, reference_type="delivery_document"  ✓

Krok 7: Zweryfikuj partię FIFO (jeśli track_batches=True)
  GET /api/products/{produkt_X_id}/batches/   (jeśli endpoint istnieje)
  → Nowa partia: quantity_remaining=95, unit_cost="4.50"  ✓
```

---

### FAZA 1 — Naprawy krytyczne (aktywne dziury, ryzyko finansowe)

---

#### ZADANIE 1.1 — Weryfikacja i naprawa: ZW → cofnięcie stanu magazynowego

**Status:** AKTYWNA DZIURA — do natychmiastowej weryfikacji

**Kontekst:**
Dokument ZW (Zwrot) jest tworzony przez system gdy klient zwraca towar podczas dostawy lub po niej.
Problem: nie wiadomo czy po zakończeniu dokumentu ZW (`status → delivered`) towar faktycznie wraca na stan magazynowy (`ProductStock.quantity_available`). Jeśli nie wraca — stan magazynowy jest zaniżony, a firma "traci" towar z systemu przy każdym zwrocie.

**Pliki do odczytu (w tej kolejności):**
1. `backend/apps/delivery/services.py` — funkcja `apply_delivery_document_line_updates()` i `create_zw_from_pending_returns()`
2. `backend/apps/delivery/views.py` — akcja `complete` i `save` w `DeliveryDocumentViewSet`
3. `backend/apps/products/models.py` — model `ProductStock` i `StockMovement`

**Co sprawdzić w `services.py`:**
Szukaj bloku obsługującego `document_type == 'ZW'` lub `document_type == DeliveryDocument.TYPE_ZW`.
Sprawdź czy po complete ZW wykonywane są WSZYSTKIE trzy operacje:
```
1. stock.quantity_available += item.quantity_actual  (lub quantity_returned)
2. stock.save()
3. StockMovement.objects.create(movement_type='RETURN', quantity=+X, ...)
```

**Scenariusz A — ZW cofa stan (OK, ale sprawdź szczegóły):**
Zweryfikuj że:
- Używa `to_warehouse` (magazyn do którego wraca towar), nie `from_warehouse`
- `quantity_before` i `quantity_after` są zapisane poprawnie na StockMovement
- `reference_type='delivery_document'` i `reference_id=str(zw_doc.id)` są ustawione
- `OrderItem.quantity_returned` jest aktualizowany

**Scenariusz B — ZW NIE cofa stanu (BŁĄD — napraw):**
Dodaj następującą logikę w `apply_delivery_document_line_updates()` lub w osobnej funkcji `apply_zw_stock_return()`:

```python
def apply_zw_stock_return(zw_document):
    """
    Wywoływana po zmianie statusu ZW na 'delivered'.
    Cofa towar z dokumentu zwrotu z powrotem do magazynu docelowego.
    """
    from apps.products.models import ProductStock, StockMovement

    for item in zw_document.items.all():
        if item.quantity_actual <= 0:
            continue

        # to_warehouse = magazyn do którego wraca towar (zazwyczaj główny lub van)
        warehouse = zw_document.to_warehouse
        if warehouse is None:
            raise ValueError(f"ZW {zw_document.document_number} nie ma ustawionego to_warehouse")

        stock = ProductStock.get_or_create_for(item.product, warehouse)
        qty_before = stock.quantity_available

        stock.quantity_available += item.quantity_actual
        stock.save(update_fields=['quantity_available'])

        StockMovement.objects.create(
            product=item.product,
            warehouse=warehouse,
            company=zw_document.company,
            movement_type='RETURN',
            quantity=item.quantity_actual,           # dodatnia — stan rośnie
            quantity_before=qty_before,
            quantity_after=stock.quantity_available,
            reference_type='delivery_document',
            reference_id=str(zw_document.id),
            notes=f"Zwrot z dokumentu {zw_document.document_number}",
        )

        # Aktualizuj quantity_returned na OrderItem jeśli ZW powiązane z zamówieniem
        if item.order_item is not None:
            item.order_item.quantity_returned = (
                item.order_item.quantity_returned + item.quantity_actual
            )
            item.order_item.save(update_fields=['quantity_returned'])
```

**Gdzie wywołać `apply_zw_stock_return()`:**
W `DeliveryDocumentViewSet` — akcja `complete` lub `save`, w bloku:
```python
if document.document_type == 'ZW' and new_status == 'delivered':
    apply_zw_stock_return(document)
```

**Kryteria weryfikacji:**
- [ ] Po complete ZW: `ProductStock.quantity_available` dla produktu w `to_warehouse` wzrasta o `quantity_actual`
- [ ] Po complete ZW: `StockMovement` z `movement_type='RETURN'` istnieje z poprawnym `reference_id`
- [ ] Po complete ZW: `OrderItem.quantity_returned` jest zaktualizowany (jeśli powiązane z zamówieniem)
- [ ] `quantity_before + quantity_actual == quantity_after` na StockMovement

**Pliki do modyfikacji:**
- `backend/apps/delivery/services.py` — dodać/poprawić funkcję
- `backend/apps/delivery/views.py` — wywołanie w akcji complete/save

---

#### ZADANIE 1.2 — Blokada podwójnej faktury per zamówienie

**Status:** AKTYWNA DZIURA — ryzyko finansowe

**Kontekst:**
`Invoice.order` to ForeignKey bez `unique=True`. Wywołanie `POST /api/invoices/generate-from-order/{order_id}/` dwa razy tworzy dwie aktywne faktury dla tego samego zamówienia. Brak constraint w modelu ani w serializer/view.

**Pliki do odczytu:**
1. `backend/apps/invoices/models.py` — model `Invoice`, pole `order`
2. `backend/apps/invoices/views.py` — akcja `generate_from_order`
3. `backend/apps/invoices/services.py` — funkcja `generate_invoice_from_order()`

**Zmiana 1 — constraint w modelu:**

W `backend/apps/invoices/models.py`, w klasie `Meta` modelu `Invoice`, dodaj:
```python
class Meta:
    constraints = [
        models.UniqueConstraint(
            fields=['company', 'order'],
            condition=models.Q(status__in=['draft', 'issued', 'sent', 'paid']),
            name='unique_active_invoice_per_order'
        )
    ]
```

Następnie wygeneruj i wykonaj migrację:
```bash
python manage.py makemigrations invoices
python manage.py migrate
```

**Zmiana 2 — guard w serwisie (zabezpieczenie warstwy aplikacyjnej):**

W `backend/apps/invoices/services.py`, na początku funkcji `generate_invoice_from_order()`:
```python
def generate_invoice_from_order(order, **kwargs):
    # Sprawdź czy aktywna faktura już istnieje
    existing = Invoice.objects.filter(
        company=order.company,
        order=order,
        status__in=['draft', 'issued', 'sent', 'paid']
    ).first()
    if existing:
        raise ValidationError(
            f"Zamówienie {order.order_number} ma już aktywną fakturę "
            f"{existing.invoice_number} (status: {existing.status}). "
            f"Anuluj istniejącą fakturę przed wygenerowaniem nowej."
        )
    # ... reszta funkcji bez zmian
```

**Uwaga dla LLM:** Jeśli w przyszłości ma być obsługiwana wielofakturowość (np. częściowe dostawy → wiele FV), constraint musi być usunięty i zastąpiony logiką biznesową. Na razie jest to zabezpieczenie MVP.

**Kryteria weryfikacji:**
- [ ] `POST generate-from-order/{id}/` wywołane drugi raz zwraca HTTP 400 z czytelnym komunikatem
- [ ] Migracja przechodzi bez błędów na czystej bazie
- [ ] Istniejące anulowane (`cancelled`) faktury NIE blokują tworzenia nowej

---

#### ZADANIE 1.3 — Blokada wystawienia FV bez dostarczonego WZ

**Status:** LOGICZNA DZIURA — naruszenie zasady "wydaj towar przed fakturowaniem"

**Kontekst:**
`Invoice.delivery_document` jest nullable. Akcja `POST /api/invoices/{id}/issue/` nie sprawdza czy dla zamówienia istnieje chociaż jedno WZ w statusie `delivered`. Można wystawić fakturę za towar który nie wyszedł z magazynu.

**Pliki do odczytu:**
1. `backend/apps/invoices/views.py` — akcja `issue` w `InvoiceViewSet`
2. `backend/apps/delivery/models.py` — model `DeliveryDocument`, pole `status` i `document_type`

**Zmiana — dodaj walidację w akcji `issue`:**

W `backend/apps/invoices/views.py`, w metodzie `issue` (akcja `@action`):
```python
@action(detail=True, methods=['post'])
def issue(self, request, pk=None):
    invoice = self.get_object()

    # Walidacja: musi istnieć WZ delivered dla tego zamówienia
    if invoice.order:
        has_delivered_wz = invoice.order.delivery_documents.filter(
            document_type='WZ',
            status='delivered'
        ).exists()
        if not has_delivered_wz:
            return Response(
                {
                    "detail": (
                        f"Nie można wystawić faktury dla zamówienia "
                        f"{invoice.order.order_number}. "
                        f"Brak zatwierdzonego dokumentu WZ (wydania towaru). "
                        f"Zakończ dostawę przed wystawieniem faktury."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST
            )

    # ... reszta istniejącej logiki issue bez zmian
```

**Uwaga:** Sprawdź jak `delivery_documents` jest dostępne na modelu `Order` — może być `order.delivery_documents` lub `order.deliverydocument_set` zależnie od `related_name` w modelu `DeliveryDocument`.

**Kryteria weryfikacji:**
- [ ] `POST /api/invoices/{id}/issue/` dla zamówienia bez WZ zwraca HTTP 400
- [ ] `POST /api/invoices/{id}/issue/` dla zamówienia z WZ `in_transit` zwraca HTTP 400
- [ ] `POST /api/invoices/{id}/issue/` dla zamówienia z WZ `delivered` przechodzi normalnie

---

### FAZA 2 — Widoczność magazynowa (natychmiastowa wartość operacyjna)

---

#### ZADANIE 2.1 — Backend: Endpoint stanów produktów dla magazynu

**Status:** BRAK — kluczowe dla operacji magazynowych

**Kontekst:**
`WarehouseDetailPage.tsx` istnieje w frontendzie ale nie pokazuje żadnych stanów. Tabela `ProductStock` zawiera stany per (produkt, magazyn) ale nie ma dedykowanego endpointu zwracającego te dane.

**Pliki do odczytu:**
1. `backend/apps/products/models.py` — modele `ProductStock`, `Product`, `Warehouse`
2. `backend/apps/products/views.py` — `WarehouseViewSet` lub `ProductViewSet`
3. `backend/apps/products/serializers.py` — sprawdź istniejące serializery

**Zmiana 1 — Nowy serializer `WarehouseStockItemSerializer`:**

W `backend/apps/products/serializers.py`, dodaj:
```python
class WarehouseStockItemSerializer(serializers.ModelSerializer):
    product_id = serializers.UUIDField(source='product.id', read_only=True)
    product_name = serializers.CharField(source='product.name', read_only=True)
    product_sku = serializers.CharField(source='product.sku', read_only=True)
    product_unit = serializers.CharField(source='product.unit', read_only=True)
    min_stock_alert = serializers.DecimalField(
        source='product.min_stock_alert',
        max_digits=10, decimal_places=3, read_only=True
    )
    is_below_minimum = serializers.SerializerMethodField()

    class Meta:
        model = ProductStock
        fields = [
            'id', 'product_id', 'product_name', 'product_sku', 'product_unit',
            'quantity_available', 'quantity_reserved', 'quantity_total',
            'min_stock_alert', 'is_below_minimum',
        ]

    def get_is_below_minimum(self, obj):
        if obj.product.min_stock_alert is None or obj.product.min_stock_alert == 0:
            return False
        return obj.quantity_total < obj.product.min_stock_alert
```

**Zmiana 2 — Nowa akcja w `WarehouseViewSet`:**

W `backend/apps/products/views.py`, w klasie `WarehouseViewSet`, dodaj:
```python
@action(detail=True, methods=['get'], url_path='stock')
def stock(self, request, pk=None):
    """
    Zwraca listę ProductStock dla danego magazynu.
    Query params:
      ?below_minimum=true  — tylko produkty poniżej stanu minimalnego
      ?search=nazwa        — filtr po nazwie produktu
    """
    warehouse = self.get_object()

    qs = ProductStock.objects.filter(
        warehouse=warehouse,
        company=request.company,
        product__is_active=True,
    ).select_related('product').order_by('product__name')

    # Filtr: tylko poniżej minimum
    below_minimum = request.query_params.get('below_minimum', '').lower()
    if below_minimum == 'true':
        # Filtruj w Pythonie (min_stock_alert może być NULL)
        qs = [
            s for s in qs
            if s.product.min_stock_alert
            and s.quantity_total < s.product.min_stock_alert
        ]

    # Filtr: szukaj po nazwie
    search = request.query_params.get('search', '').strip()
    if search:
        qs = qs.filter(product__name__icontains=search)

    serializer = WarehouseStockItemSerializer(qs, many=True)
    return Response(serializer.data)
```

**Sprawdź czy `request.company` jest dostępne** — może być `request.user.current_company` lub przez middleware. Dostosuj do wzorca używanego w innych widokach w tym projekcie.

**Kryteria weryfikacji:**
- [ ] `GET /api/warehouses/{id}/stock/` zwraca listę z polami: `product_name`, `quantity_available`, `quantity_reserved`, `quantity_total`, `is_below_minimum`
- [ ] `GET /api/warehouses/{id}/stock/?below_minimum=true` zwraca tylko produkty z `quantity_total < min_stock_alert`
- [ ] Produkty z `is_active=False` nie pojawiają się w wynikach
- [ ] Produkty bez `min_stock_alert` mają `is_below_minimum: false`

---

#### ZADANIE 2.2 — Frontend: WarehouseDetailPage ze stanami produktów

**Status:** STRONA ISTNIEJE — wymaga rozbudowy o tabelę stanów

**Kontekst:**
Plik `frontend/src/pages/WarehouseDetailPage.tsx` istnieje. Należy dodać do niego sekcję z tabelą stanów produktów korzystając z nowego endpointu `GET /api/warehouses/{id}/stock/`.

**Pliki do odczytu:**
1. `frontend/src/pages/WarehouseDetailPage.tsx` — aktualny kod strony
2. `frontend/src/services/warehouse.service.ts` — istniejące metody serwisu
3. `frontend/src/query/use-delivery.ts` — wzorzec jak inne hooki są budowane (do wzorowania)
4. `frontend/src/types/warehouse.types.ts` lub `frontend/src/types/product.types.ts` — istniejące typy

**Zmiana 1 — Nowy typ `WarehouseStockItem`:**

W `frontend/src/types/warehouse.types.ts` (lub `product.types.ts` — dodaj gdzie pasuje do kontekstu), dodaj:
```typescript
export interface WarehouseStockItem {
  id: string;
  product_id: string;
  product_name: string;
  product_sku: string | null;
  product_unit: string;
  quantity_available: number;
  quantity_reserved: number;
  quantity_total: number;
  min_stock_alert: number | null;
  is_below_minimum: boolean;
}
```

**Zmiana 2 — Nowa metoda w `warehouse.service.ts`:**

W `frontend/src/services/warehouse.service.ts`, dodaj:
```typescript
export const getWarehouseStock = async (
  warehouseId: string,
  params?: { below_minimum?: boolean; search?: string }
): Promise<WarehouseStockItem[]> => {
  const response = await api.get(`/warehouses/${warehouseId}/stock/`, { params });
  return response.data;
};
```

**Zmiana 3 — Nowy hook `useWarehouseStock`:**

Dodaj do odpowiedniego pliku hooków (np. utwórz `frontend/src/query/use-warehouses.ts` lub dodaj do istniejącego):
```typescript
import { useQuery } from '@tanstack/react-query';
import { getWarehouseStock } from '../services/warehouse.service';
import { WarehouseStockItem } from '../types/warehouse.types';

export const useWarehouseStock = (
  warehouseId: string,
  params?: { below_minimum?: boolean; search?: string }
) => {
  return useQuery<WarehouseStockItem[]>({
    queryKey: ['warehouse-stock', warehouseId, params],
    queryFn: () => getWarehouseStock(warehouseId, params),
    enabled: !!warehouseId,
  });
};
```

**Zmiana 4 — Rozbudowa `WarehouseDetailPage.tsx`:**

Odczytaj aktualny kod strony, następnie dodaj sekcję `StockTable` po istniejących informacjach o magazynie. Poniżej wzorzec komponentu do wstawienia:

```tsx
// Stany lokalne (dodaj do istniejącego komponentu):
const [stockSearch, setStockSearch] = useState('');
const [showBelowMinimum, setShowBelowMinimum] = useState(false);

// Hook (dodaj po istniejących hookach):
const { data: stockItems, isLoading: stockLoading } = useWarehouseStock(warehouseId, {
  below_minimum: showBelowMinimum || undefined,
  search: stockSearch || undefined,
});

// Sekcja do wstawienia w JSX (po informacjach o magazynie):
<section>
  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
    <h2>Stan magazynowy</h2>
    <div>
      <input
        type="text"
        placeholder="Szukaj produktu..."
        value={stockSearch}
        onChange={e => setStockSearch(e.target.value)}
      />
      <label>
        <input
          type="checkbox"
          checked={showBelowMinimum}
          onChange={e => setShowBelowMinimum(e.target.checked)}
        />
        Tylko poniżej minimum
      </label>
    </div>
  </div>

  {stockLoading ? (
    <p>Ładowanie stanów...</p>
  ) : (
    <table>
      <thead>
        <tr>
          <th>Produkt</th>
          <th>SKU</th>
          <th>Dostępne</th>
          <th>Zarezerwowane</th>
          <th>Razem</th>
          <th>Min. stan</th>
          <th>Status</th>
        </tr>
      </thead>
      <tbody>
        {stockItems?.map(item => (
          <tr key={item.id} style={item.is_below_minimum ? { background: '#fff3cd' } : {}}>
            <td>{item.product_name}</td>
            <td>{item.product_sku ?? '—'}</td>
            <td>{item.quantity_available} {item.product_unit}</td>
            <td>{item.quantity_reserved} {item.product_unit}</td>
            <td><strong>{item.quantity_total} {item.product_unit}</strong></td>
            <td>{item.min_stock_alert ?? '—'}</td>
            <td>
              {item.is_below_minimum
                ? <span style={{ color: 'red' }}>⚠ Poniżej minimum</span>
                : <span style={{ color: 'green' }}>OK</span>
              }
            </td>
          </tr>
        ))}
        {stockItems?.length === 0 && (
          <tr><td colSpan={7}>Brak produktów w tym magazynie</td></tr>
        )}
      </tbody>
    </table>
  )}
</section>
```

**Uwaga dla LLM:** Dopasuj styling i komponenty do istniejącego design systemu w projekcie (Tailwind / CSS Modules / MUI — odczytaj inne strony żeby ustalić konwencję).

**Kryteria weryfikacji:**
- [ ] `WarehouseDetailPage` wyświetla tabelę produktów z kolumnami: Produkt, Dostępne, Zarezerwowane, Razem, Min, Status
- [ ] Produkty poniżej `min_stock_alert` są wyróżnione wizualnie (kolor/ikona)
- [ ] Filtr "poniżej minimum" działa i odświeża tabelę
- [ ] Wyszukiwarka filtruje po nazwie produktu
- [ ] Tabela ładuje się bez błędów gdy magazyn nie ma żadnych produktów

---

#### ZADANIE 2.3 — Backend: Endpoint historii ruchów per produkt

**Status:** MODEL ISTNIEJE — brak endpointu i UI

**Kontekst:**
`StockMovement` w `backend/apps/products/models.py` jest bogato wypełniany przez system (RESERVATION, SALE, RETURN, TRANSFER, DAMAGE, ADJUSTMENT). Nie ma jednak endpointu który pozwala przeglądać tę historię per produkt lub per magazyn. Bez tego magazynier nie może odpowiedzieć na pytanie "kiedy i dlaczego stan spadł".

**Pliki do odczytu:**
1. `backend/apps/products/models.py` — model `StockMovement` (pola: movement_type, quantity, quantity_before, quantity_after, reference_type, reference_id, notes, created_at, created_by)
2. `backend/apps/products/views.py` — sprawdź czy `StockMovementViewSet` istnieje
3. `backend/apps/products/serializers.py` — sprawdź czy serializer dla StockMovement istnieje

**Jeśli `StockMovementViewSet` NIE istnieje — utwórz:**

W `backend/apps/products/serializers.py`:
```python
class StockMovementSerializer(serializers.ModelSerializer):
    created_by_name = serializers.CharField(source='created_by.email', read_only=True, default=None)
    product_name = serializers.CharField(source='product.name', read_only=True)
    warehouse_name = serializers.CharField(source='warehouse.name', read_only=True)

    class Meta:
        model = StockMovement
        fields = [
            'id', 'product_id', 'product_name', 'warehouse_id', 'warehouse_name',
            'movement_type', 'quantity', 'quantity_before', 'quantity_after',
            'reference_type', 'reference_id', 'notes',
            'created_at', 'created_by_name',
        ]
        read_only_fields = fields
```

W `backend/apps/products/views.py`:
```python
class StockMovementViewSet(viewsets.ReadOnlyModelViewSet):
    serializer_class = StockMovementSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [DjangoFilterBackend, OrderingFilter]
    ordering_fields = ['created_at']
    ordering = ['-created_at']

    def get_queryset(self):
        company = self.request.user.current_company
        qs = StockMovement.objects.filter(company=company).select_related(
            'product', 'warehouse', 'created_by'
        )

        # Filtry opcjonalne
        product_id = self.request.query_params.get('product')
        warehouse_id = self.request.query_params.get('warehouse')
        movement_type = self.request.query_params.get('type')
        date_from = self.request.query_params.get('date_from')   # format: YYYY-MM-DD
        date_to = self.request.query_params.get('date_to')

        if product_id:
            qs = qs.filter(product_id=product_id)
        if warehouse_id:
            qs = qs.filter(warehouse_id=warehouse_id)
        if movement_type:
            qs = qs.filter(movement_type=movement_type)
        if date_from:
            qs = qs.filter(created_at__date__gte=date_from)
        if date_to:
            qs = qs.filter(created_at__date__lte=date_to)

        return qs
```

**Zarejestruj router w `backend/apps/products/urls.py`:**
```python
router.register(r'stock-movements', StockMovementViewSet, basename='stock-movement')
```

**Endpoint po rejestracji:** `GET /api/products/stock-movements/?product={uuid}&warehouse={uuid}&type=SALE&date_from=2026-01-01`

**Kryteria weryfikacji:**
- [ ] `GET /api/products/stock-movements/` zwraca listę ruchów dla aktywnej firmy
- [ ] Filtr `?product={id}` zwraca tylko ruchy dla danego produktu
- [ ] Filtr `?warehouse={id}` zwraca tylko ruchy dla danego magazynu
- [ ] Wyniki posortowane od najnowszego (`-created_at`)
- [ ] Pole `reference_id` zawiera UUID dokumentu źródłowego (WZ, ZAM itd.)

---

#### ZADANIE 2.4 — Frontend: Historia ruchów w ProductEditPage

**Status:** BRAK UI — dane są w API, brak wyświetlania

**Kontekst:**
Po zadaniu 2.3 działa endpoint historii ruchów. Teraz dodajemy zakładkę "Historia ruchów" do `ProductEditPage.tsx` (lub `ProductDetailPage.tsx` jeśli taki istnieje).

**Pliki do odczytu:**
1. `frontend/src/pages/ProductEditPage.tsx` — aktualny kod
2. `frontend/src/services/product.service.ts` — istniejące metody

**Zmiana 1 — Nowy typ:**
```typescript
// frontend/src/types/product.types.ts
export interface StockMovement {
  id: string;
  product_id: string;
  product_name: string;
  warehouse_id: string;
  warehouse_name: string;
  movement_type: 'PURCHASE' | 'SALE' | 'RETURN' | 'ADJUSTMENT' | 'TRANSFER' | 'DAMAGE' | 'RESERVATION' | 'UNRESERVATION';
  quantity: number;
  quantity_before: number;
  quantity_after: number;
  reference_type: string | null;
  reference_id: string | null;
  notes: string;
  created_at: string;
  created_by_name: string | null;
}
```

**Zmiana 2 — Nowa metoda w `product.service.ts`:**
```typescript
export const getStockMovements = async (params: {
  product?: string;
  warehouse?: string;
  type?: string;
  date_from?: string;
  date_to?: string;
}): Promise<StockMovement[]> => {
  const response = await api.get('/products/stock-movements/', { params });
  return response.data;
};
```

**Zmiana 3 — Sekcja w `ProductEditPage.tsx`:**

Po odczytaniu aktualnego kodu, dodaj sekcję z historią ruchów (zakładka lub accordion po formularzu edycji):

```tsx
// Etykiety polskie dla typów ruchów
const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  PURCHASE: 'Zakup / Przyjęcie',
  SALE: 'Sprzedaż / Wydanie',
  RETURN: 'Zwrot',
  ADJUSTMENT: 'Korekta ręczna',
  TRANSFER: 'Przesunięcie MM',
  DAMAGE: 'Uszkodzenie / Likwidacja',
  RESERVATION: 'Rezerwacja (ZAM)',
  UNRESERVATION: 'Zwolnienie rezerwacji',
};

// Kolory dla typów ruchów
const MOVEMENT_TYPE_COLORS: Record<string, string> = {
  PURCHASE: 'green',
  SALE: 'red',
  RETURN: 'blue',
  ADJUSTMENT: 'orange',
  TRANSFER: 'purple',
  DAMAGE: 'darkred',
  RESERVATION: 'goldenrod',
  UNRESERVATION: 'gray',
};

// Tabela historii (dodaj do JSX):
<section>
  <h3>Historia ruchów magazynowych</h3>
  <table>
    <thead>
      <tr>
        <th>Data</th>
        <th>Typ ruchu</th>
        <th>Magazyn</th>
        <th>Ilość</th>
        <th>Stan przed</th>
        <th>Stan po</th>
        <th>Dokument źródłowy</th>
        <th>Notatka</th>
      </tr>
    </thead>
    <tbody>
      {movements?.map(m => (
        <tr key={m.id}>
          <td>{new Date(m.created_at).toLocaleString('pl-PL')}</td>
          <td>
            <span style={{ color: MOVEMENT_TYPE_COLORS[m.movement_type] }}>
              {MOVEMENT_TYPE_LABELS[m.movement_type] ?? m.movement_type}
            </span>
          </td>
          <td>{m.warehouse_name}</td>
          <td style={{ color: m.quantity >= 0 ? 'green' : 'red', fontWeight: 'bold' }}>
            {m.quantity >= 0 ? '+' : ''}{m.quantity}
          </td>
          <td>{m.quantity_before}</td>
          <td>{m.quantity_after}</td>
          <td>
            {m.reference_type && m.reference_id
              ? `${m.reference_type} #${m.reference_id.slice(0, 8)}...`
              : '—'}
          </td>
          <td>{m.notes || '—'}</td>
        </tr>
      ))}
    </tbody>
  </table>
</section>
```

**Kryteria weryfikacji:**
- [ ] Historia ruchów widoczna na stronie produktu
- [ ] Ruchy z dodatnią ilością (PURCHASE, RETURN) wyświetlane na zielono
- [ ] Ruchy z ujemną ilością (SALE, DAMAGE) wyświetlane na czerwono
- [ ] Tabela sortowana od najnowszego ruchu

---

### FAZA 3 — Kontrola statusów zamówień (spójność danych)

---

#### ZADANIE 3.1 — Dodanie statusu `partially_delivered` do modelu Order

**Status:** BRAK STATUSU — zamówienia częściowe niewidoczne

**Kontekst:**
Gdy WZ dostarcza mniej towaru niż zamówiono (np. 8 z 10 szt), zamówienie powinno przejść w status `partially_delivered`. Obecnie system nie ma tego statusu więc nie ma sygnału że brakuje 2 szt do dostarczenia.

**Pliki do modyfikacji:**
1. `backend/apps/orders/models.py` — dodać status do `ORDER_STATUS`
2. `backend/apps/delivery/services.py` — logika przejścia statusu po complete WZ
3. `backend/apps/orders/serializers.py` — sprawdź czy status jest w choices
4. Frontend: `frontend/src/types/order.types.ts` — dodać do `OrderStatus` type

**Zmiana 1 — Model `Order` (`backend/apps/orders/models.py`):**

Znajdź definicję `ORDER_STATUS` lub `status` field i dodaj `'partially_delivered'`:
```python
ORDER_STATUS = [
    ('draft', 'Szkic'),
    ('confirmed', 'Potwierdzone'),
    ('in_preparation', 'W przygotowaniu'),
    ('loaded', 'Załadowane'),
    ('in_delivery', 'W dostawie'),
    ('partially_delivered', 'Częściowo dostarczone'),  # NOWE
    ('delivered', 'Dostarczone'),
    ('invoiced', 'Zafakturowane'),
    ('cancelled', 'Anulowane'),
]
```

Następnie: `python manage.py makemigrations orders && python manage.py migrate`

**Zmiana 2 — Logika w `services.py` po complete WZ:**

W `backend/apps/delivery/services.py`, po zakończeniu WZ (w miejscu gdzie aktualizowany jest status zamówienia), zamień/dodaj:

```python
def update_order_delivery_status(order):
    """
    Wywoływana po każdym complete WZ powiązanym z zamówieniem.
    Ustawia status zamówienia na podstawie sumy dostarczonych ilości.
    """
    items = order.items.all()
    total_qty = sum(item.quantity for item in items)
    delivered_qty = sum(item.quantity_delivered for item in items)

    if delivered_qty == 0:
        pass  # status bez zmian — w dostawie lub inny
    elif delivered_qty < total_qty:
        order.status = 'partially_delivered'
        order.save(update_fields=['status'])
    else:
        order.status = 'delivered'
        order.delivered_at = timezone.now()
        order.save(update_fields=['status', 'delivered_at'])
```

**Zmiana 3 — Frontend typ (`frontend/src/types/order.types.ts`):**
```typescript
export type OrderStatus =
  | 'draft'
  | 'confirmed'
  | 'in_preparation'
  | 'loaded'
  | 'in_delivery'
  | 'partially_delivered'   // NOWE
  | 'delivered'
  | 'invoiced'
  | 'cancelled';
```

**Zmiana 4 — Etykieta i kolor w UI:**

Znajdź w frontendzie miejsce gdzie status zamówienia jest wyświetlany (prawdopodobnie `OrdersPage.tsx` lub helper/utils). Dodaj:
```typescript
const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  // ... istniejące wpisy ...
  partially_delivered: 'Częściowo dostarczone',
};

const ORDER_STATUS_COLORS: Record<OrderStatus, string> = {
  // ... istniejące wpisy ...
  partially_delivered: 'orange',
};
```

**Kryteria weryfikacji:**
- [ ] Po complete WZ z `quantity_actual < quantity_planned` → `order.status = 'partially_delivered'`
- [ ] Po complete WZ z `quantity_actual == quantity_planned` → `order.status = 'delivered'`
- [ ] Status `partially_delivered` widoczny na liście zamówień z wyróżnieniem wizualnym (np. pomarańczowy)
- [ ] Filtr na liście zamówień obsługuje nowy status

---

#### ZADANIE 3.2 — Wyświetlenie powiązanych WZ w OrderDetailPage

**Status:** BRAK — relacja istnieje w bazie, brak widoku w UI

**Kontekst:**
Zamówienie może mieć wiele dokumentów WZ (np. częściowe dostawy). `OrderDetailPage.tsx` nie pokazuje listy tych dokumentów. Użytkownik nie wie czy i które WZ zostały wystawione dla zamówienia.

**Pliki do odczytu:**
1. `frontend/src/pages/OrderDetailPage.tsx` — aktualny kod
2. `frontend/src/services/delivery.service.ts` — metody do pobierania WZ
3. `frontend/src/types/delivery.types.ts` — typy DeliveryDocument

**Zmiana — Dodaj sekcję "Dokumenty dostawy" w `OrderDetailPage.tsx`:**

Po odczytaniu kodu, dodaj sekcję z listą WZ powiązanych z zamówieniem:
```tsx
// Pobierz WZ dla zamówienia (filtr po order_id przez delivery service):
const { data: deliveryDocs } = useQuery({
  queryKey: ['delivery-docs', 'for-order', orderId],
  queryFn: () => deliveryService.getDeliveryDocuments({ order: orderId }),
});

// Oblicz sumy:
const totalOrdered = order?.items?.reduce((s, i) => s + i.quantity, 0) ?? 0;
const totalDelivered = order?.items?.reduce((s, i) => s + i.quantity_delivered, 0) ?? 0;

// JSX:
<section>
  <h3>Dokumenty WZ ({deliveryDocs?.length ?? 0})</h3>
  {deliveryDocs?.map(doc => (
    <div key={doc.id}>
      <a href={`/delivery/${doc.id}`}>{doc.document_number}</a>
      <span>{doc.status}</span>
      <span>{doc.issue_date}</span>
    </div>
  ))}
  <div>
    Łącznie dostarczone: <strong>{totalDelivered} / {totalOrdered}</strong>
    {totalDelivered < totalOrdered && (
      <span style={{ color: 'orange' }}>
        (brakuje: {totalOrdered - totalDelivered} szt)
      </span>
    )}
  </div>
</section>
```

**Uwaga:** Sprawdź czy `deliveryService.getDeliveryDocuments()` obsługuje filtr `?order={id}`. Jeśli nie — dodaj parametr do metody serwisu.

**Kryteria weryfikacji:**
- [ ] Lista WZ widoczna na OrderDetailPage
- [ ] Kliknięcie na numer WZ przenosi do szczegółów dokumentu
- [ ] Wyświetlana suma `dostarczone / zamówione`
- [ ] Gdy `dostarczone < zamówione` — ostrzeżenie o brakującej ilości

---

### FAZA 4 — Kontrola negatywnych stanów

---

#### ZADANIE 4.1 — Hard block przy potwierdzaniu zamówienia gdy brak stanu

**Status:** LUKA BEZPIECZEŃSTWA — `allow_negative_stock` bez egzekwowania

**Kontekst:**
`Order.confirm()` w `backend/apps/orders/models.py` sprawdza stan przed rezerwacją ale `allow_negative_stock=True` na magazynie obchodzi blokadę. Należy egzekwować blokadę gdy magazyn ma `allow_negative_stock=False`.

**Pliki do odczytu:**
1. `backend/apps/orders/models.py` — metoda `confirm()` lub logika w serwisie
2. `backend/apps/products/models.py` — model `Warehouse` (pole `allow_negative_stock`), `ProductStock`

**Zmiana — W metodzie `confirm()` na modelu `Order` lub w `OrderViewSet.confirm` akcji:**

```python
def confirm(self):
    """Przejście draft → confirmed z rezerwacją stanu."""
    if self.status != 'draft':
        raise ValidationError("Tylko zamówienia w statusie 'draft' mogą być potwierdzone.")

    # Sprawdź główny magazyn firmy (MAIN type)
    from apps.products.models import Warehouse, ProductStock
    main_warehouse = Warehouse.objects.filter(
        company=self.company,
        warehouse_type='MAIN',
        is_active=True
    ).first()

    if main_warehouse is None:
        raise ValidationError("Nie znaleziono aktywnego magazynu głównego (MAIN) dla tej firmy.")

    # Walidacja stanów przed rezerwacją
    errors = []
    for item in self.items.all():
        stock = ProductStock.get_or_create_for(item.product, main_warehouse)
        if stock.quantity_available < item.quantity:
            if not main_warehouse.allow_negative_stock:
                errors.append(
                    f"{item.product.name}: dostępne {stock.quantity_available} {item.product.unit}, "
                    f"wymagane {item.quantity} {item.product.unit}"
                )

    if errors:
        raise ValidationError(
            "Niewystarczający stan magazynowy:\n" + "\n".join(errors)
        )

    # ... reszta logiki rezerwacji (istniejąca)
```

**Kryteria weryfikacji:**
- [ ] Potwierdzenie zamówienia gdy stan = 0 i `allow_negative_stock=False` → HTTP 400 z listą brakujących produktów
- [ ] Potwierdzenie zamówienia gdy stan = 0 i `allow_negative_stock=True` → przechodzi (legacy behavior)
- [ ] Komunikat błędu zawiera nazwę produktu, dostępną ilość i wymaganą ilość

---

### FAZA 5 — Dashboard operacyjny (po fazach 1-4)

---

#### ZADANIE 5.1 — Backend: Endpoint `/api/dashboard/summary/`

**Status:** BRAK — do zbudowania od zera

**Kontekst:**
Brak strony głównej pokazującej co trzeba zrobić. Wszyscy użytkownicy trafiają na listę zamówień bez orientacji w sytuacji operacyjnej dnia.

**Pliki do odczytu:**
1. `backend/config/urls.py` — gdzie rejestrować nowy URL
2. `backend/apps/` — sprawdź czy istnieje aplikacja `reporting` lub `dashboard`
3. Wzorzec jak inne viewsety są zbudowane

**Nowy widok (dodaj do `backend/apps/reporting/views.py` lub nowej aplikacji):**

```python
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django.utils import timezone
from django.db.models import Sum, Count, Q

class DashboardSummaryView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        company = request.user.current_company
        today = timezone.now().date()

        # Zamówienia do potwierdzenia (draft)
        orders_pending = Order.objects.filter(
            company=company, status='draft'
        ).count()

        # WZ w trakcie (in_transit)
        wz_in_transit = DeliveryDocument.objects.filter(
            company=company, document_type='WZ', status='in_transit'
        ).count()

        # Faktury przeterminowane
        invoices_overdue = Invoice.objects.filter(
            company=company,
            status__in=['issued', 'sent'],
            due_date__lt=today
        ).aggregate(
            count=Count('id'),
            total=Sum('total_gross')
        )

        # Trasy van dziś
        van_routes_today = VanRoute.objects.filter(
            company=company,
            date=today,
            status__in=['LOADING', 'IN_PROGRESS', 'SETTLING']
        ).values('id', 'driver_name', 'van_name', 'status')

        # Niskie stany (poniżej min_stock_alert)
        low_stock = ProductStock.objects.filter(
            company=company,
            product__is_active=True,
            product__min_stock_alert__isnull=False,
        ).select_related('product', 'warehouse').filter(
            quantity_total__lt=models.F('product__min_stock_alert')
        ).values(
            'product__name', 'warehouse__name',
            'quantity_available', 'product__min_stock_alert'
        )[:10]  # max 10 alertów

        return Response({
            'orders_pending_confirmation': orders_pending,
            'wz_in_transit': wz_in_transit,
            'invoices_overdue': {
                'count': invoices_overdue['count'] or 0,
                'total_gross': str(invoices_overdue['total'] or 0),
            },
            'van_routes_today': list(van_routes_today),
            'low_stock_alerts': list(low_stock),
            'date': str(today),
        })
```

**Zarejestruj URL w `backend/config/urls.py`:**
```python
path('api/dashboard/summary/', DashboardSummaryView.as_view(), name='dashboard-summary'),
```

**Kryteria weryfikacji:**
- [ ] `GET /api/dashboard/summary/` zwraca HTTP 200 z wszystkimi kluczami
- [ ] `orders_pending_confirmation` to liczba zamówień w statusie `draft`
- [ ] `invoices_overdue.total_gross` jest stringiem (Decimal serialization)
- [ ] Endpoint nie trwa dłużej niż 500ms (sprawdź N+1 queries)

---

#### ZADANIE 5.2 — Frontend: DashboardPage (`/`)

**Status:** BRAK — do zbudowania

**Kontekst:**
Użytkownicy po zalogowaniu powinni widzieć dashboard operacyjny jako stronę główną. Sprawdź `frontend/src/App.tsx` — ustal który route to `/` i co teraz wyświetla.

**Pliki do odczytu:**
1. `frontend/src/App.tsx` — routing, co jest na `/`
2. `frontend/src/components/layout/AppLayout.tsx` lub `Sidebar.tsx` — nawigacja
3. `frontend/src/services/` — wzorzec serwisów

**Nowy plik `frontend/src/pages/DashboardPage.tsx`:**

Utwórz nową stronę z widgetami:
- Widget "Zamówienia do potwierdzenia" — liczba + link do listy zamówień z filtrem `status=draft`
- Widget "WZ w trasie" — liczba + link do listy dostaw z filtrem `status=in_transit`
- Widget "Zaległe faktury" — liczba + kwota + link do listy faktur z filtrem `status=overdue`
- Widget "Niskie stany" — lista produktów poniżej minimum + link do WarehouseDetailPage
- Widget "Trasy van dziś" — lista aktywnych tras z statusem

**Podłącz nowy route w `App.tsx`:**
```tsx
<Route path="/" element={<DashboardPage />} />
```

**Kryteria weryfikacji:**
- [ ] Strona główna (`/`) pokazuje dashboard po zalogowaniu
- [ ] Każdy widget jest klikalny i przenosi do właściwej sekcji z filtrem
- [ ] Niskie stany wyświetlają nazwę produktu, magazyn, aktualny stan i minimum
- [ ] Dashboard ładuje się jednym requestem do `/api/dashboard/summary/`

---

### LEGENDA STATUSÓW ZADAŃ

| Symbol | Znaczenie |
|--------|-----------|
| **AKTYWNA DZIURA** | Bug lub brakująca walidacja która może powodować błędne dane teraz |
| **LOGICZNA DZIURA** | Brak reguły biznesowej — system nie blokuje nieprawidłowych operacji |
| **BRAK UI** | Dane/logika w backendzie, brak wyświetlania w frontendzie |
| **BRAK** | Funkcjonalność do zbudowania od zera |
| **MODEL ISTNIEJE** | Struktura danych gotowa, brak logiki/endpointów |

---

### KOLEJNOŚĆ WYKONANIA (rekomendowana)

```
FAZA 0 (PZ — fundament przyjęć towarowych):
  0.1  → Model Supplier                      [backend: nowa aplikacja]
  0.2  → Pola PZ na DeliveryDocument/Item    [backend: models.py + migracja]
  0.3  → Service apply_pz_receipt()          [backend: services.py]
  0.4  → Akcje PZ w DeliveryDocumentViewSet  [backend: views.py]
  0.5  → Serializery PZ                      [backend: serializers.py]
  0.6  → Typy TypeScript Supplier + PZ       [frontend: types/]
  0.7  → Serwis Supplier + metoda createPZ   [frontend: services/]
  0.8  → React Query hooki Supplier          [frontend: query/]
  0.9  → PZCreatePage                        [frontend: pages/]
  0.10 → PZ w DeliveryDocumentDetailPage     [frontend: pages/]
  0.11 → SuppliersPage + SupplierCreatePage  [frontend: pages/]
  0.12 → Test end-to-end całego flow PZ      [weryfikacja]

FAZA 1 (naprawa aktywnych dziur):
  1.1 → ZW cofnięcie stanu          [backend: services.py]
  1.2 → Blokada podwójnej FV        [backend: models.py + services.py + migracja]
  1.3 → Blokada FV bez WZ           [backend: views.py]

FAZA 2 (widoczność — natychmiastowa wartość):
  2.1 → Endpoint /warehouses/{id}/stock/     [backend]
  2.2 → WarehouseDetailPage ze stanami       [frontend]
  2.3 → Endpoint /stock-movements/           [backend]
  2.4 → Historia ruchów w ProductEditPage    [frontend]

FAZA 3 (spójność statusów):
  3.1 → Status partially_delivered           [backend + frontend]
  3.2 → Lista WZ w OrderDetailPage           [frontend]

FAZA 4 (kontrola stanów):
  4.1 → Hard block ujemnych stanów           [backend]

FAZA 5 (dashboard — po stabilizacji faz 0-4):
  5.1 → Endpoint /dashboard/summary/        [backend]
  5.2 → DashboardPage                       [frontend]
```

---

*Dokument do aktualizacji po każdej zrealizowanej iteracji. Przy ukończeniu zadania zaznacz [x] przy kryteriach weryfikacji.*

---

## 12. ARCHITEKTURA ELASTYCZNEGO PRZEPŁYWU DOKUMENTÓW

> Decyzja architektoniczna 2026-06-04. Cel: system obsługujący różne modele przepływu dokumentów (Order→WZ→FV, Order→VanRoute→WZ→FV, standalone WZ→FV) bez twardego kodowania ścieżki — przy zachowaniu integralności ilościowej.

### Problem

Różne firmy mają różne przepływy:
- `ZAM → WZ → FV` (hurtownia z magazynu)
- `ZAM → Trasa Vana → WZ → FV` (dystrybutor z vanem)
- `WZ bez ZAM → FV` (sprzedaż doraźna)
- `ZAM → częściowe WZ → częściowe FV` (duże zamówienia dostarczane partiami)

Obecny system nie blokuje nadmiarowych WZ do jednego ZAM, nie blokuje fakturowania więcej niż dostarczono, nie śledzi ile z danego ZAM zostało już zafakturowane.

### Mechanizm: `quantity_open` per linia dokumentu

Każda linia dokumentu wie ile z jej ilości zostało już „skonsumowane" przez dokumenty niżej w łańcuchu.

```
OrderItem
  quantity           = 10   ← zamówiono
  quantity_fulfilled =  7   ← pokryte przez WZ (zsumowane z DeliveryItem)
  quantity_open      =  3   ← można jeszcze wystawić WZ

DeliveryItem (WZ)
  quantity_actual    =  7   ← dostarczone
  quantity_invoiced  =  5   ← już na fakturze
  quantity_returned  =  0   ← zwrócone przez ZW
  quantity_open_inv  =  2   ← można jeszcze zafakturować
```

### Trzy poziomy ochrony

| Poziom | Guard | Blokuje |
|--------|-------|---------|
| `OrderItem.quantity_open` | WZ qty ≤ open | Nadmierne WZ do jednego ZAM |
| `DeliveryItem.quantity_open_inv` | FV qty ≤ open | Podwójne / nadmierne fakturowanie |
| `DeliveryItem.quantity_open_ret` | ZW qty ≤ open | Zwrot więcej niż dostarczono |

### Co wymaga zmian w bazie

**`OrderItem`** — dodać:
- `quantity_fulfilled` (Decimal, default 0) — aktualizowane sygnałem gdy `DeliveryItem` z `order_item` FK jest tworzony/usuwany

**`DeliveryItem`** — dodać:
- `order_item` FK (już nullable — upewnić się że jest ustawiane konsekwentnie)
- `quantity_invoiced` (Decimal, default 0) — aktualizowane gdy linia faktury powstaje/jest usuwana
- `quantity_returned` (Decimal, default 0) — aktualizowane gdy linia ZW powstaje/jest usuwana

### Elastyczność przepływu — dwa ustawienia per firma

**`orders_required` (czy ZAM jest obowiązkowy przed WZ)**

Domyślnie: `false` — WZ może istnieć bez ZAM.

Realistyczne przypadki WZ bez ZAM (małe firmy, target rynku):
- Handlowiec z vanem — ładuje van rano, sprzedaje na miejscu u klientów bez wcześniejszych zamówień
- Mała piekarnia — dostarcza chleb do 20 sklepów codziennie, sklepy nie składają formalnych zamówień
- Sprzedaż doraźna B2B — klient dzwoni pilnie po towar, nie ma czasu na formalny ZAM

Wniosek: moduł `orders` jest opcjonalny. Firma pracująca tylko na WZ→FV to realistyczny i częsty profil.

**`wz_required_before_invoice` (czy WZ musi istnieć przed FV)**

| Profil firmy | orders | wz_required |
|---|---|---|
| Dystrybutor z vanem / dostawca jedzenia | OFF | TRUE — FV z WZ |
| Hurtownia B2B z zamówieniami | ON | TRUE — FV z WZ |
| Firma usługowa | ON | FALSE — FV z ZAM bezpośrednio |

To jedno ustawienie zastępuje "invoice_source". Jeśli `false`, system pozwala wystawić FV bezpośrednio z ZAM bez WZ.

**Van route** — opcjonalna warstwa grupowania, nigdy obowiązkowy krok w łańcuchu ilościowym. WZ może powstać:
- ze standalone (bez ZAM, bez trasy)
- z ZAM bezpośrednio (bez trasy)
- z ZAM przez trasę vana

We wszystkich przypadkach te same guardy chronią ilości — trasa jest tylko organizacyjna.

### Spójność `van_route` FK na WZ

Obecnie FK jest ustawiany tylko przy tworzeniu WZ z dashboardu trasy. Naprawa:
- Przy dodawaniu ZAM do trasy: backfill `van_route` na istniejących WZ tego zamówienia
- Przy tworzeniu WZ z ZAM który jest już na trasie: auto-ustawiaj `van_route`

### Co NIE jest planowane

- Tabela `DocumentReference` (junction) — zbędna na tym etapie, FK chain wystarczy
- Konfiguracja workflow per firma (kolejny etap po stabilizacji guardów)

