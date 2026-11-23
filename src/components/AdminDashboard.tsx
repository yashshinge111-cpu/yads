import { useEffect, useMemo, useRef, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signOut, type User } from 'firebase/auth';
import { QRCodeSVG } from 'qrcode.react';
import {
  AlertCircle,
  ArrowLeft,
  BarChart3,
  Building2,
  Calendar,
  Check,
  Copy,
  CreditCard,
  Download,
  ExternalLink,
  FolderPlus,
  LayoutGrid,
  Lock,
  LogIn,
  LogOut,
  Mail,
  Pencil,
  Plus,
  QrCode,
  Search,
  ShieldAlert,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { auth, googleProvider } from '../lib/firebase';
import {
  addCategory,
  checkIsCurrentUserAdmin,
  createBusiness,
  deleteBusiness,
  deleteCategory,
  saveStoreSettings,
  seedDefaultCategoriesIfEmpty,
  seedStarterBusinessesIfEmpty,
  subscribeAllBusinessesForAdmin,
  subscribeCategories,
  subscribeSubscriptionsForAdmin,
  subscribeUsageLogsForAdmin,
  toggleBusinessEnabled,
  updateBusiness,
  upsertBusinessSubscription,
  validateBusinessInput,
  validateGoogleReviewUrl,
  validateLogoUrl,
  type BusinessInput,
  type BusinessRecord,
  type BusinessSubscriptionRecord,
  type CategoryRecord,
  type UsageLogRecord,
} from '../lib/firestoreService';
import {
  BILLING_CYCLES,
  DEFAULT_CATEGORIES,
  LANGUAGES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  VALIDATION_LIMITS,
  slugifyText,
  type BillingCycle,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '../shared/constants';
import { BusinessDirectory } from './BusinessDirectory';

type AdminTab =
  | 'businesses'
  | 'settings'
  | 'subscriptions'
  | 'directory'
  | 'overview'
  | 'categories';

interface AdminDashboardProps {
  onOpenCustomerLink: (slug: string) => void;
}

const EMPTY_BUSINESS_FORM: BusinessInput = {
  name: '',
  slug: '',
  category: DEFAULT_CATEGORIES[0],
  googleReviewUrl: '',
  logoUrl: '',
  location: '',
  enabled: true,
};

async function resizeLogoFileToDataUrl(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/jpg', 'image/webp'].includes(file.type)) {
    throw new Error('Please choose a PNG, JPG, or WebP logo image.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Logo image file must be 5 MB or smaller.');
  }

  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode selected image file.'));
      image.src = objectUrl;
    });

    const maxSide = 180;
    const scale = Math.min(1, maxSide / Math.max(img.width || 1, img.height || 1));
    const width = Math.max(1, Math.round((img.width || maxSide) * scale));
    const height = Math.max(1, Math.round((img.height || maxSide) * scale));

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Image processing is unavailable in this browser.');
    }
    ctx.drawImage(img, 0, 0, width, height);

    let dataUrl = canvas.toDataURL('image/png');
    if (dataUrl.length > VALIDATION_LIMITS.LOGO_URL_MAX) {
      dataUrl = canvas.toDataURL('image/jpeg', 0.82);
    }
    if (dataUrl.length > VALIDATION_LIMITS.LOGO_URL_MAX) {
      throw new Error('Logo image is still too large after compression. Please try a simpler image or paste an image URL.');
    }
    return dataUrl;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function AdminDashboard({ onOpenCustomerLink }: AdminDashboardProps) {
  const [user, setUser] = useState<User | null>(auth.currentUser);
  const [authLoading, setAuthLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('businesses');
  const [businesses, setBusinesses] = useState<BusinessRecord[]>([]);
  const [categories, setCategories] = useState<CategoryRecord[]>([]);
  const [usageLogs, setUsageLogs] = useState<UsageLogRecord[]>([]);
  const [dataLoading, setDataLoading] = useState(false);

  // Filters & Feedback
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'enabled' | 'disabled'>('all');
  const [bannerMessage, setBannerMessage] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);
  const [copiedSlugId, setCopiedSlugId] = useState<string | null>(null);

  // Store Settings State
  const [settingsStoreId, setSettingsStoreId] = useState<string>('');
  const [settingsName, setSettingsName] = useState('');
  const [settingsLogoUrl, setSettingsLogoUrl] = useState('');
  const [settingsGoogleUrl, setSettingsGoogleUrl] = useState('');
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsSuccess, setSettingsSuccess] = useState<string | null>(null);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [isProcessingLogo, setIsProcessingLogo] = useState(false);
  const settingsQrRef = useRef<HTMLDivElement | null>(null);

  // Add / Edit Business Modal
  const [formOpen, setFormOpen] = useState(false);
  const [editingBusiness, setEditingBusiness] = useState<BusinessRecord | null>(null);
  const [businessForm, setBusinessForm] = useState<BusinessInput>(EMPTY_BUSINESS_FORM);
  const [slugManuallyEdited, setSlugManuallyEdited] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [isSavingBusiness, setIsSavingBusiness] = useState(false);

  // Delete Confirmation Modal
  const [deleteTarget, setDeleteTarget] = useState<BusinessRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  // QR Code Modal
  const [qrBusiness, setQrBusiness] = useState<BusinessRecord | null>(null);
  const qrContainerRef = useRef<HTMLDivElement | null>(null);

  // Category Form
  const [newCategoryName, setNewCategoryName] = useState('');
  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSeeding, setIsSeeding] = useState(false);

  // Subscriptions & Business Accounts
  const [subscriptions, setSubscriptions] = useState<BusinessSubscriptionRecord[]>([]);
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState<'all' | SubscriptionStatus>('all');
  const [subModalBusiness, setSubModalBusiness] = useState<BusinessRecord | null>(null);
  const [subOwnerEmail, setSubOwnerEmail] = useState('');
  const [subPlan, setSubPlan] = useState<SubscriptionPlan>('free');
  const [subStatus, setSubStatus] = useState<SubscriptionStatus>('active');
  const [subBillingCycle, setSubBillingCycle] = useState<BillingCycle>('monthly');
  const [subRenewalDate, setSubRenewalDate] = useState('');
  const [subNotes, setSubNotes] = useState('');
  const [subStoreEnabled, setSubStoreEnabled] = useState(true);
  const [subError, setSubError] = useState<string | null>(null);
  const [isSavingSub, setIsSavingSub] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (!nextUser) {
        setIsAdmin(false);
        setAuthLoading(false);
        return;
      }
      try {
        const adminOk = await checkIsCurrentUserAdmin(nextUser);
        setIsAdmin(adminOk);
        if (adminOk) {
          seedDefaultCategoriesIfEmpty().catch((seedErr) => {
            console.warn('Default category seeding skipped:', seedErr);
          });
        }
      } catch (err) {
        setIsAdmin(false);
        setAuthError(err instanceof Error ? err.message : 'Could not verify admin permissions.');
      } finally {
        setAuthLoading(false);
      }
    });
    return () => unsub();
  }, []);

  useEffect(() => {
    if (!user || !isAdmin) {
      document.title = 'Admin Login — AI Review Studio';
    } else {
      document.title = 'Admin Dashboard — AI Review Studio';
    }
    return () => {
      document.title = 'AI Review Studio — Natural Customer Review Assistant';
    };
  }, [user, isAdmin]);

  useEffect(() => {
    if (!isAdmin) {
      setBusinesses([]);
      setCategories([]);
      setUsageLogs([]);
      setSubscriptions([]);
      return;
    }

    setDataLoading(true);
    const unsubBiz = subscribeAllBusinessesForAdmin(
      (list) => {
        setBusinesses(list);
        setDataLoading(false);
      },
      (err) => {
        setBannerMessage({ type: 'error', text: err.message });
        setDataLoading(false);
      }
    );

    const unsubCat = subscribeCategories(
      (list) => setCategories(list),
      (err) => setBannerMessage({ type: 'error', text: err.message })
    );

    const unsubLogs = subscribeUsageLogsForAdmin(
      (list) => setUsageLogs(list),
      (err) => setBannerMessage({ type: 'error', text: err.message })
    );

    const unsubSubs = subscribeSubscriptionsForAdmin(
      (list) => setSubscriptions(list),
      (err) => setBannerMessage({ type: 'error', text: err.message })
    );

    return () => {
      unsubBiz();
      unsubCat();
      unsubLogs();
      unsubSubs();
    };
  }, [isAdmin]);

  const categoryOptions = useMemo(() => {
    const names = new Set<string>(DEFAULT_CATEGORIES);
    categories.forEach((c) => names.add(c.name));
    return Array.from(names).sort((a, b) => a.localeCompare(b));
  }, [categories]);

  const filteredBusinesses = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return businesses.filter((biz) => {
      const matchesStatus =
        statusFilter === 'all' ||
        (statusFilter === 'enabled' && biz.enabled) ||
        (statusFilter === 'disabled' && !biz.enabled);
      const matchesQuery =
        !q ||
        biz.name.toLowerCase().includes(q) ||
        biz.category.toLowerCase().includes(q) ||
        biz.slug.toLowerCase().includes(q) ||
        biz.location.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [businesses, searchQuery, statusFilter]);

  const selectedSettingsStore = useMemo(
    () => businesses.find((b) => b.id === settingsStoreId) ?? businesses[0] ?? null,
    [businesses, settingsStoreId]
  );

  useEffect(() => {
    if (!selectedSettingsStore) {
      setSettingsStoreId('');
      setSettingsName('');
      setSettingsLogoUrl('');
      setSettingsGoogleUrl('');
      return;
    }
    if (settingsStoreId !== selectedSettingsStore.id) {
      setSettingsStoreId(selectedSettingsStore.id);
    }
    setSettingsName(selectedSettingsStore.name);
    setSettingsLogoUrl(selectedSettingsStore.logoUrl || '');
    setSettingsGoogleUrl(selectedSettingsStore.googleReviewUrl);
    setSettingsError(null);
  }, [selectedSettingsStore?.id, selectedSettingsStore?.updatedAt?.toMillis?.()]);

  const stats = useMemo(() => {
    const activeCount = businesses.filter((b) => b.enabled).length;
    const langCounts: Record<string, number> = {
      English: 0,
      Hindi: 0,
      Marathi: 0,
      Hinglish: 0,
    };
    const perBusinessCounts = new Map<string, { name: string; category: string; count: number }>();

    for (const log of usageLogs) {
      langCounts[log.language] = (langCounts[log.language] || 0) + 1;
      const existing = perBusinessCounts.get(log.businessId) || {
        name: log.businessName,
        category: log.category,
        count: 0,
      };
      existing.count += 1;
      perBusinessCounts.set(log.businessId, existing);
    }

    let topLanguage = 'English';
    let topLanguageCount = -1;
    for (const lang of LANGUAGES) {
      if ((langCounts[lang] || 0) > topLanguageCount) {
        topLanguageCount = langCounts[lang] || 0;
        topLanguage = lang;
      }
    }

    const topBusinesses = Array.from(perBusinessCounts.entries())
      .map(([id, info]) => ({ id, ...info }))
      .sort((a, b) => b.count - a.count);

    return {
      totalGenerations: usageLogs.length,
      totalDrafts: usageLogs.length * 3,
      activeBusinesses: activeCount,
      totalBusinesses: businesses.length,
      langCounts,
      topLanguage: usageLogs.length > 0 ? topLanguage : '—',
      topBusinesses,
    };
  }, [businesses, usageLogs]);

  const subscriptionMap = useMemo(() => {
    const map = new Map<string, BusinessSubscriptionRecord>();
    for (const sub of subscriptions) {
      map.set(sub.businessId, sub);
    }
    return map;
  }, [subscriptions]);

  const accountRows = useMemo(() => {
    return businesses.map((biz) => {
      const sub = subscriptionMap.get(biz.id);
      const effectiveStatus: SubscriptionStatus =
        sub?.status ?? (biz.enabled ? 'active' : 'suspended');
      return {
        business: biz,
        subscription: sub ?? null,
        ownerEmail: sub?.ownerEmail ?? '',
        plan: (sub?.plan ?? 'free') as SubscriptionPlan,
        status: effectiveStatus,
        billingCycle: (sub?.billingCycle ?? 'monthly') as BillingCycle,
        renewalDate: sub?.renewalDate ?? '',
        notes: sub?.notes ?? '',
      };
    });
  }, [businesses, subscriptionMap]);

  const subscriptionSummary = useMemo(() => {
    let active = 0;
    let trial = 0;
    let attention = 0;
    for (const row of accountRows) {
      if (row.status === 'active') active++;
      else if (row.status === 'trial') trial++;
      else attention++;
    }
    return {
      total: accountRows.length,
      active,
      trial,
      attention,
    };
  }, [accountRows]);

  const filteredAccountRows = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return accountRows.filter((row) => {
      const matchesStatus = subStatusFilter === 'all' || row.status === subStatusFilter;
      const matchesQuery =
        !q ||
        row.business.name.toLowerCase().includes(q) ||
        row.business.slug.toLowerCase().includes(q) ||
        row.ownerEmail.toLowerCase().includes(q) ||
        row.plan.toLowerCase().includes(q);
      return matchesStatus && matchesQuery;
    });
  }, [accountRows, subSearch, subStatusFilter]);

  const openSubscriptionModal = (biz: BusinessRecord) => {
    const sub = subscriptionMap.get(biz.id);
    setSubModalBusiness(biz);
    setSubOwnerEmail(sub?.ownerEmail ?? '');
    setSubPlan((sub?.plan ?? 'free') as SubscriptionPlan);
    setSubStatus((sub?.status ?? (biz.enabled ? 'active' : 'suspended')) as SubscriptionStatus);
    setSubBillingCycle((sub?.billingCycle ?? 'monthly') as BillingCycle);
    setSubRenewalDate(sub?.renewalDate ?? '');
    setSubNotes(sub?.notes ?? '');
    setSubStoreEnabled(biz.enabled);
    setSubError(null);
  };

  const handleSaveSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subModalBusiness) return;
    setSubError(null);
    setIsSavingSub(true);
    try {
      await upsertBusinessSubscription({
        businessId: subModalBusiness.id,
        businessName: subModalBusiness.name,
        ownerEmail: subOwnerEmail,
        plan: subPlan,
        status: subStatus,
        billingCycle: subBillingCycle,
        renewalDate: subRenewalDate,
        notes: subNotes,
      });
      if (subStoreEnabled !== subModalBusiness.enabled) {
        await toggleBusinessEnabled(subModalBusiness.id, subStoreEnabled);
      }
      setBannerMessage({
        type: 'success',
        text: `Updated account & subscription for "${subModalBusiness.name}".`,
      });
      setSubModalBusiness(null);
    } catch (err) {
      setSubError(err instanceof Error ? err.message : 'Could not update subscription.');
    } finally {
      setIsSavingSub(false);
    }
  };

  const handleGoogleSignIn = async () => {
    setAuthError(null);
    setIsSigningIn(true);
    try {
      await signInWithPopup(auth, googleProvider);
    } catch (err) {
      const code = typeof err === 'object' && err !== null && 'code' in err ? String((err as { code?: unknown }).code) : '';
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        setAuthError('Sign-in was cancelled. Please select your authorized owner Google account to continue.');
      } else if (code === 'auth/popup-blocked') {
        setAuthError('The sign-in popup was blocked by your browser. Please allow popups for this site and try again.');
      } else if (code === 'auth/unauthorized-domain') {
        setAuthError(
          `This domain (${window.location.hostname}) is not authorized in Firebase Authentication yet. Add it under Authentication > Settings > Authorized domains in the Firebase Console.`
        );
      } else {
        setAuthError(err instanceof Error ? err.message : 'Google Sign-In failed.');
      }
    } finally {
      setIsSigningIn(false);
    }
  };

  const handleSignOut = async () => {
    await signOut(auth);
  };

  const openAddModal = () => {
    setEditingBusiness(null);
    setBusinessForm({
      ...EMPTY_BUSINESS_FORM,
      category: categoryOptions[0] || DEFAULT_CATEGORIES[0],
    });
    setSlugManuallyEdited(false);
    setFormError(null);
    setFormOpen(true);
  };

  const openEditModal = (biz: BusinessRecord) => {
    setEditingBusiness(biz);
    setBusinessForm({
      name: biz.name,
      slug: biz.slug,
      category: biz.category,
      googleReviewUrl: biz.googleReviewUrl,
      logoUrl: biz.logoUrl || '',
      location: biz.location,
      enabled: biz.enabled,
    });
    setSlugManuallyEdited(true);
    setFormError(null);
    setFormOpen(true);
  };

  const openStoreSettings = (biz: BusinessRecord) => {
    setSettingsStoreId(biz.id);
    setSettingsName(biz.name);
    setSettingsLogoUrl(biz.logoUrl || '');
    setSettingsGoogleUrl(biz.googleReviewUrl);
    setSettingsError(null);
    setSettingsSuccess(null);
    setActiveTab('settings');
  };

  const handleSaveStoreSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSettingsStore) return;
    setSettingsError(null);
    setSettingsSuccess(null);

    const urlErr = validateGoogleReviewUrl(settingsGoogleUrl);
    if (urlErr) {
      setSettingsError(urlErr);
      return;
    }
    const logoErr = validateLogoUrl(settingsLogoUrl);
    if (logoErr) {
      setSettingsError(logoErr);
      return;
    }

    setIsSavingSettings(true);
    try {
      await saveStoreSettings(selectedSettingsStore.id, {
        name: settingsName,
        logoUrl: settingsLogoUrl,
        googleReviewUrl: settingsGoogleUrl,
      });
      setSettingsSuccess(`Saved settings for "${settingsName.trim()}". QR code link remains unchanged.`);
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : 'Could not save store settings.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleUploadLogoFile = async (
    file: File | undefined,
    target: 'settings' | 'modal'
  ) => {
    if (!file) return;
    setIsProcessingLogo(true);
    if (target === 'settings') setSettingsError(null);
    else setFormError(null);
    try {
      const dataUrl = await resizeLogoFileToDataUrl(file);
      if (target === 'settings') {
        setSettingsLogoUrl(dataUrl);
      } else {
        setBusinessForm((prev) => ({ ...prev, logoUrl: dataUrl }));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Could not upload logo.';
      if (target === 'settings') setSettingsError(msg);
      else setFormError(msg);
    } finally {
      setIsProcessingLogo(false);
    }
  };

  const handleSaveBusiness = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const errMsg = validateBusinessInput(businessForm);
    if (errMsg) {
      setFormError(errMsg);
      return;
    }

    setIsSavingBusiness(true);
    try {
      if (editingBusiness) {
        await updateBusiness(editingBusiness.id, businessForm);
        setBannerMessage({ type: 'success', text: `Updated "${businessForm.name.trim()}".` });
      } else {
        await createBusiness(businessForm);
        setBannerMessage({ type: 'success', text: `Added "${businessForm.name.trim()}".` });
      }
      setFormOpen(false);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save business.');
    } finally {
      setIsSavingBusiness(false);
    }
  };

  const handleToggleEnabled = async (biz: BusinessRecord) => {
    try {
      await toggleBusinessEnabled(biz.id, !biz.enabled);
      setBannerMessage({
        type: 'success',
        text: `${biz.name} is now ${!biz.enabled ? 'enabled' : 'disabled'}.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not update status.',
      });
    }
  };

  const handleConfirmDelete = async () => {
    if (!deleteTarget) return;
    setIsDeleting(true);
    try {
      await deleteBusiness(deleteTarget.id);
      setBannerMessage({ type: 'success', text: `Deleted "${deleteTarget.name}".` });
      setDeleteTarget(null);
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not delete business.',
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const handleCopyUniqueLink = async (biz: BusinessRecord) => {
    const fullUrl = `${window.location.origin}/b/${biz.slug}`;
    try {
      await navigator.clipboard.writeText(fullUrl);
      setCopiedSlugId(biz.id);
      window.setTimeout(() => {
        setCopiedSlugId((curr) => (curr === biz.id ? null : curr));
      }, 2200);
    } catch {
      setBannerMessage({ type: 'success', text: `Customer Link: ${fullUrl}` });
    }
  };

  const downloadSvgFromContainer = (container: HTMLDivElement | null, filename: string) => {
    if (!container) return;
    const svg = container.querySelector('svg');
    if (!svg) return;
    const serializer = new XMLSerializer();
    const source = serializer.serializeToString(svg);
    const blob = new Blob([source], { type: 'image/svg+xml;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadQrSvg = () => {
    if (!qrBusiness) return;
    downloadSvgFromContainer(qrContainerRef.current, `${qrBusiness.slug}-review-qr.svg`);
  };

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newCategoryName.trim()) return;
    setIsSavingCategory(true);
    try {
      await addCategory(newCategoryName.trim(), false);
      setBannerMessage({ type: 'success', text: `Category "${newCategoryName.trim()}" added.` });
      setNewCategoryName('');
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not add category.',
      });
    } finally {
      setIsSavingCategory(false);
    }
  };

  const handleDeleteCategory = async (cat: CategoryRecord) => {
    try {
      await deleteCategory(cat.id);
      setBannerMessage({ type: 'success', text: `Category "${cat.name}" removed.` });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not delete category.',
      });
    }
  };

  const handleSeedStarters = async () => {
    setIsSeeding(true);
    try {
      const catCount = await seedDefaultCategoriesIfEmpty();
      const bizCount = await seedStarterBusinessesIfEmpty();
      setBannerMessage({
        type: 'success',
        text: `Loaded ${bizCount} starter businesses and ${catCount || categoryOptions.length} categories.`,
      });
    } catch (err) {
      setBannerMessage({
        type: 'error',
        text: err instanceof Error ? err.message : 'Could not seed starter data.',
      });
    } finally {
      setIsSeeding(false);
    }
  };

  // --- Auth Loading Gate ---
  if (authLoading) {
    return (
      <main className="min-h-[calc(100vh-11rem)] flex items-center justify-center px-4 sm:px-6 py-12">
        <div className="max-w-md w-full bg-white border border-slate-200 rounded-2xl p-8 text-center animate-pulse">
          <div className="w-11 h-11 rounded-xl bg-slate-200 mx-auto mb-4" />
          <div className="h-6 w-48 bg-slate-200 rounded mx-auto mb-3" />
          <div className="h-4 w-64 bg-slate-100 rounded mx-auto" />
        </div>
      </main>
    );
  }

  // --- Dedicated Admin Login Gate (/admin) ---
  if (!user) {
    return (
      <main className="min-h-[calc(100vh-11rem)] flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="max-w-md w-full space-y-5">
          <section
            aria-labelledby="admin-login-heading"
            className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-6"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="w-12 h-12 rounded-xl bg-blue-50 text-blue-600 flex items-center justify-center">
                <Lock className="w-6 h-6" />
              </div>
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-3 py-1 rounded-lg">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Owner Access Only</span>
              </span>
            </div>

            <div className="space-y-2">
              <h1
                id="admin-login-heading"
                className="text-2xl font-extrabold tracking-tight text-slate-900"
              >
                Admin Login
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                Sign in with the authorized owner Google account to manage stores, Google Review links, customer QR links, and subscriptions.
              </p>
            </div>

            {authError && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isSigningIn}
              onClick={() => void handleGoogleSignIn()}
              className="w-full min-h-[48px] px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer disabled:cursor-not-allowed transition-colors"
            >
              <LogIn className="w-4 h-4" />
              <span>{isSigningIn ? 'Signing in...' : 'Sign in with Google'}</span>
            </button>

            <p className="text-xs text-slate-500 text-center leading-relaxed">
              Protected by Firebase Authentication &amp; owner-verified Firestore security rules.
            </p>
          </section>

          <div className="text-center">
            <button
              type="button"
              onClick={() => onOpenCustomerLink('')}
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Customer Review Page</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- Unauthorized Account Gate (Non-Owner) ---
  if (!isAdmin) {
    return (
      <main className="min-h-[calc(100vh-11rem)] flex items-center justify-center px-4 sm:px-6 py-10 sm:py-16">
        <div className="max-w-md w-full space-y-5">
          <section
            aria-labelledby="access-denied-heading"
            className="bg-white border border-red-200 rounded-2xl p-6 sm:p-8 shadow-sm space-y-5"
          >
            <div className="w-12 h-12 rounded-xl bg-red-50 text-red-600 flex items-center justify-center">
              <ShieldAlert className="w-6 h-6" />
            </div>
            <div className="space-y-1.5">
              <h1 id="access-denied-heading" className="text-xl font-extrabold text-slate-900">
                Access Denied — Owner Only
              </h1>
              <p className="text-sm text-slate-600 leading-relaxed">
                The account <span className="font-semibold text-slate-900">{user.email}</span> is not authorized to access the AI Review Studio Admin Dashboard.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              className="w-full min-h-[46px] px-4 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer"
            >
              <LogOut className="w-4 h-4" />
              <span>Sign out &amp; switch Google account</span>
            </button>
          </section>

          <div className="text-center">
            <button
              type="button"
              onClick={() => onOpenCustomerLink('')}
              className="min-h-[40px] px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold text-slate-600 hover:text-slate-900 hover:bg-slate-100 inline-flex items-center gap-1.5 transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-4 h-4" />
              <span>Back to Customer Review Page</span>
            </button>
          </div>
        </div>
      </main>
    );
  }

  // --- Authenticated Admin Workspace ---
  return (
    <main className="max-w-7xl mx-auto px-4 sm:px-6 py-6 sm:py-8 space-y-6">
      {/* Admin Top Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-5 border-b border-slate-200">
        <div>
          <p className="text-xs font-semibold text-emerald-700 mb-1">
            Administrator Console · {user.email}
          </p>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900">
            AI Review Studio Admin
          </h1>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={openAddModal}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer whitespace-nowrap"
          >
            <Plus className="w-4 h-4" />
            <span>Add Business</span>
          </button>
          <button
            type="button"
            onClick={() => void handleSignOut()}
            className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 bg-white hover:bg-slate-50 text-sm font-medium text-slate-700 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap"
          >
            <LogOut className="w-4 h-4" />
            <span>Sign out</span>
          </button>
        </div>
      </div>

      {/* Status Feedback Banner */}
      {bannerMessage && (
        <div
          role="status"
          className={`p-4 rounded-xl border flex items-center justify-between gap-3 text-sm ${
            bannerMessage.type === 'success'
              ? 'bg-emerald-50 border-emerald-200 text-emerald-900'
              : 'bg-red-50 border-red-200 text-red-900'
          }`}
        >
          <span>{bannerMessage.text}</span>
          <button
            type="button"
            aria-label="Dismiss notification"
            onClick={() => setBannerMessage(null)}
            className="p-1 rounded-lg hover:bg-black/5"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* First-Time Starter Setup Prompt */}
      {!dataLoading && businesses.length === 0 && (
        <div className="bg-blue-50/70 border border-blue-200 rounded-2xl p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <h2 className="text-base font-bold text-slate-900">
              Ready to add your first business?
            </h2>
            <p className="text-sm text-slate-700">
              Add a real business right now, or load 4 sample businesses across different categories to test unique customer links immediately.
            </p>
          </div>
          <button
            type="button"
            disabled={isSeeding}
            onClick={() => void handleSeedStarters()}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white border border-blue-300 hover:bg-blue-50 text-sm font-semibold text-blue-700 inline-flex items-center gap-2 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <Sparkles className="w-4 h-4" />
            <span>{isSeeding ? 'Loading...' : 'Load Sample Businesses'}</span>
          </button>
        </div>
      )}

      {/* Segmented Navigation Tabs */}
      <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl w-full lg:w-fit overflow-x-auto">
        <button
          type="button"
          onClick={() => setActiveTab('businesses')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'businesses'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <Building2 className="w-4 h-4" />
          <span>Stores ({businesses.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('settings')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'settings'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <SlidersHorizontal className="w-4 h-4" />
          <span>Store Settings</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('subscriptions')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'subscriptions'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <CreditCard className="w-4 h-4" />
          <span>Subscriptions & Accounts</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('directory')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'directory'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <LayoutGrid className="w-4 h-4" />
          <span>Directory</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('overview')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'overview'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <BarChart3 className="w-4 h-4" />
          <span>Usage Statistics</span>
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('categories')}
          className={`min-h-[42px] px-4 py-2 rounded-lg text-sm font-semibold inline-flex items-center gap-2 whitespace-nowrap transition-colors cursor-pointer ${
            activeTab === 'categories'
              ? 'bg-white text-slate-900 shadow-sm'
              : 'text-slate-600 hover:text-slate-900'
          }`}
        >
          <FolderPlus className="w-4 h-4" />
          <span>Categories ({categoryOptions.length})</span>
        </button>
      </div>

      {/* TAB 1: BUSINESSES */}
      {activeTab === 'businesses' && (
        <section aria-label="Manage businesses" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search businesses by name, category, or link slug..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0">
              {(['all', 'enabled', 'disabled'] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setStatusFilter(status)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap cursor-pointer ${
                    statusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'all' ? 'All' : status === 'enabled' ? 'Active' : 'Disabled'}
                </button>
              ))}
            </div>
          </div>

          {dataLoading ? (
            <div className="bg-white border border-slate-200 rounded-2xl p-6 space-y-3 animate-pulse">
              <div className="h-10 bg-slate-100 rounded-xl" />
              <div className="h-10 bg-slate-100 rounded-xl" />
              <div className="h-10 bg-slate-100 rounded-xl" />
            </div>
          ) : filteredBusinesses.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <Building2 className="w-8 h-8 text-slate-400 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">No businesses found</h2>
              <p className="text-sm text-slate-600">
                {businesses.length === 0
                  ? 'Click "Add Business" above to register your first business and Google Review link.'
                  : 'Try adjusting your search or status filter.'}
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th className="py-3.5 px-4">Business & Category</th>
                      <th className="py-3.5 px-4">Unique Customer Link</th>
                      <th className="py-3.5 px-4">Google Review URL</th>
                      <th className="py-3.5 px-4">Status</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredBusinesses.map((biz) => {
                      const isCopied = copiedSlugId === biz.id;
                      return (
                        <tr key={biz.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <div className="font-bold text-slate-900">{biz.name}</div>
                            <div className="text-xs text-slate-500 mt-0.5">
                              {biz.category}
                              {biz.location ? ` · ${biz.location}` : ''}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => onOpenCustomerLink(biz.slug)}
                                className="font-mono text-xs text-blue-600 hover:underline text-left cursor-pointer"
                              >
                                /b/{biz.slug}
                              </button>
                              <button
                                type="button"
                                title="Copy customer link"
                                onClick={() => void handleCopyUniqueLink(biz)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                              >
                                {isCopied ? (
                                  <Check className="w-3.5 h-3.5 text-emerald-600" />
                                ) : (
                                  <Copy className="w-3.5 h-3.5" />
                                )}
                              </button>
                              <button
                                type="button"
                                title="View QR Code"
                                onClick={() => setQrBusiness(biz)}
                                className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 cursor-pointer"
                              >
                                <QrCode className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                          <td className="py-3.5 px-4 align-top max-w-[240px]">
                            <a
                              href={biz.googleReviewUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs font-mono text-slate-600 hover:text-emerald-700 truncate max-w-full"
                              title={biz.googleReviewUrl}
                            >
                              <span className="truncate">{biz.googleReviewUrl}</span>
                              <ExternalLink className="w-3 h-3 shrink-0" />
                            </a>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <button
                              type="button"
                              onClick={() => void handleToggleEnabled(biz)}
                              className={`min-h-[34px] px-3 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                                biz.enabled
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {biz.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 align-top text-right">
                            <div className="inline-flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => openStoreSettings(biz)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 text-xs font-semibold text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <SlidersHorizontal className="w-3.5 h-3.5" />
                                <span>Settings</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => openEditModal(biz)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-100 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Pencil className="w-3.5 h-3.5" />
                                <span>Edit</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => setDeleteTarget(biz)}
                                className="min-h-[36px] px-2.5 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 inline-flex items-center gap-1 cursor-pointer"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                                <span>Delete</span>
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB: STORE SETTINGS */}
      {activeTab === 'settings' && (
        <section aria-label="Store settings" className="space-y-6">
          {!selectedSettingsStore ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <Store className="w-8 h-8 text-slate-400 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">No stores created yet</h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Create your first store to configure its Store Name, optional Store Logo, Google Review URL, and permanent QR code.
              </p>
              <button
                type="button"
                onClick={openAddModal}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Store</span>
              </button>
            </div>
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
              {/* Left: Store Settings Form */}
              <form
                onSubmit={(e) => void handleSaveStoreSettings(e)}
                className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-4 border-b border-slate-100">
                  <div>
                    <h2 className="text-lg font-extrabold text-slate-900">Store Settings</h2>
                    <p className="text-xs text-slate-500 mt-0.5">
                      Configure this store’s display name, logo, and dedicated Google Review URL.
                    </p>
                  </div>

                  <div className="sm:w-64">
                    <select
                      aria-label="Choose store to configure"
                      value={selectedSettingsStore.id}
                      onChange={(e) => {
                        const found = businesses.find((b) => b.id === e.target.value);
                        if (found) openStoreSettings(found);
                      }}
                      className="w-full min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 text-sm font-semibold text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    >
                      {businesses.map((biz) => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="settings-store-name" className="text-sm font-semibold text-slate-800">
                    Store Name
                  </label>
                  <input
                    id="settings-store-name"
                    type="text"
                    required
                    value={settingsName}
                    onChange={(e) => {
                      setSettingsName(e.target.value);
                      setSettingsSuccess(null);
                    }}
                    maxLength={VALIDATION_LIMITS.BUSINESS_NAME_MAX}
                    placeholder="e.g. Aroma Craft Cafe"
                    className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>

                {/* Store Logo (Optional) */}
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <label htmlFor="settings-logo-url" className="text-sm font-semibold text-slate-800">
                      Store Logo <span className="text-xs font-normal text-slate-500">(optional)</span>
                    </label>
                    {settingsLogoUrl && (
                      <button
                        type="button"
                        onClick={() => setSettingsLogoUrl('')}
                        className="text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer"
                      >
                        Remove logo
                      </button>
                    )}
                  </div>

                  <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
                    <div className="w-16 h-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
                      {settingsLogoUrl ? (
                        <img
                          src={settingsLogoUrl}
                          alt="Store logo preview"
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-contain p-1.5"
                        />
                      ) : (
                        <Store className="w-6 h-6 text-slate-400" />
                      )}
                    </div>

                    <div className="flex-1 w-full space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <label className="min-h-[40px] px-3.5 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer">
                          <Upload className="w-3.5 h-3.5 text-blue-600" />
                          <span>{isProcessingLogo ? 'Processing...' : 'Upload Logo Image'}</span>
                          <input
                            type="file"
                            accept="image/png,image/jpeg,image/webp"
                            disabled={isProcessingLogo}
                            onChange={(e) => {
                              void handleUploadLogoFile(e.target.files?.[0], 'settings');
                              e.target.value = '';
                            }}
                            className="sr-only"
                          />
                        </label>
                        <span className="text-xs text-slate-500">or paste an image URL below</span>
                      </div>

                      <input
                        id="settings-logo-url"
                        type="text"
                        value={settingsLogoUrl.startsWith('data:image/') ? '' : settingsLogoUrl}
                        onChange={(e) => {
                          setSettingsLogoUrl(e.target.value);
                          setSettingsSuccess(null);
                        }}
                        placeholder={
                          settingsLogoUrl.startsWith('data:image/')
                            ? 'Uploaded logo image ready (paste URL here to replace)'
                            : 'https://your-domain.com/logo.png'
                        }
                        className="w-full min-h-[42px] px-3.5 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                      />
                    </div>
                  </div>
                </div>

                {/* Google Review URL */}
                <div className="space-y-1.5">
                  <label htmlFor="settings-google-url" className="text-sm font-semibold text-slate-800">
                    Google Review URL
                  </label>
                  <input
                    id="settings-google-url"
                    type="url"
                    required
                    value={settingsGoogleUrl}
                    onChange={(e) => {
                      setSettingsGoogleUrl(e.target.value);
                      setSettingsSuccess(null);
                      setSettingsError(null);
                    }}
                    maxLength={VALIDATION_LIMITS.URL_MAX}
                    placeholder="https://g.page/r/your-review-link/review"
                    className="w-full min-h-[46px] px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                  <p className="text-xs text-slate-500 leading-relaxed">
                    Example: <span className="font-mono">https://g.page/r/your-review-link/review</span> or{' '}
                    <span className="font-mono">https://search.google.com/local/writereview?placeid=...</span>
                  </p>
                </div>

                {settingsError && (
                  <div
                    role="alert"
                    className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2"
                  >
                    <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                    <span>{settingsError}</span>
                  </div>
                )}

                {settingsSuccess && (
                  <div
                    role="status"
                    className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200 text-sm text-emerald-900 flex items-start gap-2"
                  >
                    <Check className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <span>{settingsSuccess}</span>
                  </div>
                )}

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3 pt-2">
                  <button
                    type="submit"
                    disabled={isSavingSettings || isProcessingLogo}
                    className="min-h-[48px] px-6 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-bold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <span>{isSavingSettings ? 'Saving Settings...' : 'Save Settings'}</span>
                  </button>

                  <button
                    type="button"
                    onClick={() => onOpenCustomerLink(selectedSettingsStore.slug)}
                    className="min-h-[48px] px-5 py-2.5 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
                  >
                    <ExternalLink className="w-4 h-4 text-emerald-600" />
                    <span>Preview Customer Page</span>
                  </button>
                </div>
              </form>

              {/* Right: Permanent Store QR Code & Unique Link */}
              <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4">
                <div>
                  <h3 className="text-base font-extrabold text-slate-900">
                    Permanent Store Link & QR Code
                  </h3>
                  <p className="text-xs text-slate-500 mt-1 leading-relaxed">
                    Customers who scan this QR code go directly to{' '}
                    <span className="font-semibold text-slate-800">{selectedSettingsStore.name}</span>’s review page. Updating your Google Review URL never requires printing a new QR code.
                  </p>
                </div>

                <div
                  ref={settingsQrRef}
                  className="p-5 bg-slate-50 border border-slate-200 rounded-2xl flex items-center justify-center"
                >
                  <QRCodeSVG
                    value={`${window.location.origin}/b/${selectedSettingsStore.slug}`}
                    size={188}
                    level="M"
                    includeMargin={false}
                  />
                </div>

                <div className="text-xs font-mono text-slate-700 break-all bg-slate-50 p-3 rounded-xl border border-slate-200">
                  {`${window.location.origin}/b/${selectedSettingsStore.slug}`}
                </div>

                <div className="flex flex-wrap items-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => void handleCopyUniqueLink(selectedSettingsStore)}
                    className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Copy className="w-4 h-4" />
                    <span>
                      {copiedSlugId === selectedSettingsStore.id ? 'Copied!' : 'Copy Store Link'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      downloadSvgFromContainer(
                        settingsQrRef.current,
                        `${selectedSettingsStore.slug}-review-qr.svg`
                      )
                    }
                    className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download QR SVG</span>
                  </button>
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB 2: USAGE STATISTICS */}
      {activeTab === 'overview' && (
        <section aria-label="Usage statistics" className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Review Generations</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums mt-1">
                {stats.totalGenerations}
              </div>
              <div className="text-xs text-slate-500 tabular-nums mt-1">
                {stats.totalDrafts} individual drafts created
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Active Businesses</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 tabular-nums mt-1">
                {stats.activeBusinesses}
              </div>
              <div className="text-xs text-slate-500 tabular-nums mt-1">
                of {stats.totalBusinesses} total registered
              </div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Top Language</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-blue-600 mt-1">
                {stats.topLanguage}
              </div>
              <div className="text-xs text-slate-500 mt-1">Most selected by customers</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Available Categories</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums mt-1">
                {categoryOptions.length}
              </div>
              <div className="text-xs text-slate-500 mt-1">Built-in & custom</div>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
            {/* Language Breakdown */}
            <div className="lg:col-span-5 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Language Distribution</h2>
              <div className="space-y-3">
                {LANGUAGES.map((lang) => {
                  const count = stats.langCounts[lang] || 0;
                  const pct =
                    stats.totalGenerations > 0
                      ? Math.round((count / stats.totalGenerations) * 100)
                      : 0;
                  return (
                    <div key={lang} className="space-y-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="font-medium text-slate-800">{lang}</span>
                        <span className="font-mono text-xs tabular-nums text-slate-600">
                          {count} ({pct}%)
                        </span>
                      </div>
                      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-blue-600 rounded-full transition-all"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Per-Business Breakdown */}
            <div className="lg:col-span-7 bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
              <h2 className="text-base font-bold text-slate-900">Usage by Business</h2>
              {stats.topBusinesses.length === 0 ? (
                <p className="text-sm text-slate-500 py-6 text-center">
                  No review generations logged yet. Once customers generate reviews for a registered business, counts appear here.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-sm">
                    <thead>
                      <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                        <th className="py-2 pr-4">Business</th>
                        <th className="py-2 pr-4">Category</th>
                        <th className="py-2 text-right">Generations</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {stats.topBusinesses.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 pr-4 font-semibold text-slate-900">{item.name}</td>
                          <td className="py-2.5 pr-4 text-slate-600">{item.category}</td>
                          <td className="py-2.5 text-right font-mono tabular-nums font-semibold text-slate-900">
                            {item.count}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>

          {/* Recent Generation Logs */}
          <div className="bg-white border border-slate-200 rounded-2xl p-5 space-y-4">
            <h2 className="text-base font-bold text-slate-900">Recent Generation Activity</h2>
            {usageLogs.length === 0 ? (
              <p className="text-sm text-slate-500 py-4">No activity recorded yet.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-slate-200 text-xs font-semibold text-slate-500">
                      <th className="py-2.5 pr-4">Business</th>
                      <th className="py-2.5 pr-4">Language</th>
                      <th className="py-2.5 pr-4">Mode</th>
                      <th className="py-2.5 text-right">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {usageLogs.slice(0, 20).map((log) => (
                      <tr key={log.id}>
                        <td className="py-2.5 pr-4 font-medium text-slate-900">
                          {log.businessName}
                        </td>
                        <td className="py-2.5 pr-4 text-slate-700">{log.language}</td>
                        <td className="py-2.5 pr-4 text-slate-600">
                          {log.isRegeneration ? 'Regenerated' : 'Initial'}
                        </td>
                        <td className="py-2.5 text-right text-xs font-mono tabular-nums text-slate-500">
                          {log.createdAt?.toDate
                            ? log.createdAt.toDate().toLocaleString()
                            : 'Just now'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

      {/* TAB 3: CATEGORIES */}
      {activeTab === 'categories' && (
        <section aria-label="Manage categories" className="space-y-6">
          <form
            onSubmit={(e) => void handleAddCategory(e)}
            className="bg-white border border-slate-200 rounded-2xl p-5 flex flex-col sm:flex-row gap-3 items-stretch sm:items-end"
          >
            <div className="flex-1 space-y-1.5">
              <label htmlFor="new-category" className="text-sm font-bold text-slate-900">
                Add New Business Category
              </label>
              <input
                id="new-category"
                type="text"
                value={newCategoryName}
                onChange={(e) => setNewCategoryName(e.target.value)}
                maxLength={VALIDATION_LIMITS.CATEGORY_MAX}
                placeholder="e.g. Dental Clinic & Orthodontics"
                className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <button
              type="submit"
              disabled={isSavingCategory || !newCategoryName.trim()}
              className="min-h-[44px] px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold inline-flex items-center justify-center gap-2 cursor-pointer whitespace-nowrap"
            >
              <Plus className="w-4 h-4" />
              <span>{isSavingCategory ? 'Adding...' : 'Add Category'}</span>
            </button>
          </form>

          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
            <div className="divide-y divide-slate-100">
              {categories.length === 0 ? (
                <div className="p-6 text-sm text-slate-600">
                  Syncing default categories...
                </div>
              ) : (
                categories.map((cat) => (
                  <div
                    key={cat.id}
                    className="px-5 py-3.5 flex items-center justify-between gap-4 hover:bg-slate-50/70"
                  >
                    <div>
                      <div className="text-sm font-semibold text-slate-900">{cat.name}</div>
                      <div className="text-xs text-slate-500">
                        {cat.isDefault ? 'Default category' : 'Custom category'} ·{' '}
                        <span className="font-mono">{cat.slug}</span>
                      </div>
                    </div>
                    {!cat.isDefault && (
                      <button
                        type="button"
                        onClick={() => void handleDeleteCategory(cat)}
                        className="min-h-[36px] px-3 py-1.5 rounded-lg border border-red-200 text-xs font-semibold text-red-700 hover:bg-red-50 cursor-pointer"
                      >
                        Remove
                      </button>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      )}

      {/* TAB: SUBSCRIPTIONS & BUSINESS ACCOUNTS */}
      {activeTab === 'subscriptions' && (
        <section aria-label="Manage subscriptions and business accounts" className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Business Accounts</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-slate-900 tabular-nums mt-1">
                {subscriptionSummary.total}
              </div>
              <div className="text-xs text-slate-500 mt-1">Registered store accounts</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Active Subscriptions</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-emerald-700 tabular-nums mt-1">
                {subscriptionSummary.active}
              </div>
              <div className="text-xs text-slate-500 mt-1">In good standing</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Trial Accounts</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-blue-600 tabular-nums mt-1">
                {subscriptionSummary.trial}
              </div>
              <div className="text-xs text-slate-500 mt-1">Evaluating plans</div>
            </div>
            <div className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5">
              <div className="text-xs font-medium text-slate-500">Past Due / Suspended</div>
              <div className="text-2xl sm:text-3xl font-extrabold text-amber-700 tabular-nums mt-1">
                {subscriptionSummary.attention}
              </div>
              <div className="text-xs text-slate-500 mt-1">Requires admin review</div>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="search"
                value={subSearch}
                onChange={(e) => setSubSearch(e.target.value)}
                placeholder="Search accounts by business name, owner email, or plan..."
                className="w-full min-h-[44px] pl-10 pr-4 py-2 rounded-xl bg-white border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
              />
            </div>
            <div className="flex items-center gap-1 p-1 bg-slate-100 rounded-xl shrink-0 overflow-x-auto">
              {(['all', ...SUBSCRIPTION_STATUSES] as const).map((status) => (
                <button
                  key={status}
                  type="button"
                  onClick={() => setSubStatusFilter(status)}
                  className={`min-h-[38px] px-3 py-1.5 rounded-lg text-xs font-semibold capitalize whitespace-nowrap cursor-pointer ${
                    subStatusFilter === status
                      ? 'bg-white text-slate-900 shadow-sm'
                      : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  {status === 'all' ? 'All' : status.replace('_', ' ')}
                </button>
              ))}
            </div>
          </div>

          {businesses.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-3">
              <CreditCard className="w-8 h-8 text-slate-400 mx-auto" />
              <h2 className="text-base font-bold text-slate-900">No business accounts yet</h2>
              <p className="text-sm text-slate-600 max-w-md mx-auto">
                Add a business first to assign an owner email, subscription plan, billing cycle, and account status.
              </p>
              <button
                type="button"
                onClick={openAddModal}
                className="min-h-[44px] px-5 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center gap-2 cursor-pointer"
              >
                <Plus className="w-4 h-4" />
                <span>Add Business</span>
              </button>
            </div>
          ) : filteredAccountRows.length === 0 ? (
            <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center space-y-2">
              <h2 className="text-base font-bold text-slate-900">No matching accounts</h2>
              <p className="text-sm text-slate-600">
                Try clearing your search or choosing a different status filter.
              </p>
            </div>
          ) : (
            <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 bg-slate-50/80 text-xs font-semibold text-slate-600">
                      <th className="py-3.5 px-4">Business Account</th>
                      <th className="py-3.5 px-4">Owner Email</th>
                      <th className="py-3.5 px-4">Plan & Cycle</th>
                      <th className="py-3.5 px-4">Subscription Status</th>
                      <th className="py-3.5 px-4">Store Access</th>
                      <th className="py-3.5 px-4">Renewal</th>
                      <th className="py-3.5 px-4 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 text-sm">
                    {filteredAccountRows.map((row) => {
                      const statusColors: Record<SubscriptionStatus, string> = {
                        active: 'bg-emerald-50 border-emerald-200 text-emerald-800',
                        trial: 'bg-blue-50 border-blue-200 text-blue-800',
                        past_due: 'bg-amber-50 border-amber-200 text-amber-800',
                        suspended: 'bg-red-50 border-red-200 text-red-800',
                      };
                      return (
                        <tr key={row.business.id} className="hover:bg-slate-50/70 transition-colors">
                          <td className="py-3.5 px-4 align-top">
                            <div className="font-bold text-slate-900">{row.business.name}</div>
                            <div className="text-xs font-mono text-slate-500 mt-0.5">
                              /b/{row.business.slug}
                            </div>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            {row.ownerEmail ? (
                              <span className="inline-flex items-center gap-1.5 text-xs text-slate-800">
                                <Mail className="w-3.5 h-3.5 text-slate-400 shrink-0" />
                                <span>{row.ownerEmail}</span>
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 italic">Not assigned</span>
                            )}
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <div className="font-semibold text-slate-900 capitalize">{row.plan}</div>
                            <div className="text-xs text-slate-500 capitalize">{row.billingCycle}</div>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <span
                              className={`inline-flex items-center px-2.5 py-1 rounded-lg border text-xs font-semibold capitalize whitespace-nowrap ${
                                statusColors[row.status]
                              }`}
                            >
                              {row.status.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3.5 px-4 align-top">
                            <button
                              type="button"
                              onClick={() => void handleToggleEnabled(row.business)}
                              className={`min-h-[32px] px-2.5 py-1 rounded-lg text-xs font-semibold border transition-colors cursor-pointer whitespace-nowrap ${
                                row.business.enabled
                                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800 hover:bg-emerald-100'
                                  : 'bg-slate-100 border-slate-200 text-slate-600 hover:bg-slate-200'
                              }`}
                            >
                              {row.business.enabled ? 'Enabled' : 'Disabled'}
                            </button>
                          </td>
                          <td className="py-3.5 px-4 align-top text-xs font-mono tabular-nums text-slate-600">
                            {row.renewalDate || '—'}
                          </td>
                          <td className="py-3.5 px-4 align-top text-right">
                            <button
                              type="button"
                              onClick={() => openSubscriptionModal(row.business)}
                              className="min-h-[36px] px-3 py-1.5 rounded-lg border border-blue-200 bg-blue-50/70 text-xs font-semibold text-blue-700 hover:bg-blue-100 inline-flex items-center gap-1.5 cursor-pointer"
                            >
                              <CreditCard className="w-3.5 h-3.5" />
                              <span>Manage</span>
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      )}

      {/* TAB: AUTHENTICATED ADMIN BUSINESS DIRECTORY */}
      {activeTab === 'directory' && (
        <section aria-label="Business directory">
          <BusinessDirectory
            businesses={businesses}
            categories={categoryOptions}
            loading={dataLoading}
            onSelectBusiness={(biz) => onOpenCustomerLink(biz.slug)}
            onGoToStudio={() => onOpenCustomerLink('')}
          />
        </section>
      )}

      {/* MODAL: ADD / EDIT BUSINESS */}
      {formOpen && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="business-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <h2 id="business-modal-title" className="text-lg font-extrabold text-slate-900">
                {editingBusiness ? 'Edit Business' : 'Add New Business'}
              </h2>
              <button
                type="button"
                aria-label="Close modal"
                onClick={() => setFormOpen(false)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveBusiness(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="biz-name" className="text-sm font-semibold text-slate-800">
                  Business Name
                </label>
                <input
                  id="biz-name"
                  type="text"
                  required
                  value={businessForm.name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setBusinessForm((prev) => ({
                      ...prev,
                      name: nextName,
                      slug: slugManuallyEdited ? prev.slug : slugifyText(nextName),
                    }));
                  }}
                  maxLength={VALIDATION_LIMITS.BUSINESS_NAME_MAX}
                  placeholder="e.g. Aroma Craft Cafe"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="biz-slug" className="text-sm font-semibold text-slate-800">
                  Unique Customer Link Slug
                </label>
                <div className="flex items-center rounded-xl border border-slate-300 overflow-hidden focus-within:ring-2 focus-within:ring-blue-600">
                  <span className="px-3 py-2.5 bg-slate-50 border-r border-slate-200 text-xs font-mono text-slate-500">
                    /b/
                  </span>
                  <input
                    id="biz-slug"
                    type="text"
                    required
                    value={businessForm.slug}
                    onChange={(e) => {
                      setSlugManuallyEdited(true);
                      setBusinessForm((prev) => ({
                        ...prev,
                        slug: slugifyText(e.target.value),
                      }));
                    }}
                    maxLength={VALIDATION_LIMITS.SLUG_MAX}
                    placeholder="aroma-craft-cafe"
                    className="flex-1 min-h-[44px] px-3 py-2 text-sm font-mono text-slate-900 focus:outline-none"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="biz-category" className="text-sm font-semibold text-slate-800">
                  Category
                </label>
                <select
                  id="biz-category"
                  value={businessForm.category}
                  onChange={(e) =>
                    setBusinessForm((prev) => ({ ...prev, category: e.target.value }))
                  }
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white focus:outline-none focus:ring-2 focus:ring-blue-600"
                >
                  {categoryOptions.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="biz-url" className="text-sm font-semibold text-slate-800">
                  Business Google Review URL
                </label>
                <input
                  id="biz-url"
                  type="url"
                  required
                  value={businessForm.googleReviewUrl}
                  onChange={(e) =>
                    setBusinessForm((prev) => ({ ...prev, googleReviewUrl: e.target.value }))
                  }
                  maxLength={VALIDATION_LIMITS.URL_MAX}
                  placeholder="https://g.page/r/your-review-link/review"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
                <p className="text-xs text-slate-500">
                  Use this store’s exact Google Review link (e.g. g.page/r/.../review or search.google.com/local/writereview?placeid=...).
                </p>
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <label htmlFor="biz-logo" className="text-sm font-semibold text-slate-800">
                    Store Logo <span className="text-xs font-normal text-slate-500">(optional)</span>
                  </label>
                  {businessForm.logoUrl && (
                    <button
                      type="button"
                      onClick={() => setBusinessForm((prev) => ({ ...prev, logoUrl: '' }))}
                      className="text-xs font-medium text-red-600 hover:text-red-700 cursor-pointer"
                    >
                      Remove
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <label className="min-h-[40px] px-3 py-2 rounded-xl border border-slate-300 bg-slate-50 hover:bg-slate-100 text-xs font-semibold text-slate-800 inline-flex items-center gap-1.5 cursor-pointer whitespace-nowrap">
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    <span>Upload</span>
                    <input
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={isProcessingLogo}
                      onChange={(e) => {
                        void handleUploadLogoFile(e.target.files?.[0], 'modal');
                        e.target.value = '';
                      }}
                      className="sr-only"
                    />
                  </label>
                  <input
                    id="biz-logo"
                    type="text"
                    value={(businessForm.logoUrl ?? '').startsWith('data:image/') ? '' : businessForm.logoUrl ?? ''}
                    onChange={(e) =>
                      setBusinessForm((prev) => ({ ...prev, logoUrl: e.target.value }))
                    }
                    placeholder={
                      (businessForm.logoUrl ?? '').startsWith('data:image/')
                        ? 'Uploaded logo ready'
                        : 'https://your-domain.com/logo.png'
                    }
                    className="flex-1 min-h-[42px] px-3 py-2 rounded-xl border border-slate-300 text-xs font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="biz-location" className="text-sm font-semibold text-slate-800">
                  Location (optional)
                </label>
                <input
                  id="biz-location"
                  type="text"
                  value={businessForm.location}
                  onChange={(e) =>
                    setBusinessForm((prev) => ({ ...prev, location: e.target.value }))
                  }
                  maxLength={VALIDATION_LIMITS.LOCATION_MAX}
                  placeholder="e.g. Pune, Maharashtra"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={businessForm.enabled}
                  onChange={(e) =>
                    setBusinessForm((prev) => ({ ...prev, enabled: e.target.checked }))
                  }
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Business Enabled
                  </div>
                  <div className="text-xs text-slate-500">
                    Disabled businesses are hidden from customers and their unique link stops accepting reviews.
                  </div>
                </div>
              </label>

              {formError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  {formError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setFormOpen(false)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingBusiness}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold cursor-pointer"
                >
                  {isSavingBusiness
                    ? 'Saving...'
                    : editingBusiness
                      ? 'Save Changes'
                      : 'Create Business'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL: DELETE CONFIRMATION */}
      {deleteTarget && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-md w-full p-6 space-y-4 shadow-xl">
            <h2 className="text-lg font-extrabold text-slate-900">Delete Business?</h2>
            <p className="text-sm text-slate-600 leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <span className="font-semibold text-slate-900">{deleteTarget.name}</span>? Its unique customer link{' '}
              <span className="font-mono text-xs">/b/{deleteTarget.slug}</span> will stop working.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isDeleting}
                onClick={() => void handleConfirmDelete()}
                className="min-h-[44px] px-4 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white text-sm font-semibold cursor-pointer"
              >
                {isDeleting ? 'Deleting...' : 'Delete Business'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: QR CODE FOR BUSINESS */}
      {qrBusiness && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-sm w-full p-6 space-y-5 shadow-xl text-center">
            <div className="flex items-center justify-between">
              <h2 className="text-base font-extrabold text-slate-900 truncate">
                {qrBusiness.name} QR Link
              </h2>
              <button
                type="button"
                aria-label="Close QR dialog"
                onClick={() => setQrBusiness(null)}
                className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div
              ref={qrContainerRef}
              className="p-5 bg-white border border-slate-200 rounded-2xl inline-flex items-center justify-center mx-auto"
            >
              <QRCodeSVG
                value={`${window.location.origin}/b/${qrBusiness.slug}`}
                size={196}
                level="M"
                includeMargin={false}
              />
            </div>

            <p className="text-xs font-mono text-slate-600 break-all bg-slate-50 p-2.5 rounded-xl border border-slate-200">
              {`${window.location.origin}/b/${qrBusiness.slug}`}
            </p>

            <div className="flex items-center gap-2.5">
              <button
                type="button"
                onClick={() => void handleCopyUniqueLink(qrBusiness)}
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-800 hover:bg-slate-50 inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Copy className="w-4 h-4" />
                <span>{copiedSlugId === qrBusiness.id ? 'Copied!' : 'Copy URL'}</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadQrSvg}
                className="flex-1 min-h-[44px] px-3.5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold inline-flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>Download SVG</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL: MANAGE SUBSCRIPTION & BUSINESS ACCOUNT */}
      {subModalBusiness && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="sub-modal-title"
          className="fixed inset-0 z-50 bg-slate-900/50 backdrop-blur-xs flex items-center justify-center p-4"
        >
          <div className="bg-white border border-slate-200 rounded-2xl max-w-lg w-full max-h-[90vh] overflow-y-auto p-6 space-y-5 shadow-xl">
            <div className="flex items-center justify-between gap-4">
              <div>
                <h2 id="sub-modal-title" className="text-lg font-extrabold text-slate-900">
                  Manage Subscription & Account
                </h2>
                <p className="text-xs text-slate-500 mt-0.5">
                  {subModalBusiness.name} · <span className="font-mono">/b/{subModalBusiness.slug}</span>
                </p>
              </div>
              <button
                type="button"
                aria-label="Close subscription dialog"
                onClick={() => setSubModalBusiness(null)}
                className="p-2 rounded-lg text-slate-500 hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={(e) => void handleSaveSubscription(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="sub-owner-email" className="text-sm font-semibold text-slate-800">
                  Business Owner Email
                </label>
                <input
                  id="sub-owner-email"
                  type="email"
                  value={subOwnerEmail}
                  onChange={(e) => setSubOwnerEmail(e.target.value)}
                  maxLength={VALIDATION_LIMITS.OWNER_EMAIL_MAX}
                  placeholder="owner@business.com"
                  className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="sub-plan" className="text-sm font-semibold text-slate-800">
                    Subscription Plan
                  </label>
                  <select
                    id="sub-plan"
                    value={subPlan}
                    onChange={(e) => setSubPlan(e.target.value as SubscriptionPlan)}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white capitalize focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {SUBSCRIPTION_PLANS.map((plan) => (
                      <option key={plan} value={plan} className="capitalize">
                        {plan}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sub-status" className="text-sm font-semibold text-slate-800">
                    Account Status
                  </label>
                  <select
                    id="sub-status"
                    value={subStatus}
                    onChange={(e) => {
                      const nextStatus = e.target.value as SubscriptionStatus;
                      setSubStatus(nextStatus);
                      if (nextStatus === 'suspended') {
                        setSubStoreEnabled(false);
                      } else if (nextStatus === 'active' || nextStatus === 'trial') {
                        setSubStoreEnabled(true);
                      }
                    }}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white capitalize focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {SUBSCRIPTION_STATUSES.map((status) => (
                      <option key={status} value={status} className="capitalize">
                        {status.replace('_', ' ')}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
                <div className="space-y-1.5">
                  <label htmlFor="sub-cycle" className="text-sm font-semibold text-slate-800">
                    Billing Cycle
                  </label>
                  <select
                    id="sub-cycle"
                    value={subBillingCycle}
                    onChange={(e) => setSubBillingCycle(e.target.value as BillingCycle)}
                    className="w-full min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-300 text-sm text-slate-900 bg-white capitalize focus:outline-none focus:ring-2 focus:ring-blue-600"
                  >
                    {BILLING_CYCLES.map((cycle) => (
                      <option key={cycle} value={cycle} className="capitalize">
                        {cycle}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="space-y-1.5">
                  <label htmlFor="sub-renewal" className="text-sm font-semibold text-slate-800">
                    Next Renewal Date
                  </label>
                  <div className="relative">
                    <Calendar className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      id="sub-renewal"
                      type="date"
                      value={subRenewalDate}
                      onChange={(e) => setSubRenewalDate(e.target.value)}
                      maxLength={VALIDATION_LIMITS.RENEWAL_DATE_MAX}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 rounded-xl border border-slate-300 text-sm font-mono text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                    />
                  </div>
                </div>
              </div>

              <div className="space-y-1.5">
                <label htmlFor="sub-notes" className="text-sm font-semibold text-slate-800">
                  Admin Account Notes <span className="text-xs font-normal text-slate-500">(optional)</span>
                </label>
                <textarea
                  id="sub-notes"
                  rows={2}
                  value={subNotes}
                  onChange={(e) => setSubNotes(e.target.value)}
                  maxLength={VALIDATION_LIMITS.NOTES_MAX}
                  placeholder="Billing terms, invoice reference, or account notes..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600"
                />
              </div>

              <label className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 border border-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  checked={subStoreEnabled}
                  onChange={(e) => setSubStoreEnabled(e.target.checked)}
                  className="w-4 h-4 rounded text-blue-600 focus:ring-blue-600"
                />
                <div>
                  <div className="text-sm font-semibold text-slate-900">
                    Store Customer Link Enabled
                  </div>
                  <div className="text-xs text-slate-500">
                    Uncheck to immediately pause customer access for this account’s review page and QR link.
                  </div>
                </div>
              </label>

              {subError && (
                <div
                  role="alert"
                  className="p-3 rounded-xl bg-red-50 border border-red-200 text-xs text-red-800"
                >
                  {subError}
                </div>
              )}

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setSubModalBusiness(null)}
                  className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingSub}
                  className="min-h-[44px] px-5 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-semibold cursor-pointer"
                >
                  {isSavingSub ? 'Saving...' : 'Save Account & Subscription'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </main>
  );
}
