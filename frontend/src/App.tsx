import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { RequireCompanyForApp } from '@/components/auth/RequireCompanyForApp';
import { AppLayout } from '@/components/layout/AppLayout';
import { ModuleRouteGate } from '@/components/layout/ModuleRoute';
import { EnsureCurrentCompany } from '@/components/auth/EnsureCurrentCompany';
import { AuthProvider } from '@/context/AuthContext';
import { Home } from './pages/Home';
import { LoginPage } from './pages/LoginPage';
import { CustomersPage } from './pages/CustomersPage';
import { CustomerCreatePage } from './pages/CustomerCreatePage';
import { ProductsPage } from './pages/ProductsPage';
import { ProductCreatePage } from './pages/ProductCreatePage';
import { ProductAdjustStockPage } from './pages/ProductAdjustStockPage';
import { WarehousesPage } from './pages/WarehousesPage';
import { WarehouseCreatePage } from './pages/WarehouseCreatePage';
import { OnboardingPage } from './pages/OnboardingPage';
import { CompanySettingsPage } from './pages/CompanySettingsPage';
import { CompanyDataPage } from './pages/CompanyDataPage';
import { CertificateUploadPage } from './pages/CertificateUploadPage';
import { OrdersPage } from './pages/OrdersPage';
import { OrderCreatePage } from './pages/OrderCreatePage';
import { OrderDetailPage } from './pages/OrderDetailPage';

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
                      <AppPlaceholderPage title="Delivery" />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/invoices"
                  element={
                    <ModuleRouteGate module="invoicing">
                      <AppPlaceholderPage title="Invoices" />
                    </ModuleRouteGate>
                  }
                />
                <Route
                  path="/reports"
                  element={
                    <ModuleRouteGate module="reporting">
                      <AppPlaceholderPage title="Reports" />
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
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
