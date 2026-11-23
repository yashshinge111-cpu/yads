export const LANGUAGES = ['English', 'Hindi', 'Marathi', 'Hinglish'] as const;
export type ReviewLanguage = (typeof LANGUAGES)[number];

export const LANGUAGE_META: Record<
  ReviewLanguage,
  { label: string; nativeLabel: string; hint: string; placeholder: string }
> = {
  English: {
    label: 'English',
    nativeLabel: 'English',
    hint: 'Type or speak 2–3 keywords about your real visit',
    placeholder: 'e.g. fresh coffee, polite staff, quiet seating',
  },
  Hindi: {
    label: 'Hindi',
    nativeLabel: 'हिंदी',
    hint: 'अपने अनुभव के 2–3 शब्द लिखें या माइक से बोलें',
    placeholder: 'जैसे: बढ़िया स्वाद, साफ जगह, विनम्र स्टाफ',
  },
  Marathi: {
    label: 'Marathi',
    nativeLabel: 'मराठी',
    hint: 'तुमच्या अनुभवाचे 2–3 शब्द लिहा किंवा माइकवरून बोला',
    placeholder: 'उदा. चविष्ट जेवण, स्वच्छ परिसर, उत्तम सेवा',
  },
  Hinglish: {
    label: 'Hinglish',
    nativeLabel: 'Hinglish',
    hint: 'Type or speak your real experience (e.g. mast coffee, friendly staff)',
    placeholder: 'e.g. mast coffee, quick service, staff ka behaviour accha tha',
  },
};

export const DEFAULT_CATEGORIES: readonly string[] = [
  'Cafe and Restaurant',
  'Hotels and Bakery',
  'Furniture and Interior Design',
  'Clothing and Fashion',
  'Electronics and Mobile Shops',
  'Automobile and Bike Showrooms',
  'Beauty Parlour and Salon',
  'Gym and Fitness',
  'Medical Shops and Clinics',
  'Grocery and Supermarkets',
  'Real Estate',
  'Education and Coaching',
  'Hardware and Construction',
  'Travel Agencies',
  'Photography and Event Services',
  'Home Services',
  'Other / Custom Business Category',
] as const;

export const SUBSCRIPTION_PLANS = ['free', 'starter', 'pro', 'enterprise'] as const;
export type SubscriptionPlan = (typeof SUBSCRIPTION_PLANS)[number];

export const SUBSCRIPTION_STATUSES = ['active', 'trial', 'past_due', 'suspended'] as const;
export type SubscriptionStatus = (typeof SUBSCRIPTION_STATUSES)[number];

export const BILLING_CYCLES = ['monthly', 'annual'] as const;
export type BillingCycle = (typeof BILLING_CYCLES)[number];

export const VALIDATION_LIMITS = {
  ID_REGEX: /^[a-zA-Z0-9_-]+$/,
  SLUG_REGEX: /^[a-z0-9-]+$/,
  URL_REGEX: /^https?:\/\/.+/,
  GOOGLE_REVIEW_HOST_REGEX: /(^|\.)(g\.page|goo\.gl|google\.[a-z.]{2,})$/i,
  LOGO_DATA_URI_REGEX: /^data:image\/(png|jpeg|jpg|webp);base64,[A-Za-z0-9+/=]+$/,
  BUSINESS_NAME_MIN: 2,
  BUSINESS_NAME_MAX: 120,
  SLUG_MIN: 2,
  SLUG_MAX: 80,
  CATEGORY_MIN: 2,
  CATEGORY_MAX: 80,
  URL_MIN: 10,
  URL_MAX: 500,
  LOGO_URL_MAX: 100000,
  LOCATION_MAX: 120,
  KEYWORDS_MIN: 2,
  KEYWORDS_MAX: 250,
  OWNER_EMAIL_MAX: 200,
  RENEWAL_DATE_MAX: 20,
  NOTES_MAX: 300,
} as const;

export const BOOTSTRAP_ADMIN_EMAIL = 'yashshinge111@gmail.com';

export function slugifyText(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, VALIDATION_LIMITS.SLUG_MAX);
}

export interface StarterBusinessTemplate {
  name: string;
  slug: string;
  category: string;
  location: string;
  googleReviewUrl: string;
}

export const STARTER_BUSINESSES: readonly StarterBusinessTemplate[] = [
  {
    name: 'Aroma Craft Cafe',
    slug: 'aroma-craft-cafe',
    category: 'Cafe and Restaurant',
    location: 'Kothrud, Pune',
    googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Aroma+Craft+Cafe+Pune',
  },
  {
    name: 'Veda Comfort Furniture',
    slug: 'veda-comfort-furniture',
    category: 'Furniture and Interior Design',
    location: 'Bandra West, Mumbai',
    googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Veda+Comfort+Furniture+Mumbai',
  },
  {
    name: 'SparkTech Mobile & Electronics',
    slug: 'sparktech-mobile-electronics',
    category: 'Electronics and Mobile Shops',
    location: 'FC Road, Pune',
    googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=SparkTech+Mobile+Electronics+Pune',
  },
  {
    name: 'Aura Glow Beauty Salon',
    slug: 'aura-glow-beauty-salon',
    category: 'Beauty Parlour and Salon',
    location: 'Indiranagar, Bengaluru',
    googleReviewUrl: 'https://www.google.com/maps/search/?api=1&query=Aura+Glow+Beauty+Salon+Bengaluru',
  },
] as const;

export const QUICK_EXPERIENCE_KEYWORDS = [
  'friendly staff',
  'fast service',
  'great quality',
  'clean place',
  'fair pricing',
  'helpful guidance',
] as const;
