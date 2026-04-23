export { createAppQueryClient, createTestQueryClient } from './query-client';
export { customerKeys, productKeys, warehouseKeys } from './keys';
export {
  useCustomerListQuery,
  useCustomerQuery,
  useCreateCustomerMutation,
  useUpdateCustomerMutation,
  usePatchCustomerMutation,
  useDeleteCustomerMutation,
} from './use-customers';
export {
  useProductListQuery,
  useProductQuery,
  useCreateProductMutation,
  useUpdateProductMutation,
  usePatchProductMutation,
  useDeleteProductMutation,
  useUpdateProductStockMutation,
} from './use-products';
export {
  useWarehouseListQuery,
  useCreateWarehouseMutation,
  useUpdateWarehouseMutation,
  useDeleteWarehouseMutation,
} from './use-warehouses';
