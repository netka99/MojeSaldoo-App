import type { Product } from './product.types';
import type { Customer } from './customer.types';

export interface OrderItem {
  id: string;
  product: Product;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
}

export interface Order {
  id: string;
  customer: Customer;
  orderDate: string;
  deliveryDate: string;
  status: 'draft' | 'confirmed' | 'in_delivery' | 'completed' | 'cancelled';
  items: OrderItem[];
  subtotal: number;
  discount: number;
  total: number;
  createdAt: string;
}

export interface CreateOrderData {
  customerId: string;
  deliveryDate: string;
  items: {
    productId: string;
    quantity: number;
    unitPrice: number;
    discount: number;
  }[];
}