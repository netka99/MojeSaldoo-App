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
