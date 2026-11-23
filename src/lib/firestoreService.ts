import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore';
import {
  BILLING_CYCLES,
  BOOTSTRAP_ADMIN_EMAIL,
  DEFAULT_CATEGORIES,
  STARTER_BUSINESSES,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_STATUSES,
  VALIDATION_LIMITS,
  slugifyText,
  type BillingCycle,
  type ReviewLanguage,
  type SubscriptionPlan,
  type SubscriptionStatus,
} from '../shared/constants';
import { auth, db, handleFirestoreError, OperationType } from './firebase';

export interface BusinessRecord {
  id: string;
  name: string;
  slug: string;
  category: string;
  googleReviewUrl: string;
  logoUrl?: string;
  location: string;
  enabled: boolean;
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface CategoryRecord {
  id: string;
  name: string;
  slug: string;
  isDefault: boolean;
  createdBy: string;
  createdAt?: Timestamp | null;
}

export interface UsageLogRecord {
  id: string;
  businessId: string;
  businessName: string;
  category: string;
  language: ReviewLanguage;
  keywordCount: number;
  isRegeneration: boolean;
  createdAt?: Timestamp | null;
}

export interface BusinessInput {
  name: string;
  slug: string;
  category: string;
  googleReviewUrl: string;
  logoUrl?: string;
  location: string;
  enabled: boolean;
}

export interface BusinessSubscriptionRecord {
  id: string;
  businessId: string;
  businessName: string;
  ownerEmail: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  renewalDate: string;
  notes: string;
  updatedBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface BusinessSubscriptionInput {
  businessId: string;
  businessName: string;
  ownerEmail: string;
  plan: SubscriptionPlan;
  status: SubscriptionStatus;
  billingCycle: BillingCycle;
  renewalDate: string;
  notes: string;
}

function createSafeId(prefix: string): string {
  const randomPart =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
      : `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  return `${prefix}_${randomPart}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
}

export function validateGoogleReviewUrl(rawUrl: string): string | null {
  const trimmed = rawUrl.trim();
  if (
    trimmed.length < VALIDATION_LIMITS.URL_MIN ||
    trimmed.length > VALIDATION_LIMITS.URL_MAX ||
    !VALIDATION_LIMITS.URL_REGEX.test(trimmed)
  ) {
    return 'Google Review URL must start with https:// or http:// (10–500 characters).';
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return 'Google Review URL must use https:// or http://.';
    }
    if (!VALIDATION_LIMITS.GOOGLE_REVIEW_HOST_REGEX.test(parsed.hostname)) {
      return 'Please enter a valid Google Review or Google Maps link (for example https://g.page/r/.../review or https://search.google.com/local/writereview?placeid=...).';
    }
  } catch {
    return 'Please enter a valid Google Review URL (for example https://g.page/r/your-review-link/review).';
  }
  return null;
}

export function validateLogoUrl(rawLogoUrl?: string): string | null {
  const trimmed = (rawLogoUrl ?? '').trim();
  if (!trimmed) return null;
  if (trimmed.length > VALIDATION_LIMITS.LOGO_URL_MAX) {
    return 'Store logo is too large. Please upload a smaller image or paste an image URL.';
  }
  if (VALIDATION_LIMITS.LOGO_DATA_URI_REGEX.test(trimmed)) {
    return null;
  }
  if (VALIDATION_LIMITS.URL_REGEX.test(trimmed)) {
    try {
      const parsed = new URL(trimmed);
      if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
        return null;
      }
    } catch {
      // fall through
    }
  }
  return 'Store logo must be an https:// image URL or a PNG/JPG/WebP image upload.';
}

export function validateBusinessInput(input: BusinessInput): string | null {
  const name = input.name.trim();
  const slug = slugifyText(input.slug || input.name);
  const category = input.category.trim();
  const location = input.location.trim();

  if (
    name.length < VALIDATION_LIMITS.BUSINESS_NAME_MIN ||
    name.length > VALIDATION_LIMITS.BUSINESS_NAME_MAX
  ) {
    return `Business name must be between ${VALIDATION_LIMITS.BUSINESS_NAME_MIN} and ${VALIDATION_LIMITS.BUSINESS_NAME_MAX} characters.`;
  }
  if (
    slug.length < VALIDATION_LIMITS.SLUG_MIN ||
    slug.length > VALIDATION_LIMITS.SLUG_MAX ||
    !VALIDATION_LIMITS.SLUG_REGEX.test(slug)
  ) {
    return 'Customer link slug must contain lowercase letters, numbers, or hyphens only (2–80 characters).';
  }
  if (
    category.length < VALIDATION_LIMITS.CATEGORY_MIN ||
    category.length > VALIDATION_LIMITS.CATEGORY_MAX
  ) {
    return 'Please select or enter a valid business category.';
  }
  const urlErr = validateGoogleReviewUrl(input.googleReviewUrl);
  if (urlErr) {
    return urlErr;
  }
  const logoErr = validateLogoUrl(input.logoUrl);
  if (logoErr) {
    return logoErr;
  }
  if (location.length > VALIDATION_LIMITS.LOCATION_MAX) {
    return `Location must be ${VALIDATION_LIMITS.LOCATION_MAX} characters or fewer.`;
  }
  return null;
}

export async function checkIsCurrentUserAdmin(targetUser?: { uid: string; email?: string | null; emailVerified?: boolean } | null): Promise<boolean> {
  const user = targetUser ?? auth.currentUser;
  if (!user || !user.emailVerified) {
    return false;
  }
  if (user.email?.toLowerCase() === BOOTSTRAP_ADMIN_EMAIL.toLowerCase()) {
    return true;
  }
  const path = `admins/${user.uid}`;
  try {
    const snap = await getDoc(doc(db, 'admins', user.uid));
    return snap.exists() && snap.data()?.role === 'admin';
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export function subscribeEnabledBusinesses(
  onData: (businesses: BusinessRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'businesses'), where('enabled', '==', true));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: BusinessRecord[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<BusinessRecord, 'id'>),
      }));
      list.sort((a, b) => a.name.localeCompare(b.name));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'businesses');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeAllBusinessesForAdmin(
  onData: (businesses: BusinessRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'businesses'), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: BusinessRecord[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<BusinessRecord, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'businesses');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function getEnabledBusinessBySlug(slug: string): Promise<BusinessRecord | null> {
  const normalized = slugifyText(slug);
  if (!normalized) return null;
  try {
    const q = query(collection(db, 'businesses'), where('enabled', '==', true));
    const snap = await getDocs(q);
    const match = snap.docs.find((d) => d.data().slug === normalized);
    if (!match) return null;
    return {
      id: match.id,
      ...(match.data() as Omit<BusinessRecord, 'id'>),
    };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, 'businesses');
  }
}

export function subscribeCategories(
  onData: (categories: CategoryRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'categories'), orderBy('name', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: CategoryRecord[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<CategoryRecord, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'categories');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export function subscribeUsageLogsForAdmin(
  onData: (logs: UsageLogRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'usageLogs'), orderBy('createdAt', 'desc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: UsageLogRecord[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<UsageLogRecord, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'usageLogs');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function createBusiness(input: BusinessInput): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator sign-in required.');

  const slug = slugifyText(input.slug || input.name);
  const normalized: BusinessInput = {
    name: input.name.trim().slice(0, VALIDATION_LIMITS.BUSINESS_NAME_MAX),
    slug,
    category: input.category.trim().slice(0, VALIDATION_LIMITS.CATEGORY_MAX),
    googleReviewUrl: input.googleReviewUrl.trim().slice(0, VALIDATION_LIMITS.URL_MAX),
    logoUrl: (input.logoUrl ?? '').trim().slice(0, VALIDATION_LIMITS.LOGO_URL_MAX),
    location: input.location.trim().slice(0, VALIDATION_LIMITS.LOCATION_MAX),
    enabled: Boolean(input.enabled),
  };

  const validationError = validateBusinessInput(normalized);
  if (validationError) throw new Error(validationError);

  // Check slug uniqueness across businesses
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'businesses'), where('slug', '==', normalized.slug))
    );
    if (!existingSnap.empty) {
      throw new Error(`A business with link slug "${normalized.slug}" already exists.`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already exists')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.LIST, 'businesses');
  }

  const businessId = createSafeId('biz');
  const path = `businesses/${businessId}`;
  try {
    await setDoc(doc(db, 'businesses', businessId), {
      ...normalized,
      createdBy: uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });
    return businessId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateBusiness(businessId: string, input: BusinessInput): Promise<void> {
  const slug = slugifyText(input.slug || input.name);
  const normalized: BusinessInput = {
    name: input.name.trim().slice(0, VALIDATION_LIMITS.BUSINESS_NAME_MAX),
    slug,
    category: input.category.trim().slice(0, VALIDATION_LIMITS.CATEGORY_MAX),
    googleReviewUrl: input.googleReviewUrl.trim().slice(0, VALIDATION_LIMITS.URL_MAX),
    logoUrl: (input.logoUrl ?? '').trim().slice(0, VALIDATION_LIMITS.LOGO_URL_MAX),
    location: input.location.trim().slice(0, VALIDATION_LIMITS.LOCATION_MAX),
    enabled: Boolean(input.enabled),
  };

  const validationError = validateBusinessInput(normalized);
  if (validationError) throw new Error(validationError);

  // Check slug collision excluding self
  try {
    const existingSnap = await getDocs(
      query(collection(db, 'businesses'), where('slug', '==', normalized.slug))
    );
    const conflict = existingSnap.docs.find((d) => d.id !== businessId);
    if (conflict) {
      throw new Error(`Another business already uses the link slug "${normalized.slug}".`);
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('already uses')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.LIST, 'businesses');
  }

  const path = `businesses/${businessId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId), {
      ...normalized,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function saveStoreSettings(
  businessId: string,
  settings: {
    name: string;
    logoUrl: string;
    googleReviewUrl: string;
  }
): Promise<void> {
  const cleanName = settings.name.trim().slice(0, VALIDATION_LIMITS.BUSINESS_NAME_MAX);
  const cleanLogoUrl = settings.logoUrl.trim().slice(0, VALIDATION_LIMITS.LOGO_URL_MAX);
  const cleanGoogleUrl = settings.googleReviewUrl.trim().slice(0, VALIDATION_LIMITS.URL_MAX);

  if (
    cleanName.length < VALIDATION_LIMITS.BUSINESS_NAME_MIN ||
    cleanName.length > VALIDATION_LIMITS.BUSINESS_NAME_MAX
  ) {
    throw new Error(
      `Store Name must be between ${VALIDATION_LIMITS.BUSINESS_NAME_MIN} and ${VALIDATION_LIMITS.BUSINESS_NAME_MAX} characters.`
    );
  }
  const urlErr = validateGoogleReviewUrl(cleanGoogleUrl);
  if (urlErr) throw new Error(urlErr);

  const logoErr = validateLogoUrl(cleanLogoUrl);
  if (logoErr) throw new Error(logoErr);

  const path = `businesses/${businessId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId), {
      name: cleanName,
      logoUrl: cleanLogoUrl,
      googleReviewUrl: cleanGoogleUrl,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function toggleBusinessEnabled(businessId: string, enabled: boolean): Promise<void> {
  const path = `businesses/${businessId}`;
  try {
    await updateDoc(doc(db, 'businesses', businessId), {
      enabled,
      updatedAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteBusiness(businessId: string): Promise<void> {
  const path = `businesses/${businessId}`;
  try {
    await deleteDoc(doc(db, 'businesses', businessId));
    try {
      await deleteDoc(doc(db, 'subscriptions', businessId));
    } catch {
      // Subscription record may not exist yet
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export function subscribeSubscriptionsForAdmin(
  onData: (subscriptions: BusinessSubscriptionRecord[]) => void,
  onError?: (err: Error) => void
): Unsubscribe {
  const q = query(collection(db, 'subscriptions'), orderBy('businessName', 'asc'));
  return onSnapshot(
    q,
    (snapshot) => {
      const list: BusinessSubscriptionRecord[] = snapshot.docs.map((docSnap) => ({
        id: docSnap.id,
        ...(docSnap.data() as Omit<BusinessSubscriptionRecord, 'id'>),
      }));
      onData(list);
    },
    (error) => {
      try {
        handleFirestoreError(error, OperationType.LIST, 'subscriptions');
      } catch (wrapped) {
        onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );
}

export async function upsertBusinessSubscription(
  input: BusinessSubscriptionInput
): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator sign-in required.');
  if (!VALIDATION_LIMITS.ID_REGEX.test(input.businessId)) {
    throw new Error('Invalid business ID.');
  }

  const businessName = input.businessName.trim().slice(0, VALIDATION_LIMITS.BUSINESS_NAME_MAX);
  const ownerEmail = input.ownerEmail.trim().slice(0, VALIDATION_LIMITS.OWNER_EMAIL_MAX);
  const renewalDate = input.renewalDate.trim().slice(0, VALIDATION_LIMITS.RENEWAL_DATE_MAX);
  const notes = input.notes.trim().slice(0, VALIDATION_LIMITS.NOTES_MAX);

  if (businessName.length < VALIDATION_LIMITS.BUSINESS_NAME_MIN) {
    throw new Error('Business name is required.');
  }
  if (ownerEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    throw new Error('Please enter a valid owner email address or leave it blank.');
  }
  if (!SUBSCRIPTION_PLANS.includes(input.plan)) {
    throw new Error('Invalid subscription plan.');
  }
  if (!SUBSCRIPTION_STATUSES.includes(input.status)) {
    throw new Error('Invalid subscription status.');
  }
  if (!BILLING_CYCLES.includes(input.billingCycle)) {
    throw new Error('Invalid billing cycle.');
  }

  const subRef = doc(db, 'subscriptions', input.businessId);
  const path = `subscriptions/${input.businessId}`;
  try {
    const existing = await getDoc(subRef);
    if (existing.exists()) {
      await updateDoc(subRef, {
        businessName,
        ownerEmail,
        plan: input.plan,
        status: input.status,
        billingCycle: input.billingCycle,
        renewalDate,
        notes,
        updatedBy: uid,
        updatedAt: serverTimestamp(),
      });
    } else {
      await setDoc(subRef, {
        businessId: input.businessId,
        businessName,
        ownerEmail,
        plan: input.plan,
        status: input.status,
        billingCycle: input.billingCycle,
        renewalDate,
        notes,
        updatedBy: uid,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    }
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function addCategory(name: string, isDefault = false): Promise<string> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('Administrator sign-in required.');

  const cleanName = name.trim().slice(0, VALIDATION_LIMITS.CATEGORY_MAX);
  const slug = slugifyText(cleanName);
  if (
    cleanName.length < VALIDATION_LIMITS.CATEGORY_MIN ||
    slug.length < VALIDATION_LIMITS.SLUG_MIN ||
    !VALIDATION_LIMITS.SLUG_REGEX.test(slug)
  ) {
    throw new Error('Category name must be 2–80 characters with letters or numbers.');
  }

  const categoryId = `cat_${slug}`.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 128);
  const path = `categories/${categoryId}`;
  try {
    await setDoc(doc(db, 'categories', categoryId), {
      name: cleanName,
      slug,
      isDefault,
      createdBy: uid,
      createdAt: serverTimestamp(),
    });
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const path = `categories/${categoryId}`;
  try {
    await deleteDoc(doc(db, 'categories', categoryId));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function recordUsageLog(params: {
  businessId: string;
  businessName: string;
  category: string;
  language: ReviewLanguage;
  keywordCount: number;
  isRegeneration: boolean;
}): Promise<void> {
  if (!VALIDATION_LIMITS.ID_REGEX.test(params.businessId)) return;
  const logId = createSafeId('log');
  const path = `usageLogs/${logId}`;
  try {
    await setDoc(doc(db, 'usageLogs', logId), {
      businessId: params.businessId.slice(0, 128),
      businessName: params.businessName.trim().slice(0, VALIDATION_LIMITS.BUSINESS_NAME_MAX) || 'Business',
      category: params.category.trim().slice(0, VALIDATION_LIMITS.CATEGORY_MAX) || 'Other',
      language: params.language,
      keywordCount: Math.max(1, Math.min(10, Math.round(params.keywordCount))),
      isRegeneration: Boolean(params.isRegeneration),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function seedDefaultCategoriesIfEmpty(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  try {
    const snap = await getDocs(collection(db, 'categories'));
    if (!snap.empty) return 0;
    let count = 0;
    for (const categoryName of DEFAULT_CATEGORIES) {
      await addCategory(categoryName, true);
      count++;
    }
    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'categories');
  }
}

export async function seedStarterBusinessesIfEmpty(): Promise<number> {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  try {
    const snap = await getDocs(collection(db, 'businesses'));
    if (!snap.empty) return 0;
    let count = 0;
    for (const starter of STARTER_BUSINESSES) {
      await createBusiness({
        ...starter,
        enabled: true,
      });
      count++;
    }
    return count;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, 'businesses');
  }
}
