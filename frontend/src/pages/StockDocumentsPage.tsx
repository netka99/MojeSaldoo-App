/**
 * StockDocumentsPage — unified view of warehouse/stock documents.
 *
 * Route: /documents
 *
 * Tabs (shown only when the respective module is active):
 *   przyjecia  — PZ, PZ-KOR     (module: purchasing)
 *   wydania    — WZ, ZW, WZ-KOR  (module: delivery)
 *   ruchy      — RW, MM          (module: warehouses)
 *   produkcja  — ZP              (module: production)
 *
 * Old routes (/purchasing/pz, /delivery, /warehouse-moves) redirect here.
 */

import { Navigate, useParams } from 'react-router-dom';
import { authStorage } from '@/services/api';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { usePermission } from '@/hooks/usePermission';
import { PurchasingPzPageContent } from './PurchasingPzPage';
import { DeliveryDocumentsPageContent } from './DeliveryDocumentsPage';
import { WarehouseMovesPageContent } from './WarehouseMovesPage';
import { ProductionOrdersListContent } from './ProductionOrdersPage';

/** Route: /documents/:section  (section = pz | wz | rw | zp) */
export function StockDocumentsPage() {
  if (!authStorage.getAccessToken()) {
    return <Navigate to="/login" replace />;
  }
  return <StockDocumentsPageContent />;
}

function StockDocumentsPageContent() {
  const { section } = useParams<{ section?: string }>();

  const purchasingEnabled = useModuleGuard('purchasing');
  const deliveryEnabled = useModuleGuard('delivery');
  const warehousesEnabled = useModuleGuard('warehouses');
  const productionEnabled = useModuleGuard('production');

  const canPurchasing = usePermission('can_manage_purchasing');
  const canDelivery = usePermission('can_manage_delivery');
  const canRW = usePermission('can_manage_stock_moves');
  const canProduction = usePermission('can_manage_production');

  // Default: redirect to first available section
  if (!section) {
    if (purchasingEnabled && canPurchasing) return <Navigate to="/documents/pz" replace />;
    if (deliveryEnabled && canDelivery) return <Navigate to="/documents/wz" replace />;
    if (warehousesEnabled && canRW) return <Navigate to="/documents/rw" replace />;
    if (productionEnabled && canProduction) return <Navigate to="/documents/zp" replace />;
    return <div className="p-4 text-sm text-slate-400">Brak dostępnych modułów dokumentów.</div>;
  }

  if (section === 'pz' && purchasingEnabled && canPurchasing) return <PurchasingPzPageContent />;
  if (section === 'wz' && deliveryEnabled && canDelivery) return <DeliveryDocumentsPageContent />;
  if (section === 'rw' && warehousesEnabled && canRW) return <WarehouseMovesPageContent />;
  if (section === 'zp' && productionEnabled && canProduction) return <ProductionOrdersListContent />;

  return <Navigate to="/documents" replace />;
}
