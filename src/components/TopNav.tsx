import { ArrowLeft, Shield, ShieldCheck } from 'lucide-react';

export type AppView = 'studio' | 'admin';

interface TopNavProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

export function TopNav({ activeView, onNavigate }: TopNavProps) {
  const isAdminRoute = activeView === 'admin';

  return (
    <header className="sticky top-0 z-30 h-14 bg-white/95 backdrop-blur-md border-b border-slate-200">
      <div className="max-w-6xl mx-auto h-full px-3 sm:px-6 flex items-center justify-between gap-2 sm:gap-6">
        <button
          type="button"
          onClick={() => onNavigate('studio')}
          className="flex items-center gap-2 text-left whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 rounded-lg py-1 cursor-pointer"
        >
          <span className="w-7 h-7 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm tracking-tight shrink-0">
            R
          </span>
          <span className="font-display font-bold text-sm sm:text-lg tracking-tight text-slate-900">
            Google Review
          </span>
        </button>

        {isAdminRoute ? (
          <>
            <div className="hidden sm:flex items-center gap-2 text-xs font-semibold text-emerald-700 whitespace-nowrap">
              <ShieldCheck className="w-4 h-4 text-emerald-600" />
              <span>Admin Portal</span>
            </div>

            <div className="flex items-center shrink-0">
              <button
                type="button"
                onClick={() => onNavigate('studio')}
                className="min-h-[40px] px-3 sm:px-3.5 py-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-800 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Customer Page</span>
              </button>
            </div>
          </>
        ) : (
          <div className="flex items-center gap-3 shrink-0">
            <span className="hidden md:inline text-xs text-slate-500 whitespace-nowrap">
              Customer Review Composer
            </span>
            <button
              type="button"
              onClick={() => onNavigate('admin')}
              aria-label="Open Admin Login"
              className="min-h-[40px] px-3 sm:px-3.5 py-1.5 rounded-lg border border-slate-300 bg-slate-900 hover:bg-slate-800 text-white text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 inline-flex items-center gap-1.5 shadow-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600 cursor-pointer"
            >
              <Shield className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>Admin</span>
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
