import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useModuleGuard } from '@/hooks/useModuleGuard';
import { cn } from '@/lib/utils';
import type { ModuleName } from '@/types';

const itemClass = cn(
  'flex w-full items-center rounded-lg px-3 py-2 text-sm font-medium transition-colors',
  'text-muted-foreground hover:bg-accent hover:text-accent-foreground',
);

const activeItemClass = 'bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground';

function useNavActive(to: string, end?: boolean) {
  const { pathname } = useLocation();
  if (end) {
    return pathname === to;
  }
  if (to === '/' || to === '') {
    return pathname === '/';
  }
  return pathname === to || pathname.startsWith(`${to}/`);
}

export interface AppNavItemLinkProps {
  to: string
  end?: boolean
  children: ReactNode
  className?: string
}

/** Primary nav link (no module check). */
export function AppNavItemLink({ to, end, children, className }: AppNavItemLinkProps) {
  const active = useNavActive(to, end);
  return (
    <Link to={to} className={cn(itemClass, active && activeItemClass, className)}>
      {children}
    </Link>
  );
}

export interface ModuleNavItemProps {
  module: ModuleName
  to: string
  end?: boolean
  children: ReactNode
  className?: string
}

/** Renders a nav link only if `module` is enabled for the current company. */
export function ModuleNavItem({ module, to, end, children, className }: ModuleNavItemProps) {
  const enabled = useModuleGuard(module);
  if (!enabled) {
    return null;
  }
  return (
    <AppNavItemLink to={to} end={end} className={className}>
      {children}
    </AppNavItemLink>
  );
}

export interface NavGroupTitleProps {
  children: ReactNode
}

export function NavGroupTitle({ children }: NavGroupTitleProps) {
  return (
    <p className="px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground" role="presentation">
      {children}
    </p>
  );
}
