04-06-2026
MojeSaldoo App — Professional Analysis
What the App Is
A Polish sales & delivery management system for small businesses doing route-based (door-to-door) distribution. It covers the full order-to-invoice lifecycle with KSeF (national e-invoicing) integration. Think: a salesman in a van, stocked with products, visiting small shops — this app manages everything from that van's loading to the final e-invoice.

Strengths
1. Domain coverage is genuinely impressive.
The lifecycle you've implemented — order → WZ delivery doc → reconciliation → invoice → KSeF — is complete and correct for the Polish market. Most competitors don't cover van-route logistics this deeply.

2. Data model is solid and professional.

UUID primary keys everywhere (correct for APIs)
Decimal precision for all monetary values (critical — float errors in invoicing are a serious bug)
Full audit trail: OrderChangeLog, StockMovement, created_at/updated_at on everything
Soft deletes (is_active) — you won't accidentally destroy a customer record referenced by past invoices
3. Multi-tenancy is properly designed.
CompanyMembership roles + CompanyModule feature flags = you can sell this as SaaS with per-company pricing tiers. This is the right architecture from day one.

4. KSeF awareness.
Most small-business tools in Poland are just adding KSeF as an afterthought. You have it built into the data model from the start: ksef_reference_number, ksef_status, upo_received, certificate management. That's a real competitive advantage.

5. Tech stack is modern and appropriate.
React + TypeScript + React Query + Tailwind is the correct choice for a B2B web app in 2026. No over-engineering, no unnecessary complexity.

Weak Points
Critical (Fix Before Selling)
1. KSeF page is a placeholder.
The /ksef route renders <AppPlaceholderPage title="KSeF" />. This is your main legal compliance differentiator — it must work. A Polish small business owner will ask about this immediately. You need:

Certificate status display (expiry date, fingerprint)
Per-invoice KSeF status with retry for rejected ones
Bulk send UI
UPO (Urzędowe Poświadczenie Odbioru) download
2. No invoice PDF generation visible.
InvoicePreviewPayload type exists but the print-to-PDF flow is unclear. Every small business owner's first question is "can I print or email the invoice?" This must work out of the box and produce a legally compliant Polish invoice layout (all required fields: NIP, bank account, payment term, payment method, etc.).

3. Stock edge cases are defined but not implemented.
Fields like track_batches, fifo_enabled, shelf_life_days exist in your schema. If these show in the UI but do nothing, that's a trust problem. Either implement them or hide them completely until ready.

4. No data export.
Small businesses need CSV/Excel exports of orders, invoices, and stock. Their accountant will ask for this on day one. No export = a deal-breaker for many.

Significant (Fix in v1.1)
5. Reporting is likely too thin.
The /reports page exists but for a small company owner the minimum viable report set is:

Revenue by day/week/month (compared to prior period)
Revenue by customer (who is your best client?)
Revenue by product (what sells most?)
Outstanding invoices / overdue amounts
Stock value at cost
If these aren't clearly readable and filterable by date range, the reporting module adds no value.

6. No customer payment tracking.
payment_terms (days) exists on the customer. But there's no visible logic for: invoice issued → due date = issue date + payment terms → mark as overdue. The overdue invoice status exists but who triggers it? Without automatic overdue detection, the payment lifecycle is incomplete.

7. Van reconciliation UX is likely confusing.
Reconciliation is a complex workflow that drivers will do in the field after a route. If the UX requires understanding warehouse documents (MM, WZ, RW) it will fail with non-technical users. This flow needs to be extremely simplified: "What's left in the van?" → enter quantities → done.

8. Search has no debouncing (performance issue).
Hitting the API on every keypress in search fields will be noticeable on mobile networks. Standard fix: 300ms debounce on all search inputs.

9. No offline support despite Capacitor being installed.
A driver in a rural area with no signal can't use the app. Even basic offline mode (view today's route, mark deliveries as done, sync when connected) would be a major practical advantage.

Polish & Professionalism
10. Form validation inconsistency.
React Hook Form + Zod are installed but may not be uniformly applied. Any form that lets you submit blank required fields, or accepts negative prices, looks amateur. Audit every create/edit form.

11. No error boundaries.
If one component crashes (e.g., a React Query error on the order detail page), the entire app goes blank. A global <ErrorBoundary> with a "something went wrong, reload" fallback is a basic professionalism requirement.

12. No empty states.
What does the orders list look like for a brand-new company with zero orders? "No data" tables without helpful empty states ("You have no orders yet — create your first one") feel unfinished.

13. Mobile layout audit needed.
Capacitor is there but if the layouts aren't tested on a 390px iPhone screen, drivers will struggle. Table-heavy views (orders list, delivery docs) are particularly problematic on mobile.

What Small Companies Will Actually Ask
Question	Current state
"Can I print/email the invoice?"	Unclear — needs verification
"Does it connect to KSeF?"	Yes but the UI is a placeholder
"Can I export to Excel for my accountant?"	Not implemented
"What happens if the driver has no internet?"	Not supported
"Can multiple salespeople use it?"	Yes (roles/memberships exist)
"How do I know who owes me money?"	Partial — overdue status exists, no aging report
"Can I see my sales vs last month?"	Likely partial
"Does it work on a phone?"	Capacitor installed but needs testing
Priority Action List
Must-have before first paid customer:

Make KSeF status dashboard functional (not placeholder)
Verify invoice PDF works and is legally compliant
Add CSV export to invoices and orders
Remove or clearly mark as "coming soon" any non-functional fields (batch tracking, FIFO, etc.)
Add error boundaries app-wide
Important for v1.1:
6. Automatic invoice overdue detection (cron/background task)
7. Simplified van reconciliation flow for drivers
8. Debounce all search inputs
9. Empty states on all list pages
10. Mobile layout audit on key driver flows

Competitive differentiators to invest in:
11. Basic offline mode for van route execution
12. Revenue dashboard with period comparison
13. Accounts receivable aging report (who owes what, for how long)

Summary Verdict
This is a well-architected, serious application — not a hobby project. The data model is correct, the multi-tenancy is properly designed, and the domain coverage is genuinely deep. Someone who understands Polish B2B distribution workflows built this.

The main risk right now is incomplete features that are visible to users — the KSeF placeholder, possibly non-functional batch/FIFO fields, missing PDF output, no export. For small business owners, seeing something that looks finished but doesn't work is worse than it not existing at all. They lose trust fast.

The fastest path to your first paying customer: audit every feature that's visible in the UI and either make it work end-to-end or hide it behind a "coming soon" flag.




-----------------OLD------------------------------------------
Project Status: What's Actually Done
Faza 1 (Setup & Infrastructure) — COMPLETE
All scaffolding, JWT auth, SQLite, React+Vite+Tailwind, React Router, React Query, Zod — done.

Faza 3 (Products & Customers) — COMPLETE
Products CRUD + warehouse + stock movements + batches — backend and frontend fully working.
Customers CRUD + NIP validation — fully working.

Critical Bugs Found (fix before anything else)
Orders app — models/views/serializers exist but URLs never registered in config/urls.py
Invoices app — not in INSTALLED_APPS, no URLs, broken imports
AuthContext — fully built but never integrated into App.tsx (auth happens via raw localStorage)
What's Missing Before You Can Proceed
The biggest gap is architectural: everything is currently scoped by user_id. For multi-company SaaS with switchable modules, you need:

Company model (tenant)
CompanyMembership (user ↔ company + role)
CompanyModule (which modules are enabled per company)
All domain models re-scoped from user → company
Onboarding: register → create company → enable modules → dashboard
Full Implementation Plan
PHASE 0 — Critical Bug Fixes
Agent Prompt:


You are fixing 3 critical bugs in a Django + React project at "d:\Work\MojeSaldoo App".

TASK 1 — Register Orders app URLs:
Read `backend/config/urls.py`. Add `path('api/orders/', include('apps.orders.urls'))` to urlpatterns. 
Then read `backend/apps/orders/urls.py` — if urlpatterns is empty, create a proper router registration 
for OrderViewSet from apps.orders.views.

TASK 2 — Register Invoices app:
Read `backend/config/settings.py`. Add `'apps.invoices'` to INSTALLED_APPS.
Read `backend/apps/invoices/models.py` — fix any broken imports (should use `from apps.users.models 
import User` and `from apps.orders.models import Order`).
Create `backend/apps/invoices/urls.py` with a router for InvoiceViewSet.
Add `path('api/invoices/', include('apps.invoices.urls'))` to `backend/config/urls.py`.

TASK 3 — Wire AuthContext into App.tsx:
Read `frontend/src/App.tsx` and `frontend/src/context/AuthContext.tsx`.
Wrap the app with AuthProvider in App.tsx. Replace the raw localStorage token checks in 
PrivateRoute-style logic with the `useAuth()` hook from AuthContext.
Make sure login redirects and logout work through the context.

After all changes, verify migrations would be needed for invoices (run: python manage.py 
makemigrations invoices --check and report).

All code comments and variable names must be in English. Polish only for UI text.
PHASE 2A — Multi-Company Backend Architecture
Why: All domain data must be scoped by Company (tenant), not individual User. This is the foundation for multi-company SaaS.

Agent Prompt:


You are implementing multi-company (multi-tenant) architecture for a Django REST Framework app 
at "d:\Work\MojeSaldoo App/backend".

CONTEXT:
- Currently all models (Product, Customer, Warehouse, Order, Invoice) have a `user` FK
- We need to re-scope them to a `company` FK
- Users can belong to multiple companies with roles

STEP 1 — Create Company model in `backend/apps/users/models.py`:
```python
class Company(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    name = models.CharField(max_length=255)
    nip = models.CharField(max_length=10, unique=True, blank=True, null=True)
    address = models.TextField(blank=True)
    city = models.CharField(max_length=100, blank=True)
    postal_code = models.CharField(max_length=10, blank=True)
    phone = models.CharField(max_length=20, blank=True)
    email = models.EmailField(blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

class CompanyMembership(models.Model):
    ROLE_CHOICES = [('admin','Admin'), ('manager','Manager'), ('driver','Driver'), ('viewer','Viewer')]
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='memberships')
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='memberships')
    role = models.CharField(max_length=20, choices=ROLE_CHOICES, default='viewer')
    is_active = models.BooleanField(default=True)
    joined_at = models.DateTimeField(auto_now_add=True)
    class Meta:
        unique_together = ('user', 'company')
STEP 2 — Create CompanyModule model:


class CompanyModule(models.Model):
    MODULE_CHOICES = [
        ('products', 'Products & Inventory'),
        ('customers', 'Customers'),
        ('warehouses', 'Warehouse Management'),
        ('orders', 'Orders'),
        ('delivery', 'Delivery & WZ Documents'),
        ('invoicing', 'Invoicing'),
        ('ksef', 'KSeF Integration'),
        ('reporting', 'Reporting & Analytics'),
    ]
    company = models.ForeignKey(Company, on_delete=models.CASCADE, related_name='modules')
    module = models.CharField(max_length=50, choices=MODULE_CHOICES)
    is_enabled = models.BooleanField(default=False)
    enabled_at = models.DateTimeField(null=True, blank=True)
    class Meta:
        unique_together = ('company', 'module')
STEP 3 — Update User model:
Add current_company FK to Company (nullable, which company is active for this session):


current_company = models.ForeignKey('Company', null=True, blank=True, 
    on_delete=models.SET_NULL, related_name='+')
STEP 4 — Add company FK to all domain models:
In apps/products/models.py: Add company = models.ForeignKey('users.Company', on_delete=models.CASCADE) to Product, Warehouse, ProductStock, StockBatch, StockMovement. Keep user field for audit trail.
In apps/customers/models.py: Same for Customer.
In apps/orders/models.py: Same for Order.
In apps/invoices/models.py: Same for Invoice.

STEP 5 — Create serializers and views for Company management in apps/users/:

CompanySerializer (name, nip, address, email, phone)
CompanyMembershipSerializer
CompanyModuleSerializer
ViewSet: CompanyViewSet (create, retrieve, update)
ViewSet: CompanyModuleViewSet (list and toggle modules)
View: SwitchCompanyView (user switches active company)
STEP 6 — Add URL routes:


POST /api/companies/ - create company
GET  /api/companies/me/ - get current user's companies
POST /api/companies/switch/ - switch active company
GET  /api/companies/{id}/modules/ - list modules
PATCH /api/companies/{id}/modules/{module}/ - enable/disable module
STEP 7 — Create a CompanyPermission class:


class IsCompanyMember(permissions.BasePermission):
    def has_permission(self, request, view):
        return (request.user.current_company is not None and 
                request.user.memberships.filter(
                    company=request.user.current_company, is_active=True).exists())

class IsCompanyAdmin(IsCompanyMember):
    def has_permission(self, request, view):
        if not super().has_permission(request, view):
            return False
        return request.user.memberships.filter(
            company=request.user.current_company, role__in=['admin'], is_active=True).exists()
STEP 8 — Update all ViewSets to scope queryset by request.user.current_company:
In ProductViewSet, CustomerViewSet, WarehouseViewSet, OrderViewSet, InvoiceViewSet:

queryset = Model.objects.filter(company=request.user.current_company)
On create: serializer.save(company=request.user.current_company, user=request.user)
STEP 9 — Create migrations:
Run: python manage.py makemigrations users products customers orders invoices
Include instructions for data migration if any data exists.

All code in English. Use UUID primary keys on all new models.



---

### PHASE 2B — Onboarding Flow (Frontend)

**Agent Prompt:**
You are implementing the user onboarding flow for a React + TypeScript app at
"d:\Work\MojeSaldoo App/frontend".

CONTEXT:

Backend has Company, CompanyMembership, CompanyModule models (just implemented)
API endpoints available: POST /api/companies/, GET /api/companies/me/, POST /api/companies/switch/, GET /api/companies/{id}/modules/, PATCH /api/companies/{id}/modules/{module}/
Auth: JWT tokens stored in localStorage (access_token, refresh_token)
Stack: React 18, TypeScript, React Router 6, React Hook Form + Zod, TanStack React Query 5, Axios, Tailwind CSS
TASK 1 — Add types to frontend/src/types/:
Create company.types.ts:


export type CompanyRole = 'admin' | 'manager' | 'driver' | 'viewer'
export type ModuleName = 'products' | 'customers' | 'warehouses' | 'orders' | 
  'delivery' | 'invoicing' | 'ksef' | 'reporting'

export interface Company {
  id: string
  name: string
  nip: string
  address: string
  city: string
  postalCode: string
  phone: string
  email: string
  isActive: boolean
  createdAt: string
}

export interface CompanyMembership {
  id: string
  company: Company
  role: CompanyRole
  isActive: boolean
  joinedAt: string
}

export interface CompanyModule {
  module: ModuleName
  isEnabled: boolean
  enabledAt: string | null
}

export interface CompanyWrite {
  name: string
  nip?: string
  address?: string
  city?: string
  postalCode?: string
  phone?: string
  email?: string
}
TASK 2 — Create frontend/src/services/company.service.ts:
Implement using the existing api client from services/api.ts:

companyService.getMyCompanies() → GET /api/companies/me/
companyService.createCompany(data: CompanyWrite) → POST /api/companies/
companyService.switchCompany(companyId: string) → POST /api/companies/switch/
companyService.getModules(companyId: string) → GET /api/companies/{id}/modules/
companyService.toggleModule(companyId: string, module: ModuleName, enabled: boolean) → PATCH /api/companies/{id}/modules/{module}/
TASK 3 — Create React Query hooks in frontend/src/query/use-companies.ts:

useMyCompaniesQuery()
useCompanyModulesQuery(companyId)
useCreateCompanyMutation()
useSwitchCompanyMutation()
useToggleModuleMutation(companyId)
TASK 4 — Create a useModuleGuard hook in frontend/src/hooks/useModuleGuard.ts:


// Returns true if the given module is enabled for the current company
export function useModuleGuard(module: ModuleName): boolean
This hook reads from the company modules query and returns whether the module is active.

TASK 5 — Create frontend/src/pages/OnboardingPage.tsx:
A multi-step form (3 steps):

Step 1: "Utwórz firmę" — Company name, NIP, city (required); address, phone, email (optional) Validation with Zod. On submit calls useCreateCompanyMutation.
Step 2: "Włącz moduły" — Checklist of available modules with descriptions (in Polish):
Produkty & Magazyn (always enabled, required)
Klienci (always enabled, required)
Zamówienia (optional)
Dostawa & Dokumenty WZ (optional, requires Zamówienia)
Fakturowanie (optional, requires Zamówienia)
Integracja KSeF (optional, requires Fakturowanie)
Raporty (optional) On submit calls useToggleModuleMutation for each checked module.
Step 3: "Gotowe!" — Success screen with button "Przejdź do aplikacji" → /
TASK 6 — Update frontend/src/App.tsx routing:
Add route: /onboarding → OnboardingPage (authenticated but no company yet)
Add logic: after login, check if user has any company. If not, redirect to /onboarding.
If user has company, redirect to /.

TASK 7 — Create frontend/src/pages/CompanySettingsPage.tsx:
Shows current company info + module toggles.
Each module is a card with a toggle switch, name, description, and status.
Disabled modules grey out. Admin-only to change.
Route: /settings/company

All code in English. Polish only for UI labels, descriptions, and button text.
Use Tailwind for styling. Use existing UI components (Button, Input, Card) from components/ui/.



---

### PHASE 2C — Module-Aware Routing & Navigation

**Agent Prompt:**
You are implementing module-aware routing and navigation for a React + TypeScript app at
"d:\Work\MojeSaldoo App/frontend".

CONTEXT:

CompanyModule system is implemented (useModuleGuard hook exists)
ModuleName type: 'products' | 'customers' | 'warehouses' | 'orders' | 'delivery' | 'invoicing' | 'ksef' | 'reporting'
Stack: React Router 6, Tailwind CSS, React Query 5
TASK 1 — Create frontend/src/components/layout/ModuleRoute.tsx:
A wrapper around React Router's Route that checks if a module is enabled:


// If module is disabled, shows a "Module not enabled" page with link to settings
interface ModuleRouteProps {
  module: ModuleName
  element: React.ReactElement
}
TASK 2 — Update frontend/src/App.tsx routes to use ModuleRoute:

/products, /products/new, /products/:id/adjust-stock → module: 'products'
/customers, /customers/new → module: 'customers'
/warehouses, /warehouses/new → module: 'warehouses'
/orders, /orders/new, /orders/:id → module: 'orders' (when implemented)
/delivery → module: 'delivery' (when implemented)
/invoices → module: 'invoicing' (when implemented)
/reports → module: 'reporting' (when implemented)
TASK 3 — Update frontend/src/components/layout/Navigation.tsx (or Sidebar.tsx):
Read the current navigation component. Update it to:

Only show navigation items for enabled modules
Use useModuleGuard for each nav item
Group nav items by module (Sprzedaż, Magazyn, Dokumenty, Administracja)
Show company name in the header/sidebar
Add Settings link at bottom (always visible)
TASK 4 — Create frontend/src/components/layout/CompanySwitcher.tsx:
A dropdown in the header showing current company name.
If user has multiple companies, shows a list to switch between them.
On switch: calls useSwitchCompanyMutation, then invalidates all queries and reloads.

All code in English, UI text in Polish, Tailwind styling.



---

### PHASE 3 (Fix) — Certificate Upload for KSeF

**Agent Prompt:**
You are implementing certificate upload for KSeF integration in a Django + React app at
"d:\Work\MojeSaldoo App".

CONTEXT:

Project has Company model in apps/users/models.py
KSeF integration is handled by a separate SSAPI backend, but the certificate needs to be uploaded and stored on the Django backend
The Django backend encrypts and stores the certificate, SSAPI uses it
BACKEND TASK — Add Certificate model to apps/users/models.py:


class KSeFCertificate(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    company = models.OneToOneField(Company, on_delete=models.CASCADE, related_name='ksef_certificate')
    uploaded_by = models.ForeignKey(User, on_delete=models.SET_NULL, null=True)
    # Store encrypted certificate content (never store raw private key)
    certificate_pem = models.TextField()  # Public certificate (.pem) - not encrypted
    encrypted_key = models.TextField()    # Private key encrypted with server key
    # Metadata
    subject_name = models.CharField(max_length=255, blank=True)
    valid_from = models.DateField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    uploaded_at = models.DateTimeField(auto_now_add=True)
Create upload endpoint POST /api/companies/{id}/certificate/:

Accepts multipart/form-data with certificate_file (.pem) and key_file (.key or .pem)
Reads certificate metadata (subject, validity dates) using Python cryptography library
Encrypts private key using a server-side symmetric key (from Django settings SECRET_KEY)
Stores encrypted key in database
Returns certificate metadata (never returns the key)
Add DELETE /api/companies/{id}/certificate/ to remove certificate.
Add GET /api/companies/{id}/certificate/status/ to check if certificate exists and is valid.

FRONTEND TASK — Create frontend/src/pages/CertificateUploadPage.tsx:

Upload form with two file inputs: "Certyfikat (.pem)" and "Klucz prywatny (.key/.pem)"
Shows current certificate status (uploaded/not uploaded, expiry date)
Upload button calls POST endpoint with FormData
Shows success/error feedback
Delete option with confirmation dialog
Route: /settings/certificate
All code in English, UI text in Polish.



---

### PHASE 4 — Orders Management

**Agent Prompt:**
You are implementing full Orders management for a Django + React app at "d:\Work\MojeSaldoo App".

CONTEXT:

Backend: Orders app exists at apps/orders/ with basic models (Order, OrderItem) but URLs are not properly wired and models need company FK (added in Phase 2A)
Frontend: order.types.ts exists but no service, no query hooks, no pages
Stack: DRF + React 18 + TypeScript + React Query 5 + React Hook Form + Zod + Tailwind
BACKEND TASKS:

TASK 1 — Update Order model in apps/orders/models.py:
Ensure these fields exist (add missing ones):

id (UUID PK), company (FK to users.Company), user (FK for audit)
customer (FK to customers.Customer, PROTECT), order_number (unique, auto-generated)
order_date, delivery_date (DateFields)
status choices: draft, confirmed, in_preparation, loaded, in_delivery, delivered, invoiced, cancelled
subtotal_net, subtotal_gross, discount_percent, discount_amount, total_net, total_gross (all Decimal)
customer_notes, internal_notes (TextField, blank)
created_at, updated_at, confirmed_at, delivered_at
Auto-generate order_number in save() method: format "ZAM/{year}/{sequence:04d}"
Use transaction.atomic() to safely generate sequential numbers.

TASK 2 — Update OrderItem model:

id (UUID), order (FK), product (FK to products.Product, PROTECT)
product_name, product_unit (snapshot fields, CharField)
quantity, quantity_delivered, quantity_returned (Decimal)
unit_price_net, unit_price_gross, vat_rate, discount_percent (Decimal)
line_total_net, line_total_gross (computed on save) Remove UNIQUE(order, product) — same product can appear multiple times.
TASK 3 — Create OrderSerializer and OrderItemSerializer in apps/orders/serializers.py:

Nested writable serializer: POST /api/orders/ accepts { customer_id, delivery_date, items: [...] }
items is a list of { product_id, quantity, unit_price_net, unit_price_gross, vat_rate, discount_percent }
Serializer auto-fills product_name, product_unit from product on create
Serializer auto-calculates line_total_net, line_total_gross
OrderSerializer.create() uses transaction.atomic, creates order then items, calculates totals
TASK 4 — Create OrderViewSet in apps/orders/views.py:

CRUD with IsAuthenticated + IsCompanyMember permissions
Custom actions:
POST /{id}/confirm/ — changes status draft → confirmed
POST /{id}/cancel/ — cancels order (only draft/confirmed can be cancelled)
GET /{id}/items/ — list order items
Queryset scoped by request.user.current_company
Filters: customer, status, delivery_date (date range: delivery_date_after, delivery_date_before)
Ordering: delivery_date, created_at, total_gross
TASK 5 — Register URLs in apps/orders/urls.py and config/urls.py.

FRONTEND TASKS:

TASK 6 — Create frontend/src/services/order.service.ts:

orderService.fetchList(params) → GET /api/orders/
orderService.fetchById(id) → GET /api/orders/{id}/
orderService.createOrder(data) → POST /api/orders/
orderService.updateOrder(id, data) → PUT /api/orders/{id}/
orderService.confirmOrder(id) → POST /api/orders/{id}/confirm/
orderService.cancelOrder(id) → POST /api/orders/{id}/cancel/
orderService.deleteOrder(id) → DELETE /api/orders/{id}/
Update frontend/src/types/order.types.ts with proper types matching the backend.

TASK 7 — Create React Query hooks in frontend/src/query/use-orders.ts:

useOrderListQuery(page, filters) — with pagination support
useOrderQuery(id)
useCreateOrderMutation()
useConfirmOrderMutation()
useCancelOrderMutation()
useDeleteOrderMutation()
TASK 8 — Create frontend/src/pages/OrdersPage.tsx:

Table list of orders with columns: Nr zamówienia, Klient, Data dostawy, Status, Wartość brutto
Status badges (color-coded: draft=grey, confirmed=blue, delivered=green, cancelled=red)
Filter bar: customer search, status filter, date range
Pagination
"Nowe zamówienie" button → /orders/new
TASK 9 — Create frontend/src/pages/OrderCreatePage.tsx:
Multi-step form:

Step 1: Select customer (searchable dropdown), set delivery_date, optional notes
Step 2: Add products — searchable product list, set quantity, shows unit price and line total
"Dodaj produkt" button adds a row
Each row: product (select), quantity, unit_price_net (editable), discount %
Live calculation of line_total_gross
Order summary at bottom: total net, total gross
Step 3: Review & confirm — shows full order summary before submit
TASK 10 — Create frontend/src/pages/OrderDetailPage.tsx:
Shows full order details, items list, status history.
Buttons: Potwierdź (if draft), Anuluj (if cancellable), link to create WZ (future).
Route: /orders/:id

Add all routes to App.tsx wrapped in ModuleRoute module='orders'.
All code in English, UI text in Polish, Tailwind styling.



---

### PHASE 5 — Delivery & WZ Documents

**Agent Prompt:**
You are implementing Delivery and WZ (Wydanie Zewnętrzne) document management for a
Django + React app at "d:\Work\MojeSaldoo App".

CONTEXT:

Orders are implemented (Phase 4). Delivery docs are linked to orders.
Models needed: DeliveryDocument (WZ/MM), DeliveryItem
Flow: Order → Generate WZ → Driver delivers → Mark delivered → Ready for invoicing
Stack: DRF + React 18 + TypeScript + React Query 5 + Tailwind
BACKEND TASKS:

Create new app: backend/apps/delivery/
Files: models.py, views.py, serializers.py, urls.py, admin.py

TASK 1 — DeliveryDocument model:


class DeliveryDocument(models.Model):
    DOC_TYPE_CHOICES = [('WZ','Wydanie Zewnętrzne'), ('MM','Przesunięcie Międzymagazynowe'), ('PZ','Przyjęcie Zewnętrzne')]
    STATUS_CHOICES = [('draft','Draft'), ('saved','Saved'), ('in_transit','In Transit'), 
                      ('delivered','Delivered'), ('cancelled','Cancelled')]
    
    id = UUIDField PK
    company = FK to Company
    order = FK to Order (CASCADE)
    user = FK to User (audit)
    document_type = CharField choices=DOC_TYPE_CHOICES
    document_number = CharField unique (auto-generated: "WZ/{year}/{seq:04d}")
    issue_date = DateField
    from_warehouse = FK to products.Warehouse (null, blank)
    to_warehouse = FK to products.Warehouse (null, blank)
    to_customer = FK to customers.Customer (null, blank, SET_NULL)
    status = CharField choices=STATUS_CHOICES default='draft'
    has_returns = BooleanField default=False
    returns_notes = TextField blank
    driver_name = CharField blank
    receiver_name = CharField blank
    delivered_at = DateTimeField null, blank
    notes = TextField blank
    created_at, updated_at
TASK 2 — DeliveryItem model:


class DeliveryItem(models.Model):
    id = UUIDField PK
    delivery_document = FK to DeliveryDocument CASCADE
    order_item = FK to orders.OrderItem PROTECT
    product = FK to products.Product PROTECT
    quantity_planned = DecimalField
    quantity_actual = DecimalField null, blank (filled on delivery)
    quantity_returned = DecimalField default=0
    return_reason = CharField blank
    is_damaged = BooleanField default=False
    notes = TextField blank
    created_at
TASK 3 — Views:

DeliveryDocumentViewSet: full CRUD + custom actions:
POST /{id}/save/ — draft → saved
POST /{id}/start-delivery/ — saved → in_transit
POST /{id}/complete/ — in_transit → delivered (accepts actual quantities + returns)
GET /generate-for-order/{order_id}/ — auto-creates WZ from confirmed order items
Queryset scoped by company
Filters: order, status, issue_date range, document_type
TASK 4 — generate_delivery_from_order() function:
When called with a confirmed order:

Creates DeliveryDocument (WZ type) linked to order
Creates DeliveryItem for each OrderItem with quantity_planned = order quantity
Returns the created document
TASK 5 — Register in config/urls.py: path('api/delivery/', include('apps.delivery.urls'))
Add 'apps.delivery' to INSTALLED_APPS.

FRONTEND TASKS:

TASK 6 — Types, service, and React Query hooks (same pattern as orders).

TASK 7 — frontend/src/pages/DeliveryDocumentsPage.tsx:
List WZ documents with status, date, customer, driver name.
Filter by status, date range. "Generuj WZ" button for a selected order.

TASK 8 — frontend/src/pages/DeliveryDocumentDetailPage.tsx:
Shows WZ with item list.
Status action buttons: Zapisz WZ, Rozpocznij dostawę, Zakończ dostawę.
"Zakończ dostawę" opens a form to fill actual quantities and returns.

Add routes in App.tsx wrapped in ModuleRoute module='delivery'.
All code in English, UI text in Polish.



---

### PHASE 6 — Invoicing (Local, without KSeF)

**Agent Prompt:**
You are implementing local invoice generation (without KSeF) for a Django + React app at
"d:\Work\MojeSaldoo App".

CONTEXT:

Invoices are created from delivered WZ documents
Local invoicing only (KSeF integration is Phase 7)
Existing invoices app needs to be upgraded (currently has minimal model)
Stack: DRF + React 18 + TypeScript + React Query 5 + Tailwind
BACKEND TASKS:

TASK 1 — Upgrade Invoice model in apps/invoices/models.py:


class Invoice(models.Model):
    PAYMENT_METHOD_CHOICES = [('transfer','Przelew'), ('cash','Gotówka'), ('card','Karta')]
    STATUS_CHOICES = [('draft','Draft'), ('issued','Wystawiona'), ('sent','Wysłana'), 
                      ('paid','Opłacona'), ('overdue','Przeterminowana'), ('cancelled','Anulowana')]
    KSEF_STATUS_CHOICES = [('not_sent','Nie wysłana'), ('pending','Oczekuje'), 
                           ('sent','Wysłana'), ('accepted','Przyjęta'), ('rejected','Odrzucona')]
    
    id = UUIDField PK
    company = FK to users.Company CASCADE
    user = FK to users.User (audit)
    order = FK to orders.Order PROTECT
    customer = FK to customers.Customer PROTECT
    delivery_document = FK to delivery.DeliveryDocument null, blank, PROTECT
    
    invoice_number = CharField unique (auto: "FV/{year}/{seq:04d}")
    issue_date, sale_date, due_date = DateFields
    payment_method = CharField choices
    
    subtotal_net, subtotal_gross, vat_amount, total_gross = DecimalFields
    
    # KSeF fields (filled after Phase 7)
    ksef_reference_number = CharField blank
    ksef_number = CharField blank  
    ksef_status = CharField choices default='not_sent'
    ksef_sent_at = DateTimeField null, blank
    ksef_error_message = TextField blank
    invoice_hash = CharField blank
    upo_received = BooleanField default=False
    
    status = CharField choices default='draft'
    paid_at = DateTimeField null, blank
    notes = TextField blank
    created_at, updated_at
TASK 2 — InvoiceItem model:


class InvoiceItem(models.Model):
    invoice = FK to Invoice CASCADE
    order_item = FK to orders.OrderItem null, SET_NULL
    product = FK to products.Product null, SET_NULL
    product_name = CharField (snapshot)
    product_unit = CharField (snapshot)
    pkwiu = CharField blank
    quantity, unit_price_net, vat_rate = DecimalFields
    line_net, line_vat, line_gross = DecimalFields (computed)
    created_at
TASK 3 — InvoiceViewSet with actions:

CRUD scoped by company
POST /generate-from-order/{order_id}/ — auto-creates invoice from delivered order
POST /{id}/issue/ — draft → issued (locks invoice)
POST /{id}/mark-paid/ — issued/sent → paid
GET /{id}/preview/ — returns invoice data formatted for HTML preview
TASK 4 — generate_invoice_from_order() helper:

Checks order is in 'delivered' or 'invoiced' status
Creates Invoice + InvoiceItems from OrderItems (snapshot product data)
Calculates totals
Sets due_date = issue_date + customer.payment_terms days
FRONTEND TASKS:

TASK 5 — Types (invoice.types.ts), service (invoice.service.ts), React Query hooks (use-invoices.ts).

TASK 6 — frontend/src/pages/InvoicesPage.tsx:
Table: Nr faktury, Klient, Data wystawienia, Termin płatności, Wartość brutto, Status, Status KSeF.
Filter: status, ksef_status, date range, customer.

TASK 7 — frontend/src/pages/InvoiceDetailPage.tsx:
Full invoice view: header with company/customer details, item table, totals.
Action buttons: Wystaw (issue), Oznacz jako opłaconą, Wyślij do KSeF (disabled until Phase 7).
Show KSeF status badge.

TASK 8 — frontend/src/pages/InvoiceCreatePage.tsx:
Form to generate invoice from an order:

Select order (only delivered orders without invoice)
Edit: issue_date, sale_date, due_date, payment_method
Review items (read-only from order)
Submit → calls generate-from-order endpoint
Add routes in App.tsx wrapped in ModuleRoute module='invoicing'.
All code in English, UI text in Polish.



---

### PHASE 7 — KSeF Integration

**Agent Prompt:**
You are implementing KSeF (Krajowy System e-Faktur) integration for a Django + React app at
"d:\Work\MojeSaldoo App".

CONTEXT:

Architecture: Django backend forwards invoice to SSAPI backend which handles KSeF
SSAPI runs at a separate URL (configured in Django settings as SSAPI_BASE_URL)
SSAPI endpoints: POST /invoices/send, GET /invoices/status
Certificate is already stored encrypted in Django (Phase 2C)
Invoices are already created locally (Phase 6)
BACKEND TASKS:

TASK 1 — Add SSAPI settings to config/settings.py:


SSAPI_BASE_URL = env('SSAPI_BASE_URL', default='http://localhost:8001')
SSAPI_AUTH_TOKEN = env('SSAPI_AUTH_TOKEN', default='')
TASK 2 — Create apps/invoices/ksef_client.py:
A client that communicates with the SSAPI backend:


class SSAPIClient:
    def send_invoice(self, invoice_data: dict) -> dict:
        # POST to SSAPI /invoices/send
        # Returns: { referenceNumber, ksefNumber, status, invoiceHash }
    
    def get_invoice_status(self, reference_number: str) -> dict:
        # GET to SSAPI /invoices/status?ref={reference_number}
        # Returns: { status, statusDescription, upoReceived }
    
    def format_invoice_for_ssapi(self, invoice: Invoice) -> dict:
        # Converts Invoice model to SSAPI expected format
        # { invoiceNumber, shop, items: [...], totalGross, nip }
TASK 3 — Add KSeF actions to InvoiceViewSet:

POST /{id}/send-to-ksef/ — sends invoice to KSeF via SSAPI

Validates invoice is in 'issued' status
Validates company has ksef module enabled
Calls SSAPIClient.send_invoice()
Updates invoice ksef_reference_number, ksef_status='sent', ksef_sent_at
Returns updated invoice
POST /{id}/check-ksef-status/ — polls SSAPI for status update

Calls SSAPIClient.get_invoice_status()
Updates ksef_status, upo_received
If accepted: updates order status to 'invoiced'
POST /sync-ksef-statuses/ — bulk status check for all 'sent' invoices

TASK 4 — Background task (simple):
Create a management command python manage.py sync_ksef_statuses that checks all
invoices with ksef_status='sent' and updates their status from SSAPI.

FRONTEND TASKS:

TASK 5 — Enable "Wyślij do KSeF" button on InvoiceDetailPage:

Only enabled if: invoice status='issued' AND company has ksef module AND certificate uploaded
Shows loading state while sending
On success: updates status badges (KSeF: Wysłana → Przyjęta)
On error: shows error message from API
TASK 6 — Add KSeF status polling:
On InvoiceDetailPage, if ksef_status='sent', show "Sprawdź status" button that calls
check-ksef-status endpoint and refreshes the page.

TASK 7 — Add KSeF column to InvoicesPage table with color-coded badge.

All code in English, UI text in Polish.



---

### PHASE 8 — Reporting & Analytics

**Agent Prompt:**
You are implementing the Reporting module for a Django + React app at "d:\Work\MojeSaldoo App".

CONTEXT:

All domain data is available: orders, invoices, customers, products, stock
Reports are read-only aggregations, no new models needed
Stack: DRF + React 18 + TypeScript + React Query 5 + Tailwind
BACKEND TASKS:

Create backend/apps/reporting/ app with views.py, urls.py, serializers.py.

TASK 1 — Create reporting endpoints (all GET, all scoped by company):

GET /api/reports/sales-summary/?date_from=&date_to=
Returns: { totalOrders, totalGross, totalNet, totalVat, avgOrderValue, byStatus: {...} }

GET /api/reports/invoices/?date_from=&date_to=&status=
Returns: paginated invoice list with ksef_status for reporting view

GET /api/reports/top-products/?date_from=&date_to=&limit=10
Returns: [{ productName, totalQuantity, totalGross }] sorted by revenue

GET /api/reports/top-customers/?date_from=&date_to=&limit=10
Returns: [{ customerName, orderCount, totalGross }]

GET /api/reports/inventory/
Returns: [{ productName, warehouseCode, quantityAvailable, minStockAlert, belowMinimum }]

GET /api/reports/ksef-status/
Returns: { notSent, pending, sent, accepted, rejected } counts + list of rejected invoices

TASK 2 — All queries use Django ORM aggregations (Sum, Count, Avg from django.db.models).
Scope all queries by request.user.current_company.

FRONTEND TASKS:

TASK 3 — Create frontend/src/pages/ReportsPage.tsx:
Dashboard with 4 sections:

Sales Summary card — date range picker, shows: total orders, total gross, avg value
Top Products table — top 10 by revenue in selected period
Top Customers table — top 10 by revenue in selected period
KSeF Status summary — donut-style status counts + list of rejected invoices
TASK 4 — Create frontend/src/services/reporting.service.ts and React Query hooks.

TASK 5 — Add /reports route in App.tsx wrapped in ModuleRoute module='reporting'.

All code in English, UI text in Polish.



---

## Execution Order

| Phase | Name | Priority | Depends On |
|---|---|---|---|
| **0** | Critical bug fixes | **IMMEDIATE** | nothing |
| **2A** | Multi-company backend | Before anything else | Phase 0 |
| **2B** | Onboarding flow (frontend) | After 2A | Phase 2A |
| **2C** | Module routing & navigation | After 2B | Phase 2B |
| **2D** | Certificate upload | After 2A | Phase 2A |
| **4** | Orders | After 2A-2C | Phase 2A |
| **5** | Delivery & WZ | After Orders | Phase 4 |
| **6** | Invoicing (local) | After Delivery | Phase 5 |
| **7** | KSeF | After Invoicing | Phase 6 + Certificate |
| **8** | Reporting | After Orders/Invoices | Phase 4+6 |

---

## How to Use These Prompts

Each prompt is self-contained — copy it into a new agent or a new Claude conversation. The prompts assume you run them in order. When starting a new agent for a phase:

1. Tell it the working directory: `d:\Work\MojeSaldoo App`
2. Paste the prompt
3. The agent will read the current code, implement, and report what changed

**Start now with Phase 0** — it fixes the broken registrations in under 10 minutes and unblocks everything else.

=================================================
Plan implementacji — 3 funkcje
#11 Eksport raportów PDF/Excel
Priorytet: PIERWSZY — najszybszy zysk, backend już gotowy (JSON endpoints), wzorzec pobierania blob istnieje.

Etap 11.1 — Backend CSV endpoints (2 raporty)

GET /api/reports/payment-aging/?format=csv — aging należności (kolumny: klient, nr faktury, termin, dni po terminie, kwota)
GET /api/reports/product-margin/?format=csv — marże per produkt (kolumny: produkt, sprzedana ilość, przychód, avg_cost, marża %)
Wzorzec: if request.query_params.get('format') == 'csv': return StreamingHttpResponse(csv_generator, content_type='text/csv')
Etap 11.2 — Backend CSV dla pozostałych raportów

GET /api/reports/profit-loss/?format=csv
GET /api/reports/supplier-costs/?format=csv
GET /api/reports/inventory/?format=csv
Etap 11.3 — Frontend przyciski "Pobierz CSV"

Utility hook useDownloadReport(url, filename) — fetch blob → <a download> (już gotowy pattern z CostProjectsPage)
Dodać przycisk na każdej stronie raportu: PaymentAgingPage, ProductMarginPage, ProfitLossPage, InventoryReportPage, SupplierCostsPage
Etap 11.4 — Testy

Backend: test że CSV ma poprawne nagłówki i wiersze
Frontend: test że klik przycisku wywołuje fetch z ?format=csv
#7 Indywidualne cenniki per klient
Priorytet: DRUGI — wymaga nowego modelu w backendzie, ale logika jest dobrze zdefiniowana.

Etap 7.1 — Backend model + migracja


class CustomerProductPrice(models.Model):
    company = FK(Company)
    customer = FK(Customer, on_delete=CASCADE)
    product = FK(Product, on_delete=CASCADE)
    price_net = DecimalField(10,2)
    price_gross = DecimalField(10,2)  # wyliczane
    notes = CharField(blank=True)
    created_at / updated_at
    unique_together = [('company','customer','product')]
Etap 7.2 — Backend API

GET/POST /api/customers/{id}/prices/ — lista i tworzenie cen dla klienta
PATCH/DELETE /api/customers/{id}/prices/{product_id}/ — edycja/usuwanie
GET /api/orders/customer-prices/?customer_id=X — endpoint pomocniczy do pobierania cen przy tworzeniu zamówienia (zwraca słownik {product_id: price_net})
Etap 7.3 — Frontend: zarządzanie cennikiem klienta

Nowa zakładka/sekcja na stronie szczegółów klienta (CustomerDetailPage)
Tabela: Produkt | Cena standardowa | Cena indywidualna | Akcje
Dodaj/edytuj/usuń cenę — modal lub inline edit
Etap 7.4 — Frontend: OrderCreatePage integracja

Po wyborze klienta → fetch customer-prices/ dla tego klienta
unitPriceNet linii = cena indywidualna jeśli istnieje, fallback na product.price_net
Wizualnie: badge "cena indyw." przy produkcie który ma niestandardową cenę
Etap 7.5 — Testy

Backend: CRUD cen, że customer-prices/ zwraca właściwy słownik
Frontend: że po wyborze klienta ceny się podmienią
#10 Etykiety QR/EAN
Priorytet: TRZECI — nice-to-have, dobrze zdefiniowane, buduje na istniejącym print pattern.

Etap 10.1 — Biblioteka i drukowanie

Dodać npm install qrcode.react (QR) + npm install jsbarcode lub react-barcode (EAN/Code128)
Nowy komponent LabelPrintView.tsx w components/print/ — wzorowany na WZPrintView
Etap 10.2 — Projekt etykiety

Rozmiar: 58mm×40mm (standardowa etykieta termiczna) + A4 (siatka 4×10)
Zawartość: nazwa produktu, SKU/kod, barcode (EAN-13 jeśli barcode na produkcie, fallback Code128), cena, jednostka
CSS @media print dla obu formatów
Etap 10.3 — Trigger drukowania

Przycisk "Drukuj etykiety" na ProductListPage — checkbox selection + ilość etykiet per produkt
Przycisk "Drukuj etykietę" na ProductEditPage — jednoproduktowy
openLabelPrintWindow(products, quantities) — analogicznie do openWZPrintWindow
Etap 10.4 — Testy

Test że LabelPrintView renderuje poprawną nazwę i jednostkę
Test że barcode generuje się z pola product.barcode
Kolejność pracy

#11 Eksport CSV    [11.1] → [11.2] → [11.3] → [11.4]
#7  Cenniki        [7.1]  → [7.2]  → [7.3]  → [7.4]  → [7.5]
#10 Etykiety       [10.1] → [10.2] → [10.3] → [10.4]


#7 — Customer Prices
Set up a custom price:

Go to Klienci → open any customer
Scroll down — you should see the new "Cenniki indywidualne" section
Click + Dodaj cenę → select a product, enter a price, click Zapisz
The price appears in the table with the default price next to it for comparison
Verify it affects orders:

Go to Zamówienia → Nowe zamówienie
Select the same customer
Scroll the product list — the product with a custom price should show the custom price with a blue "cena indyw." badge instead of the standard price
#10 — Label Printing
Go to Produkty → click any product to open its edit page
Scroll to the bottom — new "Drukuj etykietę" button next to the existing links
Click it → browser print dialog opens with a thermal label (57×35mm with QR code, barcode if set, price in PLN)
#11 — CSV Export
Frontend-generated CSV (already worked before):

Go to Raporty → Należności → "Eksport CSV" button was already there
New backend CSV endpoints — test with "Pobierz CSV" buttons:

Magazyn (/reports/inventory) — "Pobierz CSV" button in the top-right corner
Wynik finansowy P&L (/reports/profit-loss) — "Pobierz CSV" top-right
Marże na produktach (/reports/product-margin) — "Pobierz CSV" top-right
The buttons only appear when there's data. Downloaded files open correctly in Excel (semicolons, UTF-8 BOM, Polish decimal commas).


=================================================
Plan implementacji — Runda 3

#12 Korekty do faktur i dokumentów (FV-KOR, WZ-KOR, PZ-KOR z KSeF)
#13 Eksport PDF raportów (druk przez przeglądarkę)
#14 Powiadomienia push — statusy KSeF (FCM + Capacitor)

Kolejność pracy:
#12 Korekty   [12.1] → [12.2] → [12.3] → [12.4] → [12.5]
#13 PDF       [13.1] → [13.2] → [13.3]
#14 Push      [14.1] → [14.2] → [14.3] → [14.4] → [14.5]

=================================================

#12 Korekty do faktur i dokumentów
Priorytet: PIERWSZY — realna potrzeba prawna/księgowa dla każdej firmy.

Stan wyjściowy:
- PZ-KOR: model gotowy (DOC_TYPE_PZ_KOR, corrects_pz FK w DeliveryDocument)
- FV-KOR: brak — Invoice nie ma pola is_correction ani corrects_invoice FK
- WZ-KOR: brak — DeliveryDocument nie ma DOC_TYPE_WZ_KOR ani corrects_wz FK
- KSeF KOR: ReceivedKSeFInvoice.invoice_type istnieje, brak parsowania FakturaRef

--- 12.1 FV-KOR — Backend ---

TASK A — Rozszerz model Invoice w apps/invoices/models.py:
  is_correction = BooleanField(default=False)
  corrects_invoice = FK('self', null=True, blank=True, on_delete=PROTECT, related_name='corrections')
  correction_reason = TextField(blank=True)
  Numer korekty: generuj "FV-KOR/{year}/{seq:04d}" w save() gdy is_correction=True

TASK B — Endpoint: POST /api/invoices/{id}/create-correction/
  - Walidacja: oryginalna faktura ma status 'issued' lub 'paid'
  - Tworzy nową Invoice z is_correction=True, corrects_invoice=original
  - Kopiuje InvoiceItems z oryginalnej (z możliwością edycji ilości/cen przed zapisem)
  - Nowa faktura trafia w status 'draft'
  - Zwraca {correctionId, correctionNumber}

TASK C — InvoiceCorrectionSerializer:
  - Pole items: lista linii z oryginalnej faktury (edytowalne: quantity_corrected, unit_price_net)
  - Automatycznie liczy różnicę (kwota korekty = nowa wartość - stara wartość)
  - correction_reason wymagane

TASK D — Migracja + testy backendu:
  - Test: create-correction tworzy powiązaną fakturę z is_correction=True
  - Test: nie można skorygować faktury w statusie 'draft'
  - Test: correction_number ma format FV-KOR/YYYY/NNNN

--- 12.2 FV-KOR — Frontend ---

TASK A — InvoiceDetailPage:
  - Dodaj przycisk "Utwórz korektę FV" (widoczny tylko dla status='issued' lub 'paid')
  - Przycisk → nawiguje do /invoices/{id}/correction/new

TASK B — Nowa strona: CorrectionInvoiceCreatePage (/invoices/:id/correction/new):
  - Nagłówek: "Korekta do faktury {originalNumber}"
  - Sekcja: powód korekty (pole tekstowe, wymagane)
  - Tabela linii: pozycje z oryginalnej faktury, edytowalne kolumny:
    - Ilość oryginalna (read-only)
    - Ilość po korekcie (edytowalna)
    - Cena netto oryginalna (read-only)
    - Cena netto po korekcie (edytowalna)
    - Różnica wartości (live-count)
  - Podsumowanie: kwota korekty netto/brutto
  - Przyciski: "Zapisz korektę" (status=draft) + "Zapisz i wystaw" (status=issued)

TASK C — InvoicesPage:
  - Badge "KOR" na korektach (czerwone tło)
  - Kolumna "Koryguje" → link do oryginalnej faktury

TASK D — Testy frontendu:
  - Test: przycisk "Utwórz korektę FV" widoczny tylko dla issued/paid
  - Test: submit wysyła POST do /api/invoices/{id}/create-correction/

--- 12.3 WZ-KOR — Backend ---

TASK A — Rozszerz model DeliveryDocument w apps/delivery/models.py:
  DOC_TYPE_WZ_KOR = "WZ-KOR"  (dodaj do DOC_TYPE_CHOICES)
  corrects_wz = FK('self', null=True, blank=True, on_delete=PROTECT, related_name='wz_corrections')
  Numer: "WZ-KOR/{year}/{seq:04d}"

TASK B — Endpoint: POST /api/delivery/{id}/create-wz-correction/
  - Walidacja: oryginalne WZ ma status 'delivered' lub 'saved'
  - Tworzy nowy DeliveryDocument z document_type='WZ-KOR', corrects_wz=original
  - Kopiuje DeliveryItems (edytowalne quantity_actual — ilość zwrotu)
  - Ruch magazynowy: zwrot towaru do magazynu (StockMovement type='return')

TASK C — Migracja + testy backendu

--- 12.4 WZ-KOR — Frontend ---

TASK A — DeliveryDocumentDetailPage:
  - Przycisk "Utwórz korektę WZ" (dla status='delivered')
  - Strona /delivery/{id}/correction/new — analogicznie do CorrectionInvoiceCreatePage
  - Pola: powód zwrotu, ilości do zwrotu per linia

TASK B — Testy frontendu

--- 12.5 PZ-KOR z KSeF (korekta od dostawcy) ---

Warunek: musi być przetestowane z prawdziwą fakturą korygującą z KSeF!
Dopóki nie ma testu — implementacja może być oparta na założeniu struktury XML.

TASK A — Backend: rozszerz ReceivedKSeFInvoiceParseView (/api/ksef/inbox/{num}/parse/):
  - Jeśli invoice_type == "KOR" → parsuj też FakturaRef/NrKSeF z XML (referencja do oryginału)
  - Zwróć dodatkowe pole: { isCorrection: true, originalKsefNumber: "...", originalPzId: "..." }
  - Szukaj originalPzId przez: DeliveryDocument.objects.filter(ksef_invoice_id=originalKsefNumber).first()

TASK B — Frontend: KSeF inbox list:
  - Dla invoice_type="KOR" → pokaż badge "KOREKTA" zamiast "FV"
  - Przycisk "Utwórz PZ-KOR" zamiast "Utwórz PZ"

TASK C — Frontend: KSeFInboxPZPage — dodaj wariant PZ-KOR:
  - Jeśli isCorrection=true → pre-fill formularz jako PZ-KOR
  - Pokaż powiązane oryginalne PZ (jeśli znalezione)
  - Ilości: ujemne (korekta in-minus)
  - Submit → POST /api/delivery/create-pz/ z doc_type='PZ-KOR'

TASK D — Testy (po otrzymaniu prawdziwej faktury KOR z KSeF)

=================================================

#13 Eksport PDF raportów
Priorytet: DRUGI — zero nowych zależności, buduje na wzorcu WZPrintView/InvoicePrintView.

Podejście: browser print z CSS @media print (identyczny wzorzec jak istniejące wydruki WZ i faktur).
Brak nowych bibliotek — window.print() + CSS print styles.

--- 13.1 Wspólny komponent PrintReportHeader ---

Nowy plik: frontend/src/components/print/PrintReportHeader.tsx
Props: { title: string; companyName: string; dateFrom?: string; dateTo?: string; generatedAt?: string }
Renderuje: nazwa firmy, tytuł raportu, zakres dat, data wygenerowania
Widoczny TYLKO przy druku (@media print) — ukryty w normalnym widoku

--- 13.2 CSS @media print per strona raportu ---

Dla każdej strony: PaymentAgingPage, ProductMarginPage, ProfitLossPage, InventoryReportPage, SupplierCostsPage:
  - Ukryj przy druku: sidebar/nav, przyciski filtrów, przycisk "Pobierz CSV", pagination
  - Pokaż przy druku: PrintReportHeader, pełna tabela (bez obcięcia), kolumny na całą szerokość
  - Dodaj @page { size: A4 landscape; margin: 10mm } dla tabel z wieloma kolumnami
  - page-break-inside: avoid na każdym wierszu tabeli
  - Dodaj klasę print:hidden do elementów które nie powinny się drukować

--- 13.3 Przycisk "Drukuj PDF" ---

Na każdej stronie raportu — obok istniejącego "Pobierz CSV":
  <Button variant="outline" onClick={() => window.print()}>
    🖨 Drukuj / Zapisz PDF
  </Button>
Tooltip: "Użyj 'Zapisz jako PDF' w oknie druku przeglądarki"

Testy:
  - Test że przycisk renderuje się gdy są dane
  - Test że PrintReportHeader wyświetla tytuł i datę

=================================================

#14 Powiadomienia push — statusy KSeF
Priorytet: TRZECI — wymaga Firebase account + konfiguracji Capacitor.

Architektura:
  Backend:  firebase-admin SDK → wysyła FCM notification do tokenu urządzenia
  Mobile:   @capacitor/push-notifications → rejestruje urządzenie, token → backend
  Web:      Web Push API (przez Firebase) — opcjonalnie

--- 14.1 Firebase setup ---

TASK A — Utwórz projekt Firebase:
  - console.firebase.google.com → New Project "MojeSaldoo"
  - Enable Cloud Messaging
  - Pobierz serviceAccountKey.json (Project Settings → Service Accounts)
  - Zapisz jako backend/firebase-credentials.json (NEVER commit — dodaj do .gitignore!)
  - Skopiuj FIREBASE_CREDENTIALS_PATH=./firebase-credentials.json do .env

TASK B — Backend: dodaj firebase-admin do requirements.txt:
  firebase-admin==6.4.0

--- 14.2 Backend: model + endpoint rejestracji tokenu ---

TASK A — Nowy model w apps/users/models.py lub nowy plik apps/notifications/models.py:

  class FCMDeviceToken(models.Model):
      id = UUIDField PK
      user = FK(User, CASCADE, related_name='fcm_tokens')
      token = CharField(max_length=512, unique=True)
      device_type = CharField(choices=[('android','Android'),('ios','iOS'),('web','Web')], max_length=10)
      is_active = BooleanField(default=True)
      created_at, updated_at

TASK B — Endpoint: POST /api/notifications/register-token/
  Przyjmuje: { token, device_type }
  Tworzy lub aktualizuje FCMDeviceToken dla zalogowanego użytkownika

TASK C — Endpoint: DELETE /api/notifications/unregister-token/
  Deaktywuje token (na wylogowanie)

TASK D — Serwis powiadomień: apps/notifications/push_service.py:
  def send_notification(user, title, body, data={}):
      tokens = FCMDeviceToken.objects.filter(user=user, is_active=True)
      for device in tokens:
          firebase_admin.messaging.send(Message(
              notification=Notification(title=title, body=body),
              data=data,
              token=device.token
          ))

--- 14.3 Backend: triggery powiadomień z KSeF ---

W apps/ksef/views.py — po każdej zmianie statusu (KSeFSentInvoice):
  Po statusie 'accepted':
    send_notification(user, "KSeF: Faktura przyjęta ✓",
      f"Faktura {invoice.invoice_number} została przyjęta przez KSeF",
      {"type": "ksef_accepted", "invoiceId": str(invoice.id)})
  Po statusie 'rejected':
    send_notification(user, "KSeF: Faktura odrzucona ✗",
      f"Faktura {invoice.invoice_number} odrzucona: {error_message}",
      {"type": "ksef_rejected", "invoiceId": str(invoice.id)})
  Po pobraniu UPO:
    send_notification(user, "KSeF: UPO pobrane",
      f"Urzędowe poświadczenie odbioru dla {invoice.invoice_number} gotowe",
      {"type": "ksef_upo", "invoiceId": str(invoice.id)})

--- 14.4 Frontend: rejestracja urządzenia (Capacitor) ---

TASK A — Instalacja:
  npm install @capacitor/push-notifications
  npx cap sync android

TASK B — Nowy hook: frontend/src/hooks/usePushNotifications.ts:
  - Inicjalizuje @capacitor/push-notifications
  - Żąda uprawnień (requestPermissions)
  - Po uzyskaniu tokenu FCM → POST /api/notifications/register-token/
  - Nasłuchuje na przychodzące notyfikacje → przekierowuje do właściwej strony (na podstawie data.type)
  - Na wylogowaniu → DELETE /api/notifications/unregister-token/

TASK C — Integracja w App.tsx:
  - Wywołaj usePushNotifications() po zalogowaniu użytkownika
  - Obsłuż deep link: ksef_accepted/ksef_rejected → /invoices/{invoiceId}

--- 14.5 Testy ---

Backend:
  - Test że register-token tworzy FCMDeviceToken
  - Mock firebase_admin.messaging.send → test że send_notification wywołuje go z prawdziwym tokenem
  - Test że trigger po 'accepted' wysyła powiadomienie

Frontend:
  - Mock @capacitor/push-notifications → test że hook rejestruje token
  - Test że po otrzymaniu powiadomienia ksef_rejected → nawiguje do /invoices/{id}


Niski priorytet / przyszłość:

Synchronizacja offline
Multi-tenancy
OCR

=================================================
#15 — Nowy Onboarding: wybór profilu firmy i aktywacja modułów
Priorytet: WYSOKI — bezpośrednio wpływa na konwersję nowych użytkowników i personalizację UX

Cel: Zastąpienie obecnego formularza rejestracyjnego (NIP, adres, dane firmy) nowym
przepływem: Google/email sign-up → kafelki aktywności → metoda dostawy → moduły aktywne →
dashboard z nudge barem. Użytkownik nie podaje żadnych danych firmy do momentu gdy są
faktycznie potrzebne (pierwszy KSeF send).

--- 15.1 Backend: model Company — nowe pola ---

W backend/apps/users/models.py dodaj do modelu Company:

  COMPANY_TYPE_CHOICES = [
      ('invoicing',   'Tylko fakturowanie'),
      ('van_selling', 'Van Selling'),
      ('warehouse',   'Magazyn i handel'),
      ('production',  'Produkcja'),
      ('mixed',       'Mieszany'),
  ]

  company_type = models.CharField(
      max_length=20, choices=COMPANY_TYPE_CHOICES,
      default='invoicing', blank=True,
  )
  onboarding_completed = models.BooleanField(default=False)

Migracja: python manage.py makemigrations users

--- 15.2 Backend: CompanyModule — weryfikacja i uzupełnienie pól ---

W backend/apps/users/models.py sprawdź model CompanyModule.
Muszą istnieć następujące pola BooleanField (default=False jeśli opcjonalne, True jeśli core):

  invoicing       = BooleanField(default=True)   # zawsze True
  ksef            = BooleanField(default=True)   # zawsze True
  customers       = BooleanField(default=True)   # zawsze True
  orders          = BooleanField(default=True)   # zawsze True
  purchasing      = BooleanField(default=False)  # kafelek 🛒
  warehouses      = BooleanField(default=False)  # kafelek 🏪
  production      = BooleanField(default=False)  # kafelek 🛠️
  cost_allocation = BooleanField(default=False)  # kafelek 💼
  delivery        = BooleanField(default=False)  # Screen 2 (📦 lub 🚐)
  van_routes      = BooleanField(default=False)  # Screen 2 🚐 tylko
  ksef_inbox      = BooleanField(default=False)  # kafelek 🛒 LUB 💼
  reporting       = BooleanField(default=True)   # zawsze True

Dodaj brakujące pola, stwórz migrację:
  python manage.py makemigrations users

--- 15.3 Backend: endpoint onboarding/complete/ ---

Nowy plik backend/apps/users/onboarding_views.py:

POST /api/onboarding/complete/
Body:
{
  "activity_tiles": ["purchasing", "production", "warehouses"],
  "delivery_method": "van_routes"  // "van_routes" | "delivery" | "docs_only" | null
}

Logika:
1. Pobierz lub utwórz CompanyModule dla current_company
2. Zawsze ustaw: invoicing=True, ksef=True, customers=True, orders=True, reporting=True
3. Dla każdego tile w activity_tiles:
   - "purchasing"      → purchasing=True, ksef_inbox=True
   - "production"      → production=True, warehouses=True
   - "warehouses"      → warehouses=True
   - "cost_allocation" → cost_allocation=True, ksef_inbox=True
4. Dla delivery_method:
   - "van_routes"  → delivery=True, van_routes=True
   - "delivery"    → delivery=True, van_routes=False
   - "docs_only"   → delivery=True, van_routes=False
   - null          → delivery=False (tylko faktury)
5. Wnioskuj company_type z kombinacji:
   - production=True                          → "production"
   - purchasing=True AND van_routes=True      → "van_selling"
   - purchasing=True AND van_routes=False     → "warehouse"
   - tylko invoicing/cost_allocation          → "invoicing"
   - inne                                     → "mixed"
6. Zapisz CompanyModule, ustaw company.company_type i company.onboarding_completed=True
7. Zwróć: { "company_type": ..., "modules": { ...wszystkie flagi... } }

Dodaj do backend/apps/users/urls.py:
  path('onboarding/complete/', OnboardingCompleteView.as_view()),

--- 15.4 Backend: /api/users/me/ — zwróć onboarding_completed ---

W UserSerializer (lub dedykowanym MeSerializer) dodaj pola:
  onboarding_completed = serializers.BooleanField(source='current_company.onboarding_completed', read_only=True)
  company_type = serializers.CharField(source='current_company.company_type', read_only=True)
  modules = serializers.SerializerMethodField()

  def get_modules(self, obj):
      if not obj.current_company:
          return {}
      mod = CompanyModule.objects.filter(company=obj.current_company).first()
      if not mod:
          return {}
      return {
          'invoicing': mod.invoicing, 'ksef': mod.ksef,
          'purchasing': mod.purchasing, 'warehouses': mod.warehouses,
          'production': mod.production, 'cost_allocation': mod.cost_allocation,
          'delivery': mod.delivery, 'van_routes': mod.van_routes,
          'ksef_inbox': mod.ksef_inbox, 'reporting': mod.reporting,
      }

--- 15.5 Backend: testy ---

Nowy plik backend/apps/users/tests_onboarding.py:

class OnboardingCompleteTests(TestCase):
  test_van_seller_tiles_activate_correct_modules:
    POST tiles=["purchasing"], delivery="van_routes"
    → purchasing=True, van_routes=True, delivery=True, ksef_inbox=True
    → company_type="van_selling"

  test_producer_tiles:
    POST tiles=["production", "purchasing"], delivery="delivery"
    → production=True, warehouses=True, purchasing=True, delivery=True
    → company_type="production"

  test_invoicing_only_no_delivery_screen:
    POST tiles=[], delivery=null
    → tylko core modules True
    → company_type="invoicing"

  test_cost_annotation_unlocks_ksef_inbox:
    POST tiles=["cost_allocation"], delivery=null
    → cost_allocation=True, ksef_inbox=True

  test_onboarding_completed_flag_set:
    Po POST → company.onboarding_completed=True

  test_me_endpoint_returns_modules:
    GET /api/users/me/ → modules dict zawiera wszystkie flagi

--- 15.6 Frontend: typy i serwis ---

Nowy plik frontend/src/types/onboarding.types.ts:

  export type ActivityTile =
    | 'purchasing'
    | 'production'
    | 'warehouses'
    | 'cost_allocation';

  export type DeliveryMethod = 'van_routes' | 'delivery' | 'docs_only';

  export interface OnboardingPayload {
    activity_tiles: ActivityTile[];
    delivery_method: DeliveryMethod | null;
  }

  export interface CompanyModules {
    invoicing: boolean;
    ksef: boolean;
    purchasing: boolean;
    warehouses: boolean;
    production: boolean;
    cost_allocation: boolean;
    delivery: boolean;
    van_routes: boolean;
    ksef_inbox: boolean;
    reporting: boolean;
  }

Nowy plik frontend/src/services/onboarding.service.ts:

  export const onboardingService = {
    complete: (payload: OnboardingPayload) =>
      api.post('/api/onboarding/complete/', payload),
  };

--- 15.7 Frontend: hook ---

Nowy plik frontend/src/query/use-onboarding.ts:

  export function useCompleteOnboardingMutation() {
    const queryClient = useQueryClient();
    return useMutation({
      mutationFn: onboardingService.complete,
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ['me'] });
      },
    });
  }

Zaktualizuj istniejący hook useMe() / useUserProfile() aby zwracał:
  { onboarding_completed, company_type, modules }

--- 15.8 Frontend: komponenty onboardingu ---

Nowy katalog frontend/src/components/onboarding/

PLIK 1: ActivityTilesStep.tsx
  Props: { selected: ActivityTile[], onChange: (tiles: ActivityTile[]) => void }
  Renderuje siatkę 2x2 kafelków + zawsze aktywny kafelek "Faktury".
  Każdy kafelek: ikona (duża, 2rem), tytuł (bold), opis (text-sm, muted), stan selected
  (kolorowe obramowanie + checkmark w rogu).
  Kafelek "Faktury" ma inny styl (szary, lock icon) — nie można odznaczyć.

PLIK 2: DeliveryMethodStep.tsx
  Props: { onSelect: (method: DeliveryMethod) => void }
  Renderuje 3 duże kafelki (pełna szerokość) — tap = natychmiastowe przejście.
  🚐 Jeżdżę w trasie / 📦 Wysyłam lub klient odbiera / 📋 Tylko dokumenty i faktury

PLIK 3: ModuleSummaryStep.tsx
  Props: { modules: CompanyModules, onConfirm: () => void, loading: boolean }
  Lista aktywnych modułów z zielonymi checkboxami.
  Nieaktywne moduły z przyciskiem inline "Włącz".
  Nota: "Możesz zmienić to zawsze w Ustawienia → Moduły"
  Przycisk "Zacznij korzystać →"

PLIK 4: OnboardingProgressDots.tsx
  Props: { total: number, current: number }
  Proste kropki ● ○ ○ jako wskaźnik postępu.

--- 15.9 Frontend: strona OnboardingPage ---

Nowy plik frontend/src/pages/OnboardingPage.tsx

  Stany lokalne:
    step: 1 | 2 | 3  (1=kafelki, 2=dostawa, 3=podsumowanie)
    selectedTiles: ActivityTile[]
    deliveryMethod: DeliveryMethod | null

  Logika:
    handleTilesNext():
      const needsDelivery = selectedTiles.some(t =>
        ['purchasing','production','warehouses'].includes(t))
      if (needsDelivery) setStep(2)
      else computeModulesAndGoToStep3()

    handleDeliverySelect(method):
      setDeliveryMethod(method)
      setStep(3)

    handleConfirm():
      mutation.mutate({ activity_tiles: selectedTiles, delivery_method: deliveryMethod })
      // onSuccess → navigate('/') dzięki invalidateQueries(['me'])

  Render:
    <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-background">
      <OnboardingProgressDots total={needsDelivery ? 3 : 2} current={step} />
      {step === 1 && <ActivityTilesStep ... />}
      {step === 2 && <DeliveryMethodStep ... />}
      {step === 3 && <ModuleSummaryStep ... />}
    </div>

--- 15.10 Frontend: routing — guard onboardingu ---

W frontend/src/App.tsx (lub router config):

  Stwórz komponent OnboardingGuard:
    const { data: me } = useMe();
    if (!me) return null; // loading
    if (!me.onboarding_completed) return <Navigate to="/onboarding" />;
    return <>{children}</>;

  Opakuj wszystkie chronione trasy w <OnboardingGuard>:
    <Route path="/onboarding" element={<OnboardingPage />} />
    <Route element={<OnboardingGuard><AppLayout /></OnboardingGuard>}>
      ... wszystkie istniejące trasy ...
    </Route>

--- 15.11 Frontend: nawigacja zależna od modułów ---

W komponencie Sidebar.tsx / Navigation.tsx:

  Pobierz modules z useMe().data.modules
  Każdy item nawigacji ma przypisany moduł, np.:

  const NAV_ITEMS = [
    { path: '/products',    label: 'Produkty',    module: 'warehouses'      },
    { path: '/customers',   label: 'Klienci',     module: null              }, // zawsze
    { path: '/orders',      label: 'Zamówienia',  module: null              }, // zawsze
    { path: '/delivery',    label: 'Dostawa',     module: 'delivery'        },
    { path: '/van-routes',  label: 'Trasa',       module: 'van_routes'      },
    { path: '/production',  label: 'Produkcja',   module: 'production'      },
    { path: '/purchasing',  label: 'Zakupy',      module: 'purchasing'      },
    { path: '/invoices',    label: 'Faktury',     module: null              }, // zawsze
    { path: '/ksef',        label: 'KSeF',        module: null              }, // zawsze
    { path: '/reports',     label: 'Raporty',     module: null              }, // zawsze
    { path: '/costs',       label: 'Koszty',      module: 'cost_allocation' },
  ];

  Renderuj item tylko gdy:
    item.module === null  ||  modules?.[item.module] === true

--- 15.12 Frontend: SetupNudgeBar na dashboardzie ---

Nowy plik frontend/src/components/SetupNudgeBar.tsx

  Sprawdza:
    hasProducts  = useProductsQuery().data?.count > 0
    hasCustomers = useCustomerListQuery().data?.count > 0
    hasCompanyDetails = !!me?.company?.nip

  Wyświetla pasek tylko gdy co najmniej jeden krok nieukończony.
  Każdy krok klikalny → nawiguje do właściwej strony.
  Przycisk ✕ w rogu → zapisz 'setup_nudge_dismissed' w localStorage → ukryj.
  Pasek znika automatycznie gdy wszystkie 3 kroki gotowe.

  Dodaj <SetupNudgeBar /> na górze <DashboardPage /> (lub w <AppLayout />
  tylko dla / ścieżki).

--- 15.13 Frontend: testy ---

frontend/src/pages/OnboardingPage.test.tsx:
  - test że po wyborze tylko 💼/📋 → krok dostawy pominięty
  - test że po wyborze 🛒 → krok dostawy pokazany
  - test że tap kafelka delivery → przechodzi do podsumowania
  - test że onConfirm wywołuje POST /api/onboarding/complete/ z prawidłowym body
  - test że po sukcesie → navigate('/')

frontend/src/components/onboarding/ActivityTilesStep.test.tsx:
  - test że kafelek "Faktury" nie może być odznaczony
  - test że zaznaczenie kafelka zmienia jego styl (selected)
  - test że "Dalej" zablokowane gdy żaden kafelek nie wybrany (poza Faktury)

frontend/src/components/SetupNudgeBar.test.tsx:
  - test że nie renderuje się gdy wszystkie kroki ukończone
  - test że ✕ powoduje ukrycie i zapis w localStorage

--- Kolejność implementacji ---

Etap A (backend): 15.1 → 15.2 → 15.3 → 15.4 → 15.5
Etap B (frontend): 15.6 → 15.7 → 15.8 → 15.9 → 15.10 → 15.11 → 15.12 → 15.13

Etap C (opcjonalny, później): Google OAuth
  Backend: pip install django-allauth, konfiguracja providers, endpoint /api/auth/google/
  Frontend: @react-oauth/google, przycisk "Kontynuuj z Google" na Ekranie 1

--- Definicja "gotowe" ---

✅ Nowy użytkownik może zarejestrować się email+hasło bez podawania NIP
✅ Wybór kafelków zapisuje CompanyModule flags w DB
✅ Nawigacja ukrywa moduły nieaktywne dla danej firmy
✅ GET /api/users/me/ zwraca onboarding_completed + modules
✅ Użytkownik z onboarding_completed=False jest przekierowywany na /onboarding
✅ SetupNudgeBar widoczny na dashboardzie dla nowych użytkowników
✅ Wszystkie testy przechodzą