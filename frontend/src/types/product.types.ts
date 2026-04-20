export interface Product {
  id: string;
  name: string;
  unit: string; // 'szt', 'kg', 'l'
  price: number;
  stockQuantity: number;
  imageUrl?: string;
  createdAt: string;
}

export interface ProductFormData {
  name: string;
  unit: string;
  price: number;
  stockQuantity: number;
}