import React from 'react';
import { Navigation } from './Navigation';

interface SidebarProps {
  activeItem?: string;
}

export const Sidebar: React.FC<SidebarProps> = ({ activeItem }) => {
  const navigationItems = [
    { name: 'Dashboard', href: '/dashboard' },
    { name: 'Products', href: '/products' },
    { name: 'Customers', href: '/customers' },
    { name: 'Orders', href: '/orders' },
    { name: 'Delivery', href: '/delivery' },
    { name: 'Invoicing', href: '/invoicing' },
    { name: 'Reports', href: '/reports' },
    { name: 'Settings', href: '/settings' },
  ];

  return (
    <div className="w-64 bg-background border-r border-border flex flex-col">
      <div className="p-6">
        <h1 className="text-xl font-bold text-foreground">MojeSaldoo</h1>
      </div>
      <nav className="flex-1 px-4 py-6">
        <Navigation items={navigationItems} activeItem={activeItem} />
      </nav>
    </div>
  );
};