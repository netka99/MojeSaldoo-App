export interface Invoice {
  id: string;
  orderId: string;
  invoiceNumber: string;
  referenceNumber?: string; // KSeF reference number
  issueDate: string;
  shopName: string;
  totalGross: number;
  vatRate: number;
  status: 'draft' | 'sent' | 'accepted' | 'rejected';
  xmlContent?: string;
  invoiceHash?: string;
  upoReceived: boolean;
  sentAt?: string;
  createdAt: string;
}

export interface InvoiceFormData {
  orderId: string;
  issueDate: string;
  shopName: string;
  vatRate: number;
}