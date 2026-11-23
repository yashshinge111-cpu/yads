import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Check,
  Copy,
  ExternalLink,
  Languages,
  MapPin,
  Mic,
  RefreshCw,
  RotateCcw,
  Sparkles,
  Square,
  Store,
} from 'lucide-react';
import {
  LANGUAGE_META,
  LANGUAGES,
  QUICK_EXPERIENCE_KEYWORDS,
  VALIDATION_LIMITS,
  type ReviewLanguage,
} from '../shared/constants';
import {
  recordUsageLog,
  validateGoogleReviewUrl,
  type BusinessRecord,
} from '../lib/firestoreService';

interface GeneratedReview {
  id: number;
  style: string;
  originalText: string;
  editedText: string;
}

interface CustomerStudioProps {
  businesses: BusinessRecord[];
  categories: string[];
  lockedBusiness: BusinessRecord | null;
  slugNotFound: string | null;
  businessesLoading: boolean;
  onClearLockedBusiness: () => void;
  onSelectBusiness: (business: BusinessRecord) => void;
}

export function CustomerStudio({
  businesses,
  categories,
  lockedBusiness,
  slugNotFound,
  businessesLoading,
  onClearLockedBusiness,
  onSelectBusiness,
}: CustomerStudioProps) {
  const [mode, setMode] = useState<'registered' | 'custom'>('registered');
  const [selectedBusinessId, setSelectedBusinessId] = useState<string>('');
  const [customBusinessName, setCustomBusinessName] = useState('');
  const [customCategory, setCustomCategory] = useState<string>(categories[0] || 'Cafe and Restaurant');
  const [otherCategoryText, setOtherCategoryText] = useState('');
  const [logoLoadError, setLogoLoadError] = useState(false);

  const [language, setLanguage] = useState<ReviewLanguage>('English');
  const [keywords, setKeywords] = useState('');
  const [reviews, setReviews] = useState<GeneratedReview[]>([]);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [isGenerating, setIsGenerating] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Voice recording & smart transcription state
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioChunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) {
        window.clearInterval(timerRef.current);
      }
      mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  // Sync mode & selection when lockedBusiness or businesses list changes
  useEffect(() => {
    if (lockedBusiness) {
      setMode('registered');
      setSelectedBusinessId(lockedBusiness.id);
      return;
    }
    if (businesses.length > 0) {
      setSelectedBusinessId((prev) => {
        if (prev && businesses.some((b) => b.id === prev)) return prev;
        return businesses[0].id;
      });
    } else if (!businessesLoading) {
      setMode('custom');
    }
  }, [lockedBusiness, businesses, businessesLoading]);

  useEffect(() => {
    if (categories.length > 0 && !categories.includes(customCategory)) {
      setCustomCategory(categories[0]);
    }
  }, [categories, customCategory]);

  const activeRegisteredBusiness = useMemo(() => {
    if (lockedBusiness) return lockedBusiness;
    return businesses.find((b) => b.id === selectedBusinessId) ?? null;
  }, [lockedBusiness, businesses, selectedBusinessId]);

  useEffect(() => {
    setLogoLoadError(false);
  }, [activeRegisteredBusiness?.id, activeRegisteredBusiness?.logoUrl]);

  const isCustomMode = !lockedBusiness && (mode === 'custom' || businesses.length === 0);

  const effectiveBusinessName = isCustomMode
    ? customBusinessName.trim()
    : activeRegisteredBusiness?.name || '';

  const effectiveCategory = isCustomMode
    ? customCategory === 'Other / Custom Business Category'
      ? otherCategoryText.trim() || 'Other / Custom Business Category'
      : customCategory
    : activeRegisteredBusiness?.category || '';

  const configuredGoogleReviewUrl = useMemo(() => {
    if (isCustomMode || !activeRegisteredBusiness?.googleReviewUrl) return '';
    const candidate = activeRegisteredBusiness.googleReviewUrl.trim();
    return validateGoogleReviewUrl(candidate) === null ? candidate : '';
  }, [isCustomMode, activeRegisteredBusiness]);

  const keywordCount = useMemo(() => {
    const parts = keywords
      .split(/[,;\n]+|\s{2,}/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (parts.length > 1) return parts.length;
    return keywords.trim() ? keywords.trim().split(/\s+/).length : 0;
  }, [keywords]);

  const handleAppendKeyword = (chip: string) => {
    setErrorMsg(null);
    const trimmed = keywords.trim();
    if (!trimmed) {
      setKeywords(chip);
      return;
    }
    const lower = trimmed.toLowerCase();
    if (lower.includes(chip.toLowerCase())) return;
    const separator = trimmed.endsWith(',') ? ' ' : ', ';
    const next = `${trimmed}${separator}${chip}`;
    if (next.length <= VALIDATION_LIMITS.KEYWORDS_MAX) {
      setKeywords(next);
    }
  };

  const stopRecordingCleanup = () => {
    if (timerRef.current !== null) {
      window.clearInterval(timerRef.current);
      timerRef.current = null;
    }
    mediaStreamRef.current?.getTracks().forEach((t) => t.stop());
    mediaStreamRef.current = null;
    mediaRecorderRef.current = null;
    setIsRecording(false);
    setRecordingSeconds(0);
  };

  const blobToBase64 = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        const result = typeof reader.result === 'string' ? reader.result : '';
        const base64 = result.includes(',') ? result.split(',')[1] : result;
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('Failed to read recorded audio.'));
      reader.readAsDataURL(blob);
    });

  const transcribeAudioBlob = async (blob: Blob, mimeType: string) => {
    setIsTranscribing(true);
    setErrorMsg(null);
    try {
      const audioBase64 = await blobToBase64(blob);
      const response = await fetch('/api/audio/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ audioBase64, mimeType }),
      });

      const payload = (await response.json()) as { transcript?: string; error?: string };
      if (!response.ok || !payload.transcript) {
        throw new Error(payload.error || 'Could not transcribe voice recording.');
      }

      const cleanTranscript = payload.transcript.trim();
      setKeywords((prev) => {
        const current = prev.trim();
        const combined = current ? `${current}, ${cleanTranscript}` : cleanTranscript;
        return combined.slice(0, VALIDATION_LIMITS.KEYWORDS_MAX);
      });
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Voice transcription failed.');
    } finally {
      setIsTranscribing(false);
    }
  };

  const handleToggleRecording = async () => {
    setErrorMsg(null);

    if (isRecording && mediaRecorderRef.current) {
      try {
        mediaRecorderRef.current.stop();
      } catch {
        stopRecordingCleanup();
      }
      return;
    }

    if (
      typeof navigator === 'undefined' ||
      !navigator.mediaDevices ||
      typeof navigator.mediaDevices.getUserMedia !== 'function' ||
      typeof MediaRecorder === 'undefined'
    ) {
      setErrorMsg('Microphone recording is not supported in this browser. Please type your experience below.');
      return;
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      mediaStreamRef.current = stream;

      const candidateTypes = [
        'audio/webm;codecs=opus',
        'audio/webm',
        'audio/mp4',
        'audio/ogg;codecs=opus',
      ];
      const chosenMimeType =
        candidateTypes.find((type) => MediaRecorder.isTypeSupported(type)) || '';

      const recorder = chosenMimeType
        ? new MediaRecorder(stream, { mimeType: chosenMimeType })
        : new MediaRecorder(stream);

      audioChunksRef.current = [];
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data && event.data.size > 0) {
          audioChunksRef.current.push(event.data);
        }
      };

      recorder.onstop = () => {
        const finalMime = recorder.mimeType || chosenMimeType || 'audio/webm';
        const blob = new Blob(audioChunksRef.current, { type: finalMime });
        audioChunksRef.current = [];
        stopRecordingCleanup();

        if (blob.size < 400) {
          setErrorMsg('Recording was too short. Please tap Speak and share a few words.');
          return;
        }
        void transcribeAudioBlob(blob, finalMime);
      };

      recorder.start();
      setIsRecording(true);
      setRecordingSeconds(0);

      timerRef.current = window.setInterval(() => {
        setRecordingSeconds((sec) => {
          if (sec >= 44) {
            try {
              mediaRecorderRef.current?.stop();
            } catch {
              stopRecordingCleanup();
            }
            return 45;
          }
          return sec + 1;
        });
      }, 1000);
    } catch {
      stopRecordingCleanup();
      setErrorMsg('Microphone permission was denied or unavailable. Please allow mic access or type your experience.');
    }
  };

  const runGeneration = async (isRegenerate: boolean) => {
    setErrorMsg(null);

    if (effectiveBusinessName.length < VALIDATION_LIMITS.BUSINESS_NAME_MIN) {
      setErrorMsg('Please select a store or enter the store name first.');
      return;
    }
    if (effectiveCategory.length < VALIDATION_LIMITS.CATEGORY_MIN) {
      setErrorMsg('Please select or enter a business category.');
      return;
    }
    const cleanKeywords = keywords.trim();
    if (cleanKeywords.length < VALIDATION_LIMITS.KEYWORDS_MIN) {
      setErrorMsg('Please write or speak a few words about your genuine experience first.');
      return;
    }

    setIsGenerating(true);
    setCopiedId(null);

    try {
      const response = await fetch('/api/reviews/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          businessName: effectiveBusinessName,
          category: effectiveCategory,
          keywords: cleanKeywords,
          language,
          isRegenerate,
          previousReviews: isRegenerate ? reviews.map((r) => r.originalText) : [],
        }),
      });

      const payload = (await response.json()) as {
        reviews?: { style: string; text: string }[];
        error?: string;
      };

      if (!response.ok || !payload.reviews || payload.reviews.length !== 3) {
        throw new Error(payload.error || 'Could not generate reviews. Please try again.');
      }

      setReviews(
        payload.reviews.map((item, idx) => ({
          id: idx + 1,
          style: item.style || `Option ${idx + 1}`,
          originalText: item.text,
          editedText: item.text,
        }))
      );

      // Persist anonymous usage telemetry for registered, enabled businesses
      if (!isCustomMode && activeRegisteredBusiness) {
        recordUsageLog({
          businessId: activeRegisteredBusiness.id,
          businessName: activeRegisteredBusiness.name,
          category: activeRegisteredBusiness.category,
          language,
          keywordCount: Math.max(1, keywordCount),
          isRegeneration: isRegenerate,
        }).catch((err) => {
          console.warn('Usage log write skipped:', err);
        });
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Something went wrong while generating reviews.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleCopyReview = async (review: GeneratedReview) => {
    try {
      await navigator.clipboard.writeText(review.editedText);
      setCopiedId(review.id);
      window.setTimeout(() => {
        setCopiedId((current) => (current === review.id ? null : current));
      }, 2500);
    } catch {
      const textarea = document.createElement('textarea');
      textarea.value = review.editedText;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      try {
        document.execCommand('copy');
        setCopiedId(review.id);
        window.setTimeout(() => {
          setCopiedId((current) => (current === review.id ? null : current));
        }, 2500);
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  const handleReviewTextChange = (id: number, value: string) => {
    setReviews((prev) => prev.map((r) => (r.id === id ? { ...r, editedText: value } : r)));
  };

  const handleResetReview = (id: number) => {
    setReviews((prev) =>
      prev.map((r) => (r.id === id ? { ...r, editedText: r.originalText } : r))
    );
  };

  const langMeta = LANGUAGE_META[language];
  const showStoreLogo =
    !isCustomMode &&
    Boolean(activeRegisteredBusiness?.logoUrl?.trim()) &&
    !logoLoadError;

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-8">
      {slugNotFound && (
        <div
          role="alert"
          className="bg-amber-50 border border-amber-200 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
        >
          <div className="flex items-start gap-3">
            <AlertCircle className="w-5 h-5 text-amber-700 shrink-0 mt-0.5" />
            <div>
              <h2 className="text-sm font-bold text-slate-900">
                Store review page unavailable
              </h2>
              <p className="text-sm text-slate-700 mt-0.5">
                The link <span className="font-mono text-xs">/b/{slugNotFound}</span> is either disabled or does not exist. You can pick another active store below.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClearLockedBusiness}
            className="min-h-[44px] px-4 py-2 rounded-xl bg-white border border-amber-300 text-sm font-semibold text-slate-900 hover:bg-amber-100/60 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Select Active Store
          </button>
        </div>
      )}

      {/* Store Brand Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-6 border-b border-slate-200">
        <div className="flex items-start sm:items-center gap-4 max-w-2xl">
          {!isCustomMode && activeRegisteredBusiness && (
            <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl border border-slate-200 bg-slate-50 flex items-center justify-center overflow-hidden shrink-0">
              {showStoreLogo ? (
                <img
                  src={activeRegisteredBusiness.logoUrl}
                  alt={`${activeRegisteredBusiness.name} logo`}
                  referrerPolicy="no-referrer"
                  onError={() => setLogoLoadError(true)}
                  className="w-full h-full object-contain p-1.5"
                />
              ) : (
                <Store className="w-7 h-7 text-blue-600" />
              )}
            </div>
          )}

          <div>
            {lockedBusiness ? (
              <>
                <div className="flex flex-wrap items-center gap-2 text-xs sm:text-sm text-slate-500 mb-1">
                  <span>{lockedBusiness.category}</span>
                  {lockedBusiness.location && (
                    <>
                      <span aria-hidden="true">·</span>
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="w-3.5 h-3.5 text-slate-400" />
                        {lockedBusiness.location}
                      </span>
                    </>
                  )}
                </div>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance]">
                  {lockedBusiness.name}
                </h1>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  Share your genuine visit below, generate polished review drafts, and continue directly to Google Reviews.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs sm:text-sm font-semibold text-blue-600 mb-1">
                  Dynamic Customer Review Studio
                </p>
                <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 [text-wrap:balance]">
                  {!isCustomMode && activeRegisteredBusiness
                    ? activeRegisteredBusiness.name
                    : 'Write a Genuine Store Review'}
                </h1>
                <p className="mt-1 text-sm text-slate-600 leading-relaxed">
                  Quick, natural-sounding reviews in English, हिंदी, मराठी, or Hinglish grounded strictly in your real visit.
                </p>
              </>
            )}
          </div>
        </div>

        {lockedBusiness && (
          <button
            type="button"
            onClick={onClearLockedBusiness}
            className="self-start md:self-auto min-h-[44px] px-4 py-2 rounded-xl border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
          >
            Switch Store
          </button>
        )}
      </div>

      {/* FIRST SECTION: WRITE YOUR REVIEW ("Share Your Experience") */}
      <section aria-labelledby="share-experience-heading" className="space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-2">
          <div>
            <p className="text-xs font-semibold text-blue-600 mb-1">Step 1 · Write Your Review</p>
            <h2
              id="share-experience-heading"
              className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900"
            >
              Share Your Experience
            </h2>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8 items-start">
          {/* Composer Form */}
          <div className="lg:col-span-5 bg-slate-50/80 border border-slate-200 rounded-2xl p-4 sm:p-6 space-y-5">
            {!lockedBusiness && (
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-bold text-slate-900">1. Select Store</label>
                  {businesses.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setMode(mode === 'registered' ? 'custom' : 'registered');
                        setReviews([]);
                      }}
                      className="text-xs font-semibold text-blue-600 hover:text-blue-700 py-1 px-1 cursor-pointer"
                    >
                      {mode === 'registered' ? 'Enter custom store' : 'Choose registered store'}
                    </button>
                  )}
                </div>

                {!isCustomMode ? (
                  <div className="space-y-2">
                    <select
                      aria-label="Select store"
                      value={selectedBusinessId}
                      onChange={(e) => {
                        const found = businesses.find((b) => b.id === e.target.value);
                        setSelectedBusinessId(e.target.value);
                        if (found) onSelectBusiness(found);
                        setReviews([]);
                      }}
                      className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-base font-medium text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    >
                      {businesses.map((biz) => (
                        <option key={biz.id} value={biz.id}>
                          {biz.name} ({biz.category})
                        </option>
                      ))}
                    </select>
                    {activeRegisteredBusiness && (
                      <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 px-1">
                        <Store className="w-3.5 h-3.5 text-slate-400" />
                        <span>{activeRegisteredBusiness.category}</span>
                        {activeRegisteredBusiness.location && (
                          <>
                            <span aria-hidden="true">·</span>
                            <span>{activeRegisteredBusiness.location}</span>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={customBusinessName}
                      onChange={(e) => setCustomBusinessName(e.target.value)}
                      maxLength={VALIDATION_LIMITS.BUSINESS_NAME_MAX}
                      placeholder="Store name (e.g. Royal Bakery)"
                      className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                    />
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        Business Category
                      </label>
                      <select
                        aria-label="Business category"
                        value={customCategory}
                        onChange={(e) => setCustomCategory(e.target.value)}
                        className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-base text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      >
                        {categories.map((cat) => (
                          <option key={cat} value={cat}>
                            {cat}
                          </option>
                        ))}
                      </select>
                    </div>
                    {customCategory === 'Other / Custom Business Category' && (
                      <input
                        type="text"
                        value={otherCategoryText}
                        onChange={(e) => setOtherCategoryText(e.target.value)}
                        maxLength={VALIDATION_LIMITS.CATEGORY_MAX}
                        placeholder="Specify business category (e.g. Pet Clinic)"
                        className="w-full min-h-[48px] px-3.5 py-2.5 rounded-xl bg-white border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600"
                      />
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Language Selection */}
            <div className="space-y-2.5">
              <div className="flex items-center gap-2">
                <Languages className="w-4 h-4 text-blue-600" />
                <span className="text-sm font-bold text-slate-900">
                  {lockedBusiness ? '1. Choose Review Language' : '2. Choose Review Language'}
                </span>
              </div>
              <div
                role="radiogroup"
                aria-label="Review language"
                className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 p-1 bg-slate-200/75 rounded-xl"
              >
                {LANGUAGES.map((lang) => {
                  const active = language === lang;
                  return (
                    <button
                      key={lang}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setLanguage(lang)}
                      className={`min-h-[44px] px-2 py-2 rounded-lg text-sm font-semibold transition-all whitespace-nowrap flex flex-col items-center justify-center leading-tight cursor-pointer ${
                        active
                          ? 'bg-blue-600 text-white shadow-sm'
                          : 'text-slate-700 hover:bg-white/70 hover:text-slate-900'
                      }`}
                    >
                      <span>{LANGUAGE_META[lang].nativeLabel}</span>
                      {lang !== 'English' && lang !== 'Hinglish' && (
                        <span
                          className={`text-[11px] font-normal ${
                            active ? 'text-blue-100' : 'text-slate-500'
                          }`}
                        >
                          {lang}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Experience Input (Text + Voice Mic) */}
            <div className="space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <label htmlFor="experience-keywords" className="text-sm font-bold text-slate-900">
                  {lockedBusiness ? '2. Your Experience (Speak or Type)' : '3. Your Experience (Speak or Type)'}
                </label>
                <div className="flex items-center gap-2.5">
                  {keywords.length > 0 && !isRecording && (
                    <button
                      type="button"
                      onClick={() => setKeywords('')}
                      className="text-xs font-medium text-slate-500 hover:text-slate-800 cursor-pointer"
                    >
                      Clear
                    </button>
                  )}
                  <span className="text-xs font-mono tabular-nums text-slate-500">
                    {keywords.length}/{VALIDATION_LIMITS.KEYWORDS_MAX}
                  </span>
                </div>
              </div>
              <p className="text-xs text-slate-600">{langMeta.hint}</p>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <button
                  type="button"
                  disabled={isTranscribing || isGenerating}
                  onClick={() => void handleToggleRecording()}
                  className={`min-h-[46px] px-4 py-2.5 rounded-xl text-sm font-semibold inline-flex items-center justify-center gap-2 transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                    isRecording
                      ? 'bg-red-600 hover:bg-red-700 text-white shadow-sm'
                      : 'bg-white border border-slate-300 hover:border-blue-500 text-slate-800 hover:text-blue-700'
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {isTranscribing ? (
                    <>
                      <RefreshCw className="w-4 h-4 animate-spin text-blue-600" />
                      <span>Transcribing voice...</span>
                    </>
                  ) : isRecording ? (
                    <>
                      <Square className="w-4 h-4 fill-current" />
                      <span className="tabular-nums">
                        Stop Recording ({`0:${String(recordingSeconds).padStart(2, '0')}`})
                      </span>
                    </>
                  ) : (
                    <>
                      <Mic className="w-4 h-4 text-blue-600" />
                      <span>Speak with Microphone</span>
                    </>
                  )}
                </button>
                <span className="text-xs text-slate-500 leading-snug">
                  {isRecording
                    ? 'Speak naturally in English, हिंदी, मराठी, or mixed — tap Stop when done.'
                    : 'Hindi & Marathi stay in Devanagari; English stays in Roman script.'}
                </span>
              </div>

              <textarea
                id="experience-keywords"
                rows={3}
                value={keywords}
                onChange={(e) => {
                  setKeywords(e.target.value);
                  if (errorMsg) setErrorMsg(null);
                }}
                maxLength={VALIDATION_LIMITS.KEYWORDS_MAX}
                placeholder={langMeta.placeholder}
                className="w-full px-3.5 py-3 rounded-xl bg-white border border-slate-300 text-base text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 resize-none"
              />

              <div>
                <p className="text-xs text-slate-500 mb-1.5">Tap to add quick words (optional):</p>
                <div className="flex flex-wrap gap-1.5">
                  {QUICK_EXPERIENCE_KEYWORDS.map((chip) => (
                    <button
                      key={chip}
                      type="button"
                      onClick={() => handleAppendKeyword(chip)}
                      className="min-h-[38px] px-3 py-1.5 rounded-lg bg-white border border-slate-200 text-xs sm:text-sm font-medium text-slate-700 hover:border-blue-400 hover:text-blue-700 active:scale-[0.98] transition-all cursor-pointer"
                    >
                      + {chip}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {errorMsg && (
              <div
                role="alert"
                className="p-3.5 rounded-xl bg-red-50 border border-red-200 text-sm text-red-800 flex items-start gap-2.5"
              >
                <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" />
                <span>{errorMsg}</span>
              </div>
            )}

            <button
              type="button"
              disabled={isGenerating}
              onClick={() => void runGeneration(false)}
              className="w-full min-h-[52px] px-5 py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-base font-bold inline-flex items-center justify-center gap-2 shadow-sm active:scale-[0.99] transition-all cursor-pointer disabled:cursor-not-allowed"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="w-5 h-5 animate-spin" />
                  <span>Generating Review in {language}...</span>
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  <span>AI Generate Review</span>
                </>
              )}
            </button>

            <p className="text-xs text-slate-500 text-center leading-relaxed">
              Drafts are created strictly from what you shared — no invented claims or fake details.
            </p>
          </div>

          {/* Generated AI Review Options (Edit & Copy) */}
          <div className="lg:col-span-7 space-y-4">
            {isGenerating ? (
              <div className="space-y-4">
                <h3 className="text-lg font-bold text-slate-900">
                  Drafting 3 clear review options in {language}...
                </h3>
                {[1, 2, 3].map((idx) => (
                  <div
                    key={idx}
                    className="bg-white border border-slate-200 rounded-2xl p-5 space-y-3 animate-pulse"
                  >
                    <div className="h-4 w-36 bg-slate-200 rounded" />
                    <div className="space-y-2">
                      <div className="h-4 w-full bg-slate-100 rounded" />
                      <div className="h-4 w-11/12 bg-slate-100 rounded" />
                      <div className="h-4 w-3/4 bg-slate-100 rounded" />
                    </div>
                    <div className="h-10 w-32 bg-slate-100 rounded-xl" />
                  </div>
                ))}
              </div>
            ) : reviews.length > 0 ? (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                      Edit & copy your preferred review
                    </h3>
                    <p className="text-xs sm:text-sm text-slate-500">
                      {effectiveBusinessName} · {language} · 3 distinct options
                    </p>
                  </div>

                  <button
                    type="button"
                    disabled={isGenerating}
                    onClick={() => void runGeneration(true)}
                    className="min-h-[44px] px-4 py-2 rounded-xl border border-slate-300 bg-white hover:bg-slate-50 text-sm font-semibold text-slate-800 inline-flex items-center gap-2 transition-colors whitespace-nowrap shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4 text-blue-600" />
                    <span>Regenerate</span>
                  </button>
                </div>

                <div className="space-y-4">
                  {reviews.map((review, index) => {
                    const isCopied = copiedId === review.id;
                    const isModified = review.editedText !== review.originalText;
                    return (
                      <article
                        key={review.id}
                        className="bg-white border border-slate-200 rounded-2xl p-4 sm:p-5 transition-colors focus-within:border-blue-400"
                      >
                        <div className="flex items-center justify-between gap-3 mb-2.5">
                          <div className="flex items-center gap-2 text-xs sm:text-sm">
                            <span className="font-bold text-slate-900 tabular-nums">
                              0{index + 1}. {review.style}
                            </span>
                            {isModified && (
                              <>
                                <span aria-hidden="true" className="text-slate-300">
                                  ·
                                </span>
                                <span className="text-blue-600 font-medium">Edited</span>
                              </>
                            )}
                          </div>
                          <div className="flex items-center gap-3">
                            {isModified && (
                              <button
                                type="button"
                                onClick={() => handleResetReview(review.id)}
                                className="text-xs font-medium text-slate-500 hover:text-slate-800 inline-flex items-center gap-1 py-1 cursor-pointer"
                              >
                                <RotateCcw className="w-3.5 h-3.5" />
                                Reset
                              </button>
                            )}
                            <span className="text-xs font-mono tabular-nums text-slate-400">
                              {review.editedText.length} chars
                            </span>
                          </div>
                        </div>

                        <textarea
                          aria-label={`Edit review option ${index + 1}`}
                          rows={3}
                          value={review.editedText}
                          onChange={(e) => handleReviewTextChange(review.id, e.target.value)}
                          className="w-full p-3 rounded-xl bg-slate-50/70 border border-slate-200 text-base text-slate-800 leading-relaxed focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600 focus:border-blue-600 resize-y"
                        />

                        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs text-slate-500">
                            Tap inside the box to edit any word
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleCopyReview(review)}
                            className={`min-h-[44px] px-4 py-2 rounded-xl text-sm font-semibold inline-flex items-center gap-2 transition-all cursor-pointer whitespace-nowrap ${
                              isCopied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-slate-900 hover:bg-slate-800 text-white'
                            }`}
                          >
                            {isCopied ? (
                              <>
                                <Check className="w-4 h-4" />
                                <span>Copied!</span>
                              </>
                            ) : (
                              <>
                                <Copy className="w-4 h-4" />
                                <span>Copy Review</span>
                              </>
                            )}
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="bg-white border border-slate-200 rounded-2xl p-6 sm:p-8 space-y-6">
                <div>
                  <h3 className="text-lg sm:text-xl font-bold text-slate-900">
                    How AI review drafting works
                  </h3>
                  <p className="text-sm text-slate-600 mt-1 leading-relaxed">
                    Type or speak your experience on the left and tap{' '}
                    <span className="font-semibold text-slate-900">AI Generate Review</span>. You will get three natural options you can edit, copy, and post yourself on Google.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 pt-2 border-t border-slate-100">
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-blue-600">01. Short & Direct</div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Concise 1–2 sentence note ideal for quick mobile posting.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-blue-600">02. Warm & Personal</div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Natural conversational tone written in everyday words.
                    </p>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs font-bold text-emerald-600">03. Detailed & Thoughtful</div>
                    <p className="text-sm text-slate-600 leading-relaxed">
                      Balanced 3–4 sentences using only the facts you provided.
                    </p>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </section>

      {/* SECOND SECTION: GOOGLE REVIEW ("Continue to Google Reviews") */}
      <section
        aria-labelledby="google-review-section-heading"
        className="bg-emerald-50/75 border border-emerald-200 rounded-2xl p-5 sm:p-7"
      >
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-5">
          <div className="space-y-1.5 max-w-2xl">
            <p className="text-xs font-semibold text-emerald-700">Step 2 · Google Review</p>
            <h2
              id="google-review-section-heading"
              className="text-xl sm:text-2xl font-extrabold tracking-tight text-slate-900"
            >
              {activeRegisteredBusiness && !isCustomMode
                ? `Post your review for ${activeRegisteredBusiness.name}`
                : 'Ready to post on Google Reviews?'}
            </h2>
            {activeRegisteredBusiness && !isCustomMode ? (
              configuredGoogleReviewUrl ? (
                <p className="text-sm text-slate-700 leading-relaxed">
                  {reviews.length > 0
                    ? 'Copy your preferred review above, then tap Continue to Google Reviews to paste and submit your review directly on this store’s Google page.'
                    : 'Already have your review copied or want to write directly on Google? Open this store’s dedicated Google Reviews page below.'}
                </p>
              ) : (
                <p className="text-sm text-amber-800 leading-relaxed">
                  This store has not configured a valid Google Review link yet. Please ask the store owner to update it in Store Settings.
                </p>
              )
            ) : (
              <p className="text-sm text-slate-700 leading-relaxed">
                Select a registered store above or scan a store’s QR code to unlock that store’s dedicated Google Reviews link.
              </p>
            )}
          </div>

          <div className="shrink-0 w-full md:w-auto">
            {activeRegisteredBusiness && !isCustomMode && configuredGoogleReviewUrl ? (
              <a
                href={configuredGoogleReviewUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="w-full md:w-auto min-h-[54px] px-7 py-3.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-base font-bold inline-flex items-center justify-center gap-2.5 shadow-sm active:scale-[0.99] transition-all whitespace-nowrap"
              >
                <span>Continue to Google Reviews</span>
                <ExternalLink className="w-5 h-5" />
              </a>
            ) : (
              businesses.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setMode('registered');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-full md:w-auto min-h-[50px] px-6 py-3 rounded-xl bg-white border border-emerald-300 hover:bg-emerald-100/60 text-emerald-900 text-sm font-bold inline-flex items-center justify-center gap-2 transition-colors whitespace-nowrap cursor-pointer"
                >
                  <Store className="w-4 h-4" />
                  <span>Select Registered Store</span>
                </button>
              )
            )}
          </div>
        </div>
      </section>
    </main>
  );
}

