import React from 'react';

interface NavigationItem {
  name: string;
  href: string;
  icon?: React.ReactNode;
}

interface NavigationProps {
  items: NavigationItem[];
  activeItem?: string;
}

export const Navigation: React.FC<NavigationProps> = ({ items, activeItem }) => {
  return (
    <nav className="space-y-2">
      {items.map((item) => (
        <a
          key={item.name}
          href={item.href}
          className={`flex items-center space-x-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
            activeItem === item.name
              ? 'bg-primary text-primary-foreground'
              : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
          }`}
        >
          {item.icon && <span>{item.icon}</span>}
          <span>{item.name}</span>
        </a>
      ))}
    </nav>
  );
};