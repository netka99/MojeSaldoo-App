import { motion } from 'framer-motion';
import { Outlet, useLocation } from 'react-router-dom';
import { BottomNav } from './Navigation';
import { Sidebar } from './Sidebar';

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex min-h-screen bg-muted/30">
      <Sidebar />
      <div className="flex min-w-0 flex-1 flex-col pb-[83px] md:pb-0">
        <main className="flex-1">
          <motion.div
            key={location.pathname}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.25 }}
          >
            <Outlet />
          </motion.div>
        </main>
      </div>
      <BottomNav />
    </div>
  );
}
