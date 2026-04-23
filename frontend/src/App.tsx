import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { RequireAuth } from '@/components/auth/RequireAuth';
import { AppLayout } from '@/components/layout/AppLayout';
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

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route element={<RequireAuth />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/customers" element={<CustomersPage />} />
              <Route path="/customers/new" element={<CustomerCreatePage />} />
              <Route path="/products" element={<ProductsPage />} />
              <Route path="/products/new" element={<ProductCreatePage />} />
              <Route path="/products/:id/adjust-stock" element={<ProductAdjustStockPage />} />
              <Route path="/warehouses" element={<WarehousesPage />} />
              <Route path="/warehouses/new" element={<WarehouseCreatePage />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
