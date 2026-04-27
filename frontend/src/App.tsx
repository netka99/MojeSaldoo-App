import { lazy, Suspense } from 'react';
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { RequireCompanyForApp } from '@/components/auth/RequireCompanyForApp';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModuleRouteGate } from '@/components/layout/ModuleRoute';
import { EnsureCurrentCompany } from '@/components/auth/EnsureCurrentCompany';
import { AuthProvider } from '@/context/AuthContext';

const Home = lazy(() => import('./pages/Home').then((m) => ({ default: m.Home })));
const LoginPage = lazy(() => import('./pages/LoginPage').then((m) => ({ default: m.LoginPage })));
const CustomersPage = lazy(() =>
  import('./pages/CustomersPage').then((m) => ({ default: m.CustomersPage })),
);
const CustomerCreatePage = lazy(() =>
  import('./pages/CustomerCreatePage').then((m) => ({ default: m.CustomerCreatePage })),
);
const ProductsPage = lazy(() => import('./pages/ProductsPage').then((m) => ({ default: m.ProductsPage })));
const ProductCreatePage = lazy(() =>
  import('./pages/ProductCreatePage').then((m) => ({ default: m.ProductCreatePage })),
);
const ProductAdjustStockPage = lazy(() =>
  import('./pages/ProductAdjustStockPage').then((m) => ({ default: m.ProductAdjustStockPage })),
);
const WarehousesPage = lazy(() =>
  import('./pages/WarehousesPage').then((m) => ({ default: m.WarehousesPage })),
);
const WarehouseCreatePage = lazy(() =>
  import('./pages/WarehouseCreatePage').then((m) => ({ default: m.WarehouseCreatePage })),
);
const OnboardingPage = lazy(() =>
  import('./pages/OnboardingPage').then((m) => ({ default: m.OnboardingPage })),
);
const CompanySettingsPage = lazy(() =>
  import('./pages/CompanySettingsPage').then((m) => ({ default: m.CompanySettingsPage })),
);
const CompanyDataPage = lazy(() =>
  import('./pages/CompanyDataPage').then((m) => ({ default: m.CompanyDataPage })),
);
const CertificateUploadPage = lazy(() =>
  import('./pages/CertificateUploadPage').then((m) => ({ default: m.CertificateUploadPage })),
);
const OrdersPage = lazy(() => import('./pages/OrdersPage').then((m) => ({ default: m.OrdersPage })));
const OrderCreatePage = lazy(() =>
  import('./pages/OrderCreatePage').then((m) => ({ default: m.OrderCreatePage })),
);
const OrderDetailPage = lazy(() =>
  import('./pages/OrderDetailPage').then((m) => ({ default: m.OrderDetailPage })),
);
const DeliveryDocumentsPage = lazy(() =>
  import('./pages/DeliveryDocumentsPage').then((m) => ({ default: m.DeliveryDocumentsPage })),
);
const DeliveryDocumentDetailPage = lazy(() =>
  import('./pages/DeliveryDocumentDetailPage').then((m) => ({ default: m.DeliveryDocumentDetailPage })),
);
const InvoicesPage = lazy(() => import('./pages/InvoicesPage').then((m) => ({ default: m.InvoicesPage })));
const InvoiceCreatePage = lazy(() =>
  import('./pages/InvoiceCreatePage').then((m) => ({ default: m.InvoiceCreatePage })),
);
const InvoiceDetailPage = lazy(() =>
  import('./pages/InvoiceDetailPage').then((m) => ({ default: m.InvoiceDetailPage })),
);
const ReportsPage = lazy(() =>
  import('./pages/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);

function RouteFallback() {
  return (
    <div className="flex min-h-[40vh] items-center justify-center text-sm text-muted-foreground">
      Ładowanie…
    </div>
  );
}

function AppPlaceholderPage({ title }: { title: string }) {
  return (
    <div className="max-w-2xl p-6">
      <h1 className="text-2xl font-semibold text-foreground">{title}</h1>
      <p className="mt-2 text-sm text-muted-foreground">This section is not implemented yet.</p>
    </div>
  );
}

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <EnsureCurrentCompany />
        <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route path="/onboarding" element={<OnboardingPage />} />
            <Route element={<RequireCompanyForApp />}>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Home />} />
                <Route
                  path="/customers"
                  element={
                    <ModuleRouteGate module="customers">
                      <CustomersPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/customers/new"
                  element={
                    <ModuleRouteGate module="customers">
                      <CustomerCreatePage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/products"
                  element={
                    <ModuleRouteGate module="products">
                      <ProductsPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/products/new"
                  element={
                    <ModuleRouteGate module="products">
                      <ProductCreatePage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/products/:id/adjust-stock"
                  element={
                    <ModuleRouteGate module="products">
                      <ProductAdjustStockPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/warehouses"
                  element={
                    <ModuleRouteGate module="warehouses">
                      <WarehousesPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/warehouses/new"
                  element={
                    <ModuleRouteGate module="warehouses">
                      <WarehouseCreatePage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/orders"
                  element={
                    <ModuleRouteGate module="orders">
                      <OrdersPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/orders/new"
                  element={
                    <ModuleRouteGate module="orders">
                      <OrderCreatePage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/orders/:id"
                  element={
                    <ModuleRouteGate module="orders">
                      <OrderDetailPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/delivery"
                  element={
                    <ModuleRouteGate module="delivery">
                      <DeliveryDocumentsPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/delivery/:id"
                  element={
                    <ModuleRouteGate module="delivery">
                      <DeliveryDocumentDetailPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/invoices"
                  element={
                    <ModuleRouteGate module="invoicing">
                      <InvoicesPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/invoices/new"
                  element={
                    <ModuleRouteGate module="invoicing">
                      <InvoiceCreatePage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/invoices/:id"
                  element={
                    <ModuleRouteGate module="invoicing">
                      <InvoiceDetailPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <ModuleRouteGate module="reporting">
                      <ReportsPage />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/ksef"
                  element={
                    <ModuleRouteGate module="ksef">
                      <AppPlaceholderPage title="KSeF" />
                    </ModuleRouteGate>
                  }
                />
                <Route path="/settings/company" element={<CompanySettingsPage />} />
                <Route path="/settings/company-data" element={<CompanyDataPage />} />
                <Route
                  path="/settings/certificate"
                  element={
                    <ModuleRouteGate module="ksef">
                      <CertificateUploadPage />
                    </ModuleRouteGate>
                  }
                />
              </Route>
            </Route>
          </Route>
        </Routes>
        </Suspense>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
