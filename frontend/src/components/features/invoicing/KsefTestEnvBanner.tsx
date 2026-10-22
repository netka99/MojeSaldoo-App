import { Link } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';

/**
 * Renders a warning banner when the company's KSeF environment is not production.
 * Place this near the top of invoice pages (create, detail, period, manual).
 */
export function KsefTestEnvBanner() {
  const { user } = useAuth();
  const env = user?.ksef_environment;
  if (!env || env === 'production') return null;

  const label = env === 'demo' ? 'Demo' : 'Testowe';

  return (
    <div className="flex items-start gap-2.5 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <svg
        className="mt-0.5 h-4 w-4 shrink-0 text-amber-500"
        viewBox="0 0 20 20"
        fill="currentColor"
        aria-hidden
      >
        <path
          fillRule="evenodd"
          d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
          clipRule="evenodd"
        />
      </svg>
      <p>
        <span className="font-semibold">Środowisko {label} — </span>
        faktury wysyłane do KSeF są testowe i nie mają wartości prawnej.{' '}
        <Link to="/settings/certificate" className="font-medium underline underline-offset-2 hover:text-amber-700">
          Zmień środowisko
        </Link>
      </p>
    </div>
  );
}
