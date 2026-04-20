# MojeSaldoo App - Dokumentacja Projektu

## Spis Treści
1. [Przegląd Projektu](#przegląd-projektu)
2. [Stack Technologiczny](#stack-technologiczny)
3. [Architektura Aplikacji](#architektura-aplikacji)
4. [Moduły Aplikacji](#moduły-aplikacji)
5. [Przepływy Biznesowe](#przepływy-biznesowe)
6. [Struktura Projektu](#struktura-projektu)
7. [Modele Danych](#modele-danych)
8. [API Endpoints](#api-endpoints)
9. [Integracje](#integracje)
10. [Plan Implementacji](#plan-implementacji)

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
- Lista zamówień (Zamówienie Sklep ABC)
- Wybór produktów: Kartacze, Babka ziemniaczana, Kiszka, Naleśniki
- Kalkulator cen i rabatów

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
- Dodanie zwrotów (WZ może być edytowalny)
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
│   │   ├── models.py
│   │   ├── views.py
│   │   ├── serializers.py
│   │   ├── ksef_client.py   # KSeF API client
│   │   ├── xml_generator.py # Invoice XML generation
│   │   ├── crypto.py        # Encryption/Decryption
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

### **⚠️ IMPORTANT: Two-Backend Architecture**

**MojeSaldoo uses TWO separate backends:**

1. **Django Backend (MojeSaldoo)** - NEW, MVP for testing
   - Manages: Users, Products, Customers, Orders, Delivery, Invoices (business data)
   - Database: SQLite (dev) → PostgreSQL (prod)
   - Purpose: MVP to test application, backend developer will optimize later

2. **SSAPI Backend** - EXISTING, production-ready
   - Manages: ONLY KSeF communication (send invoices, check status)
   - Database: Own SQLite (only KSeF invoices tracking)
   - Purpose: Battle-tested KSeF integration

### **Data Flow:**
```
Frontend (React)
    ↓
Django Backend API  →  SSAPI Backend (only for KSeF)
    ↓                       ↓
MojeSaldoo Database    KSeF API (gov.pl)
(products, orders)
```

### **⚠️ IMPORTANT: KSeF Token Management**

**KSeF authentication and token management is handled ENTIRELY by SSAPI backend.**

- ✅ **SSAPI Backend handles**: KSeF tokens, certificates, encryption, XML signing, API calls
- ✅ **Django Backend handles**: Business logic, products, orders, customers, invoices (data only)
- ✅ **Frontend handles**: ONLY JWT authentication for user login
- ❌ **Frontend NEVER**: Stores/manages KSeF tokens or certificates

### **SSAPI Backend Structure** (`C:\Users\AJDuk\src\ssapi`)

SSAPI is a lightweight CRUD API built with **Bottle framework** that runs on shared hosting (mod_python).

#### **Key Files:**
- `web.py` - REST API endpoints (Bottle routes)
- `kseflib.py` - KSeF API client (authentication, encryption, XML signing)
- `db.py` - SQLite database layer (sales, returns, invoices, user sessions)
- `auth.py` - User session management
- `tokens.py` - Token manager for API authentication

#### **Database Schema (SQLite):**
```sql
-- Sales transactions
CREATE TABLE sales (
    id INTEGER PRIMARY KEY,
    product CHAR,
    shop CHAR,
    quantity INT,
    date DATE DEFAULT CURRENT_TIMESTAMP,
    is_discounted BOOLEAN
);

-- Returns
CREATE TABLE returns (
    id INTEGER PRIMARY KEY,
    product CHAR,
    shop CHAR,
    quantity INT,
    date DATE DEFAULT CURRENT_TIMESTAMP
);

-- User sessions (JWT/auth tokens)
CREATE TABLE user_sessions (
    id INTEGER PRIMARY KEY,
    secret CHAR,
    datetime DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- KSeF invoices
CREATE TABLE invoices (
    reference_number TEXT PRIMARY KEY,     -- KSeF reference number
    session_reference_number TEXT,
    ksef_number TEXT,                     -- KSeF invoice number
    invoice_number TEXT,                  -- Our invoice number
    status_code INTEGER,
    status_description TEXT,
    nip TEXT,
    invoice_hash TEXT,
    issue_date TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    shop TEXT,
    total_gross_cents INTEGER
);

-- Settings
CREATE TABLE settings (
    owner CHAR PRIMARY KEY,
    data CHAR
);
```

#### **API Endpoints (SSAPI):**
```
GET  /                  - API version & available routes
GET  /shops             - List of shops
GET  /sales             - Sales transactions (filters: start, end, shop, isDiscounted)
GET  /returns           - Return transactions
POST /sales             - Create sales
POST /returns           - Create returns
POST /invoices/send     - Send invoice to KSeF
GET  /invoices/status   - Check KSeF invoice status
```

#### **KSeF Integration Flow (Backend Only):**
1. User uploads certificate (.pem) and key (.key) via frontend
2. **Backend stores** encrypted certificate in filesystem
3. User creates invoice in frontend
4. **Backend receives** invoice data via API
5. **Backend (kseflib.py)**:
   - Generates challenge from KSeF
   - Signs AuthTokenRequest with certificate
   - Gets auth token
   - Creates session with KSeF
   - Generates & encrypts invoice XML
   - Sends to KSeF API
   - Returns reference number & status
6. **Frontend displays** results (reference number, status, QR code)

#### **Frontend ↔ SSAPI Communication:**
```typescript
// Frontend only sends/receives invoice data
POST /api/invoices/send
{
  "invoiceNumber": "FV/2026/001",
  "shop": "Sklep ABC",
  "items": [...],
  "totalGross": 150.00
}

// Backend handles all KSeF complexity and returns:
{
  "referenceNumber": "202603313-KZ-ABCI2Y",
  "ksefNumber": "FV/2026/MM+",
  "status": "accepted",
  "invoiceHash": "abc123..."
}
```

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
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    session_token = models.CharField(max_length=500)
    symmetric_key = models.CharField(max_length=500)
    challenge = models.CharField(max_length=500, blank=True)
    expires_at = models.DateTimeField()
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
GET    /api/invoices/               # Lista faktur
POST   /api/invoices/               # Utwórz fakturę
GET    /api/invoices/{id}/          # Szczegóły faktury
POST   /api/invoices/{id}/preview/  # Podgląd HTML
POST   /api/invoices/{id}/generate-xml/ # Generuj XML
POST   /api/invoices/{id}/send-ksef/ # Wyślij do KSeF
GET    /api/invoices/{id}/status/   # Pobierz status z KSeF
```

### KSeF Integration
```
POST   /api/ksef/challenge/         # Pobierz challenge
POST   /api/ksef/auth-token/        # Pobierz auth token
POST   /api/ksef/session/           # Utwórz sesję
POST   /api/ksef/encrypt-invoice/   # Zaszyfruj fakturę
POST   /api/ksef/send-invoice/      # Wyślij zaszyfrowaną fakturę
GET    /api/ksef/invoice-status/{ref}/ # Sprawdź status faktury
GET    /api/ksef/upo/{ref}/         # Pobierz UPO
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
- [ ] CRUD produktów
- [ ] CRUD klientów
- [ ] Zarządzanie stanami magazynowymi
- [ ] Lista produktów z wyszukiwaniem

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
- [ ] Synchronizacja offline
- [ ] Powiadomienia push (statusy KSeF)
- [ ] Eksport raportów do PDF/Excel
- [ ] Integracja z drukarkami fiskalny
- [ ] Multi-tenancy (wiele firm na jednym koncie)
- [ ] OCR do skanowania dokumentów
- [ ] API webhooks (powiadomienia o statusach)

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

**Ostatnia aktualizacja**: 2026-03-26
**Wersja dokumentu**: 1.0
