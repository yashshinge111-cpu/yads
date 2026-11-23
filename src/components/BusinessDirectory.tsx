import { useMemo, useState } from 'react';
import { ArrowRight, ExternalLink, MapPin, Search, Store } from 'lucide-react';
import type { BusinessRecord } from '../lib/firestoreService';

interface BusinessDirectoryProps {
  businesses: BusinessRecord[];
  categories: string[];
  loading: boolean;
  onSelectBusiness: (business: BusinessRecord) => void;
  onGoToStudio: () => void;
}

export function BusinessDirectory({
  businesses,
  categories,
  loading,
  onSelectBusiness,
  onGoToStudio,
}: BusinessDirectoryProps) {
  const [search, setSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('ALL');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return businesses.filter((biz) => {
      const matchesCategory = categoryFilter === 'ALL' || biz.category === categoryFilter;
      const matchesQuery =
        !q ||
        biz.name.toLowerCase().includes(q) ||
        biz.category.toLowerCase().includes(q) ||
        biz.location.toLowerCase().includes(q);
      return matchesCategory && matchesQuery;
    });
  }, [businesses, search, categoryFilter]);

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4">
        <div>
          <p className="text-xs sm:text-sm font-semibold text-blue-600 mb-1">
            Registered Business Directory
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            Select a business to write a review
          </h1>
          <p className="text-sm text-slate-600 mt-1">
            Each business has its own dedicated review link and direct Google Review destination.
          </p>
        </div>
        <button
          type="button"
          onClick={onGoToStudio}
          className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 whitespace-nowrap self-start sm:self-auto"
        >
          Open Custom Composer
        </button>
      </div>

      {/* Search & Category Filter */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1">
          <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by business name, category, or city..."
            className="w-full min-h-[46px] pl-10 pr-4 py-2.5 rounded-xl bg-white border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
          />
        </div>
        <select
          aria-label="Filter by category"
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="min-h-[46px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-sm font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 sm:w-64"
        >
          <option value="ALL">All Categories</option>
          {categories.map((cat) => (
            <option key={cat} value={cat}>
              {cat}
            </option>
          ))}
        </select>
      </div>

      {/* Business Grid */}
      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse"
            >
              <div className="h-5 w-2/3 bg-slate-200 rounded" />
              <div className="h-4 w-1/2 bg-slate-100 rounded" />
              <div className="h-10 w-full bg-slate-100 rounded-xl mt-4" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-3">
          <Store className="w-8 h-8 text-slate-400 mx-auto" />
          <h2 className="text-base font-bold text-slate-900">
            {businesses.length === 0 ? 'No active businesses registered yet' : 'No matching businesses'}
          </h2>
          <p className="text-sm text-slate-600 max-w-md mx-auto">
            {businesses.length === 0
              ? 'An administrator can add businesses in the Admin Dashboard, or you can use the Custom Composer right away.'
              : 'Try clearing your search or choosing another category.'}
          </p>
          <button
            type="button"
            onClick={onGoToStudio}
            className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2"
          >
            <span>Go to Review Composer</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((biz) => (
            <article
              key={biz.id}
              className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col justify-between gap-4 hover:border-blue-300 transition-colors"
            >
              <div className="flex items-start gap-3.5">
                <div className="w-12 h-12 rounded-xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                  {biz.logoUrl ? (
                    <img
                      src={biz.logoUrl}
                      alt={`${biz.name} logo`}
                      referrerPolicy="no-referrer"
                      onError={(e) => {
                        e.currentTarget.style.display = 'none';
                      }}
                      className="w-full h-full object-contain p-1"
                    />
                  ) : (
                    <Store className="w-5 h-5 text-blue-600" />
                  )}
                </div>
                <div className="space-y-1 min-w-0">
                  <div className="text-xs text-slate-500 flex flex-wrap items-center gap-1.5">
                    <span>{biz.category}</span>
                    {biz.location && (
                      <>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="w-3 h-3 text-slate-400" />
                          {biz.location}
                        </span>
                      </>
                    )}
                  </div>
                  <h2 className="text-lg font-bold text-slate-900 truncate">{biz.name}</h2>
                  <p className="text-xs font-mono text-slate-400 truncate">/b/{biz.slug}</p>
                </div>
              </div>

              <div className="flex items-center gap-2 pt-2 border-t border-slate-100">
                <button
                  type="button"
                  onClick={() => onSelectBusiness(biz)}
                  className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <span>Write Review</span>
                  <ArrowRight className="w-4 h-4" />
                </button>
                <a
                  href={biz.googleReviewUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Open Google Review page"
                  className="min-h-[44px] min-w-[44px] px-3 py-2 rounded-xl border border-emerald-200 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 inline-flex items-center justify-center"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </div>
            </article>
          ))}
        </div>
      )}
    </main>
  );
}
