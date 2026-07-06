# Registration Flow

## Overview

No email verification — users are active immediately after registration. Multi-tenancy is application-level (not django-tenants).

---

## Step-by-Step Flow

### 1. User fills registration form (`/register`)

Fields: `first_name`, `last_name`, `email`, `username`, `password`, `password2`

Frontend validates: passwords match, minimum 8 characters.

**File:** `frontend/src/pages/RegisterPage.tsx`

---

### 2. `POST /api/auth/register/`

**Handler:** `UserRegistrationView` — `backend/apps/users/views.py`

- `UserRegistrationSerializer` validates password strength + match
- Calls `User.objects.create_user()`
- Returns HTTP 201 with user data
- No email verification — user is active immediately

---

### 3. Auto-login: `POST /api/auth/login/`

Frontend immediately logs in after registration.

- Backend returns JWT access + refresh tokens
- Frontend stores tokens in `localStorage`

---

### 4. Fetch current user: `GET /api/auth/me/`

Returns `AuthUser` with `current_company`, role, and permissions.

If user has no company yet, `get_request_company()` in `tenant.py` auto-creates a personal org + admin membership.

---

### 5. Redirect to `/onboarding`

User selects:
- **Activity tiles** — purchasing, production, warehouses, invoicing, van routes...
- **Taxation form** — `kpir` or `ryczalt` (+ rate category if ryczalt)

Frontend POSTs to `POST /api/auth/onboarding/complete/`

**Handler:** `OnboardingCompleteView` — `backend/apps/users/onboarding_views.py`

Backend:
- Creates/updates `CompanyModule` rows — enables modules based on tile selections
- Sets `company_type` (priority: Production > VanSelling > Warehouse > Invoicing)
- Sets `taxation_form` and `ryczalt_category` on Company
- Sets `Company.onboarding_completed = True`

---

### 6. Redirect to dashboard

---

## Flow Diagram

```
User fills form (RegisterPage.tsx)
  │
  ▼
POST /api/auth/register/
  │  UserRegistrationSerializer validates
  │  User.objects.create_user()
  │  → HTTP 201
  │
  ▼
POST /api/auth/login/
  │  JWT tokens returned
  │  Stored in localStorage
  │
  ▼
GET /api/auth/me/
  │  Returns AuthUser + current_company
  │  (auto-creates company if none)
  │
  ▼
/onboarding page
  │  User selects tiles + taxation form
  │
  ▼
POST /api/auth/onboarding/complete/
  │  Enables CompanyModules
  │  Sets company_type, taxation_form
  │  onboarding_completed = True
  │
  ▼
Dashboard
```

---

## Database Models

### User

| Field | Type | Notes |
|-------|------|-------|
| `uuid` | UUIDField | unique |
| `username` | CharField | unique |
| `email` | EmailField | optional, unique |
| `first_name`, `last_name` | CharField | |
| `phone_number` | CharField | optional |
| `current_company` | FK → Company | active company context |
| `is_active` | BooleanField | default True |
| `created_at`, `updated_at` | DateTimeField | |

---

### Company

| Field | Type | Notes |
|-------|------|-------|
| `uuid` | UUIDField | unique |
| `name` | CharField | |
| `nip` | CharField | Polish Tax ID, optional |
| `address`, `city`, `postal_code` | CharField | |
| `taxation_form` | CharField | `kpir` or `ryczalt` |
| `ryczalt_category` | CharField | tax rate, nullable |
| `company_type` | CharField | `invoicing`, `van_selling`, `warehouse`, `production`, `mixed` |
| `onboarding_completed` | BooleanField | default False |
| `deleted_at` | DateTimeField | soft delete |

---

### CompanyMembership *(User ↔ Company junction)*

| Field | Type | Notes |
|-------|------|-------|
| `user` | FK → User | |
| `company` | FK → Company | |
| `role` | CharField | legacy: `admin`, `manager`, `driver`, `viewer` |
| `company_role` | FK → CompanyRole | fine-grained permissions |
| `is_active` | BooleanField | |
| `joined_at` | DateTimeField | |

Constraint: `unique_together(user, company)`

---

### CompanyRole *(per-company role template)*

| Field | Type | Notes |
|-------|------|-------|
| `company` | FK → Company | |
| `name` | CharField | e.g. "Administrator", "Kierowca" |
| `is_admin` | BooleanField | True = all permissions |
| `can_manage_team` | BooleanField | |
| `can_manage_products` | BooleanField | |
| `can_manage_warehouses` | BooleanField | |
| `can_manage_orders` | BooleanField | |
| `can_manage_invoices` | BooleanField | |
| `can_manage_purchasing` | BooleanField | |
| `can_manage_production` | BooleanField | |
| `can_view_reports` | BooleanField | |
| `can_access_ksef_inbox` | BooleanField | |
| *(+ ~8 more flags)* | BooleanField | |

An "Administrator" role (all permissions = True) is **auto-created** for every new company.

---

### CompanyModule *(per-company feature flags)*

| Field | Type | Notes |
|-------|------|-------|
| `company` | FK → Company | |
| `module` | CharField | see choices below |
| `is_enabled` | BooleanField | |
| `enabled_at` | DateTimeField | nullable |

Module choices: `products`, `customers`, `warehouses`, `orders`, `delivery`, `invoicing`, `van_routes`, `purchasing`, `production`, `ksef_inbox`, `ksef`, `reporting`, `cost_allocation`

---

## Multi-tenancy

No `django-tenants`. Application-level multi-tenancy:

- Every queryset is scoped to `user.current_company_id` via `filter_queryset_for_current_company()` — `backend/apps/users/tenant.py`
- User can belong to **multiple companies** via `CompanyMembership`
- Active context is set by `user.current_company`
- User can switch active company: `POST /api/companies/switch/`
- If user has no company, `get_request_company()` auto-creates a personal org

---

## Key Files

| File | Purpose |
|------|---------|
| `backend/apps/users/models.py` | User, Company, Membership, Role, Module models |
| `backend/apps/users/views.py` | Registration, login, company CRUD |
| `backend/apps/users/serializers.py` | Validation + serialization |
| `backend/apps/users/onboarding_views.py` | Onboarding completion logic |
| `backend/apps/users/tenant.py` | Company context resolver |
| `backend/apps/users/google_auth_views.py` | Google OAuth (has email verification) |
| `backend/apps/users/urls.py` | Auth URL routes |
| `backend/apps/users/company_urls.py` | Company URL routes |
| `frontend/src/pages/RegisterPage.tsx` | Registration form |
| `frontend/src/context/AuthContext.tsx` | Auth state management |
| `frontend/src/services/api.ts` | API client |

---

## Notes

- **No email verification** on standard registration — Google OAuth does verify email
- **Password reset** available via `POST /api/auth/password-reset/` (Django token, 24h expiry)
- **JWT auth only** — `rest_framework_simplejwt`, tokens stored in `localStorage`
- **Soft delete** on companies via `deleted_at` field
