import { useEffect, useMemo, useState } from 'react';
import {
  getEnabledBusinessBySlug,
  subscribeCategories,
  subscribeEnabledBusinesses,
  type BusinessRecord,
  type CategoryRecord,
} from './lib/firestoreService';
import { DEFAULT_CATEGORIES } from './shared/constants';
import { ErrorBoundary } from './components/ErrorBoundary';
import { TopNav, type AppView } from './components/TopNav';
import { CustomerStudio } from './components/CustomerStudio';
import { AdminDashboard } from './components/AdminDashboard';

function parseLocationRoute(): {
  view: AppView;
  businessSlug: string | null;
} {
  const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
  const hash = window.location.hash.replace(/\/+$/, '');
  const params = new URLSearchParams(window.location.search);
  const querySlug = params.get('b');

  if (
    pathname === '/admin' ||
    pathname === '/admin/login' ||
    hash === '#/admin' ||
    hash === '#/admin/login' ||
    params.get('admin') === '1'
  ) {
    return { view: 'admin', businessSlug: null };
  }
  if (pathname.startsWith('/b/')) {
    const slug = pathname.slice(3).split('/')[0]?.trim() || null;
    return { view: 'studio', businessSlug: slug };
  }
  if (pathname.startsWith('/store/')) {
    const slug = pathname.slice(7).split('/')[0]?.trim() || null;
    return { view: 'studio', businessSlug: slug };
  }
  if (querySlug) {
    return { view: 'studio', businessSlug: querySlug.trim() };
  }
  return { view: 'studio', businessSlug: null };
}

function StudioApp() {
  const initialRoute = useMemo(() => parseLocationRoute(), []);
  const [activeView, setActiveView] = useState<AppView>(initialRoute.view);
  const [activeSlug, setActiveSlug] = useState<string | null>(initialRoute.businessSlug);

  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [businessesLoading, setBusinessesLoading] = useState(true);
  const [firestoreCategories, setFirestoreCategories] = useState<CategoryRecord[]>([]);

  const [lockedBusiness, setLockedBusiness] = useState<BusinessRecord | null>(null);
  const [slugNotFound, setSlugNotFound] = useState<string | null>(null);

  useEffect(() => {
    const unsubBiz = subscribeEnabledBusinesses(
      (list) => {
        setBusinesses(list);
        setBusinessesLoading(false);
      },
      () => {
        setBusinessesLoading(false);
      }
    );
    const unsubCat = subscribeCategories((list) => {
      setFirestoreCategories(list);
    });
    return () => {
      unsubBiz();
      unsubCat();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!activeSlug) {
      setLockedBusiness(null);
      setSlugNotFound(null);
      return;
    }

    const fromCache = businesses.find((b) => b.slug === activeSlug && b.enabled);
    if (fromCache) {
      setLockedBusiness(fromCache);
      setSlugNotFound(null);
      return;
    }

    getEnabledBusinessBySlug(activeSlug)
      .then((found) => {
        if (cancelled) return;
        if (found) {
          setLockedBusiness(found);
          setSlugNotFound(null);
        } else {
          setLockedBusiness(null);
          setSlugNotFound(activeSlug);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setLockedBusiness(null);
          setSlugNotFound(activeSlug);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSlug, businesses]);

  useEffect(() => {
    const handlePopState = () => {
      const parsed = parseLocationRoute();
      setActiveView(parsed.view);
      setActiveSlug(parsed.businessSlug);
    };
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  const navigateTo = (view: AppView, slug: string | null = null) => {
    let nextPath = '/';
    if (view === 'admin') nextPath = '/admin';
    else if (slug) nextPath = `/b/${slug}`;

    if (window.location.pathname !== nextPath) {
      window.history.pushState({}, '', nextPath);
    }
    setActiveView(view);
    setActiveSlug(slug);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const mergedCategories = useMemo(() => {
    const set = new Set<string>(DEFAULT_CATEGORIES);
    firestoreCategories.forEach((c) => set.add(c.name));
    return Array.from(set);
  }, [firestoreCategories]);

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      <TopNav
        activeView={activeView}
        onNavigate={(view) => navigateTo(view, view === 'studio' ? activeSlug : null)}
      />

      <div className="flex-1">
        {activeView === 'studio' && (
          <CustomerStudio
            businesses={businesses}
            categories={mergedCategories}
            lockedBusiness={lockedBusiness}
            slugNotFound={slugNotFound}
            businessesLoading={businessesLoading}
            onClearLockedBusiness={() => navigateTo('studio', null)}
            onSelectBusiness={(biz) => {
              setSlugNotFound(null);
              if (lockedBusiness) {
                navigateTo('studio', biz.slug);
              }
            }}
          />
        )}

        {activeView === 'admin' && (
          <AdminDashboard onOpenCustomerLink={(slug) => navigateTo('studio', slug)} />
        )}
      </div>

      <footer className="border-t border-slate-200 bg-slate-50/60 mt-12">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 py-5 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-slate-500">
          <div>
            AI Review Studio · Genuine customer reviews in English, हिंदी, मराठी & Hinglish
          </div>
          {activeView === 'admin' && (
            <button
              type="button"
              onClick={() => navigateTo('studio', null)}
              className="hover:text-slate-800 cursor-pointer"
            >
              Open Customer Review Page
            </button>
          )}
        </div>
      </footer>
    </div>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <StudioApp />
    </ErrorBoundary>
  );
}
