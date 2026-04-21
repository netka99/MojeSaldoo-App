# MojeSaldoo App

A comprehensive mobile application for managing sales, orders, and invoicing with KSeF integration.

## Project Structure

```
MojeSaldoo App/
├── backend/                 # Django backend
│   ├── config/             # Django configuration
│   ├── apps/               # Django apps
│   ├── media/              # Media files
│   ├── storage/            # Storage files
│   └── requirements.txt    # Python dependencies
├── frontend/               # React frontend
│   ├── src/
│   │   ├── components/     # React components
│   │   ├── pages/          # Page components
│   │   ├── hooks/          # Custom hooks
│   │   ├── context/        # React context
│   │   ├── services/       # API services
│   │   ├── types/          # TypeScript types
│   │   ├── utils/          # Utility functions
│   │   └── styles/         # Global styles
│   ├── package.json        # Node.js dependencies
│   └── vite.config.ts     # Vite configuration
└── PROJECT.md              # Project documentation
```

## Technology Stack

### Frontend
- **Framework**: React + TypeScript
- **Styling**: Tailwind CSS
- **Mobile**: Capacitor (iOS + Android)
- **State Management**: React Context API
- **Routing**: React Router
- **Forms**: React Hook Form + Zod
- **UI Components**: Custom components based on Headless UI

### Backend
- **Framework**: Django + Django REST Framework
- **Language**: Python 3.11+
- **Database**: SQLite (development) → PostgreSQL (production)
- **Authentication**: JWT + Certificate-based (for KSeF)
- **API**: RESTful API

## Setup Instructions

### Backend Setup

1. Navigate to the backend directory:
   ```bash
   cd backend
   ```

2. Create and activate a virtual environment:
   ```bash
   python -m venv venv
   source venv/bin/activate  # On Windows: venv\Scripts\activate
   ```

3. Install dependencies:
   ```bash
   pip install -r requirements.txt
   ```

4. Run migrations:
   ```bash
   python manage.py migrate
   ```

5. Start the development server:
   ```bash
   python manage.py runserver
   ```

### Frontend Setup

1. Navigate to the frontend directory:
   ```bash
   cd frontend
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```

## Features

### 1. Onboarding
- User registration and authentication
- Certificate upload for KSeF integration
- Initial business configuration

### 2. Product Management
- CRUD operations for products
- Stock management
- Product catalog with search

### 3. Customer Management
- Customer database
- Customer details and contact information
- Delivery preferences

### 4. Order Management
- Create and manage orders
- Order tracking
- Delivery planning

### 5. Delivery Management
- Warehouse transfer documents (WZ)
- Delivery tracking
- Return handling

### 6. Invoicing
- Invoice generation
- KSeF integration
- Invoice status tracking

### 7. Reporting
- Sales reports
- Invoice status reports
- Analytics dashboard

## API Endpoints

### Authentication
- `POST /api/auth/register/` - User registration
- `POST /api/auth/login/` - User login
- `POST /api/auth/logout/` - User logout

### Products
- `GET /api/products/` - List products
- `POST /api/products/` - Create product
- `GET /api/products/{id}/` - Get product details
- `PUT /api/products/{id}/` - Update product
- `DELETE /api/products/{id}/` - Delete product

### Customers
- `GET /api/customers/` - List customers
- `POST /api/customers/` - Create customer
- `GET /api/customers/{id}/` - Get customer details
- `PUT /api/customers/{id}/` - Update customer
- `DELETE /api/customers/{id}/` - Delete customer

### Orders
- `GET /api/orders/` - List orders
- `POST /api/orders/` - Create order
- `GET /api/orders/{id}/` - Get order details
- `PUT /api/orders/{id}/` - Update order
- `DELETE /api/orders/{id}/` - Delete order

### Delivery
- `GET /api/delivery/documents/` - List delivery documents
- `POST /api/delivery/documents/` - Create delivery document
- `GET /api/delivery/documents/{id}/` - Get delivery document details
- `PUT /api/delivery/documents/{id}/` - Update delivery document

### Invoicing
- `GET /api/invoices/` - List invoices
- `POST /api/invoices/` - Create invoice
- `GET /api/invoices/{id}/` - Get invoice details
- `POST /api/invoices/{id}/send-ksef/` - Send invoice to KSeF

### KSeF Integration
- `POST /api/ksef/challenge/` - Get KSeF challenge
- `POST /api/ksef/auth-token/` - Get KSeF auth token
- `POST /api/ksef/session/` - Create KSeF session
- `POST /api/ksef/send-invoice/` - Send invoice to KSeF

## Development

### Adding New Features

1. **Frontend**: Create components in `src/components/features/`
2. **Backend**: Create Django apps in `apps/`
3. **API**: Add endpoints in respective app's `urls.py`
4. **Database**: Update models and run migrations

### Code Standards

- **Frontend**: Use TypeScript, follow React best practices
- **Backend**: Follow Django conventions, use DRF for APIs
- **Comments**: All code comments must be in English
- **Naming**: Use English for variable and function names

## Deployment

### Backend
1. Set up PostgreSQL database
2. Configure environment variables
3. Run production migrations
4. Use Gunicorn + Nginx for serving

### Frontend
1. Build the application: `npm run build`
2. Deploy static files to web server
3. Configure Capacitor for mobile builds

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

This project is licensed under the MIT License.