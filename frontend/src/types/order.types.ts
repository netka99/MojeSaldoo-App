/**
 * Order / line types — match `apps.orders.serializers` + `Order` / `OrderItem` models (DRF JSON, snake_case).
 * Decimals are usually strings in API responses; requests may use strings or numbers.
 */

/** `Order.status` / `Order.STATUS_*` in Django. */
export type OrderStatus =
  | 'draft'
  | 'confirmed'
  | 'in_preparation'
  | 'loaded'
  | 'in_delivery'
  | 'delivered'
  | 'invoiced'
  | 'cancelled';

/**
 * One line on an order. Read responses include snapshot and computed line totals;
 * create/update bodies use `product_id` and pricing fields.
 */
export interface OrderItem {
  id: string;
  product_id: string;
  product_name: string;
  product_unit: string;
  quantity: string | number;
  quantity_delivered: string | number;
  quantity_returned: string | number;
  unit_price_net: string | number;
  unit_price_gross: string | number;
  vat_rate: string | number;
  discount_percent: string | number;
  line_total_net: string | number;
  line_total_gross: string | number;
}

/**
 * Full order as returned from GET. Status / many totals are read-only on the serializer
 * (except for nested writes where the server re-computes).
 */
export interface Order {
  id: string;
  customer_id: string;
  customer_name: string;
  company: string;
  user: number | null;
  order_number: string | null;
  order_date: string;
  delivery_date: string;
  status: OrderStatus;
  subtotal_net: string | number;
  subtotal_gross: string | number;
  discount_percent: string | number;
  discount_amount: string | number;
  total_net: string | number;
  total_gross: string | number;
  customer_notes: string;
  internal_notes: string;
  created_at: string;
  updated_at: string;
  confirmed_at: string | null;
  delivered_at: string | null;
  items: OrderItem[];
}

/**
 * One line in `POST/PUT` `/api/orders/` `items` array. Optional fields can be omitted; server defaults from product.
 */
export interface OrderItemWrite {
  product_id: string;
  quantity: string | number;
  unit_price_net?: string | number;
  unit_price_gross?: string | number;
  vat_rate?: string | number;
  discount_percent?: string | number;
  quantity_delivered?: string | number;
  quantity_returned?: string | number;
}

/**
 * `POST` create — matches `OrderSerializer` writable shape (`customer_id`, `delivery_date`, `items`…).
 */
export interface OrderCreate {
  customer_id: string;
  delivery_date: string;
  order_date?: string | null;
  items?: OrderItemWrite[];
  customer_notes?: string;
  internal_notes?: string;
  discount_percent?: string | number;
  discount_amount?: string | number;
}

/**
 * `PUT` full update — same payload shape as create for nested items; only send fields the API should replace.
 */
export type OrderUpdate = OrderCreate;

export interface PaginatedOrders {
  count: number;
  next: string | null;
  previous: string | null;
  results: Order[];
}
