import React from 'react';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';

interface Order {
  id: string;
  orderNumber: string;
  customerName: string;
  orderDate: string;
  deliveryDate: string;
  status: 'draft' | 'confirmed' | 'in_delivery' | 'completed' | 'cancelled';
  total: number;
}

interface OrderListProps {
  orders: Order[];
  onEdit?: (order: Order) => void;
  onDelete?: (order: Order) => void;
}

export const OrderList: React.FC<OrderListProps> = ({ orders, onEdit, onDelete }) => {
  const getStatusColor = (status: Order['status']) => {
    switch (status) {
      case 'draft': return 'bg-gray-100 text-gray-800';
      case 'confirmed': return 'bg-blue-100 text-blue-800';
      case 'in_delivery': return 'bg-yellow-100 text-yellow-800';
      case 'completed': return 'bg-green-100 text-green-800';
      case 'cancelled': return 'bg-red-100 text-red-800';
      default: return 'bg-gray-100 text-gray-800';
    }
  };

  const getStatusText = (status: Order['status']) => {
    switch (status) {
      case 'draft': return 'Draft';
      case 'confirmed': return 'Confirmed';
      case 'in_delivery': return 'In Delivery';
      case 'completed': return 'Completed';
      case 'cancelled': return 'Cancelled';
      default: return status;
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Orders</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {orders.map((order) => (
            <div key={order.id} className="flex items-center justify-between p-4 border rounded-lg">
              <div className="flex-1">
                <div className="flex items-center space-x-4">
                  <div>
                    <h3 className="font-medium">{order.orderNumber}</h3>
                    <p className="text-sm text-gray-600">{order.customerName}</p>
                  </div>
                  <span className={`px-2 py-1 rounded-full text-xs font-medium ${getStatusColor(order.status)}`}>
                    {getStatusText(order.status)}
                  </span>
                </div>
                <div className="mt-2 text-sm text-gray-500">
                  Order: {new Date(order.orderDate).toLocaleDateString()} | 
                  Delivery: {new Date(order.deliveryDate).toLocaleDateString()}
                </div>
              </div>
              <div className="flex items-center space-x-2">
                <span className="font-medium">
                  {new Intl.NumberFormat('pl-PL', { style: 'currency', currency: 'PLN' }).format(order.total)}
                </span>
                <Button variant="outline" size="sm" onClick={() => onEdit?.(order)}>
                  Edit
                </Button>
                <Button variant="destructive" size="sm" onClick={() => onDelete?.(order)}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
};