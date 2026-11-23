import 'dotenv/config';
import dns from 'dns';
import express, { type Request, type Response } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

dns.setDefaultResultOrder('ipv4first');

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ALLOWED_LANGUAGES = ['English', 'Hindi', 'Marathi', 'Hinglish'] as const;
type AllowedLanguage = (typeof ALLOWED_LANGUAGES)[number];

interface GeneratedReviewItem {
  style: string;
  text: string;
}

interface GenerateReviewsBody {
  businessName?: unknown;
  category?: unknown;
  keywords?: unknown;
  language?: unknown;
  isRegenerate?: unknown;
  previousReviews?: unknown;
}

interface TranscribeAudioBody {
  audioBase64?: unknown;
  mimeType?: unknown;
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY?.trim();
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 25000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    msg.includes('429') ||
    msg.includes('503') ||
    msg.includes('RESOURCE_EXHAUSTED') ||
    msg.includes('UNAVAILABLE') ||
    msg.includes('ETIMEDOUT') ||
    msg.includes('ECONNRESET')
  );
}

async function generateThreeReviews(params: {
  businessName: string;
  category: string;
  keywords: string;
  language: AllowedLanguage;
  isRegenerate: boolean;
  previousReviews: string[];
}): Promise<GeneratedReviewItem[]> {
  const ai = getGeminiClient();

  const languageInstructions: Record<AllowedLanguage, string> = {
    English:
      'Write all 3 reviews in natural, everyday English as an ordinary customer writing on their phone.',
    Hindi:
      'Write all 3 reviews completely in natural, everyday conversational Hindi using Devanagari script (हिंदी). Avoid overly formal bookish translation or awkward English-Hindi mixing unless a word is normally used that way.',
    Marathi:
      'Write all 3 reviews completely in natural, everyday conversational Marathi using Devanagari script (मराठी). Use warm, authentic Marathi phrasing as spoken by local customers.',
    Hinglish:
      'Write all 3 reviews completely in natural, everyday Hinglish — conversational Hindi written in Roman English letters mixed naturally with common English words (for example: "Coffee kaafi fresh thi aur staff ka behaviour bhi polite tha"). NEVER use Devanagari script for Hinglish.',
  };

  const avoidPreviousBlock =
    params.isRegenerate && params.previousReviews.length > 0
      ? `\nThe customer clicked "Regenerate" because they want fresh wording. Do NOT repeat the phrasing, openings, or sentence patterns from these previous drafts:\n${params.previousReviews
          .map((r, i) => `- Previous ${i + 1}: ${r}`)
          .join('\n')}`
      : '';

  const systemInstruction = `You are helping a real customer write a genuine, short-to-medium Google review based strictly on the keywords they provided.

CRITICAL ACCURACY & ANTI-HALLUCINATION RULES:
1. Ground every review ONLY in the provided business name, business category, and the customer's exact experience keywords.
2. NEVER invent dishes, products, prices, staff names, wait times, parking, discounts, cleanliness claims, or any experience the customer did NOT mention in their keywords.
3. Write like a real human customer typing naturally on a phone — warm, personal, and grounded. Never sound like an ad, brochure, or AI template.
4. Strictly avoid robotic or repetitive phrases such as: "I recently visited", "Overall, a wonderful experience", "exceeded expectations", "hidden gem", "top-notch", "unparalleled", "must-visit", or "highly recommended for all".
5. ${languageInstructions[params.language]}
6. Produce EXACTLY 3 distinct review versions that differ clearly in opening style, sentence structure, vocabulary, and length:
   - Version 1 ("Short & Direct"): 1–2 concise sentences, straightforward and authentic.
   - Version 2 ("Warm & Personal"): 2–3 natural conversational sentences with a personal tone.
   - Version 3 ("Detailed & Thoughtful"): 3–4 balanced sentences expanding gently on the provided keywords without inventing any unstated facts.`;

  const userPrompt = `Business Name: ${params.businessName}
Business Category: ${params.category}
Selected Language: ${params.language}
Customer Experience Keywords: ${params.keywords}${avoidPreviousBlock}

Generate exactly 3 distinct, natural-sounding customer review versions in ${params.language}.`;

  let lastError: unknown;
  const modelsToTry: Array<{ model: string; thinkingLevel: ThinkingLevel }> = [
    { model: 'gemini-3.1-flash-lite', thinkingLevel: ThinkingLevel.MINIMAL },
    { model: 'gemini-4-hydrogen', thinkingLevel: ThinkingLevel.LOW },
  ];

  for (let attempt = 0; attempt < modelsToTry.length; attempt++) {
    const target = modelsToTry[attempt];
    try {
      const response = await ai.models.generateContent({
        model: target.model,
        contents: userPrompt,
        config: {
          abortSignal: AbortSignal.timeout(20000),
          systemInstruction,
          thinkingConfig: { thinkingLevel: target.thinkingLevel },
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              reviews: {
                type: Type.ARRAY,
                description: 'Exactly 3 distinct customer review drafts.',
                items: {
                  type: Type.OBJECT,
                  properties: {
                    style: {
                      type: Type.STRING,
                      description: 'Brief style label such as Short & Direct, Warm & Personal, or Detailed & Thoughtful.',
                    },
                    text: {
                      type: Type.STRING,
                      description: 'The complete customer review text in the selected language.',
                    },
                  },
                  required: ['style', 'text'],
                },
              },
            },
            required: ['reviews'],
          },
        },
      });

      const rawText = (response.text ?? '').trim();
      if (!rawText) {
        throw new Error('Empty response received from Gemini API.');
      }

      const parsed = JSON.parse(rawText) as { reviews?: GeneratedReviewItem[] };
      const validReviews = (parsed.reviews ?? [])
        .map((item) => ({
          style: typeof item.style === 'string' && item.style.trim() ? item.style.trim() : 'Review Option',
          text: typeof item.text === 'string' ? item.text.trim() : '',
        }))
        .filter((item) => item.text.length > 0);

      if (validReviews.length === 3) {
        return validReviews;
      }
      if (validReviews.length > 3) {
        return validReviews.slice(0, 3);
      }
      throw new Error(`Expected 3 reviews from Gemini API, received ${validReviews.length}.`);
    } catch (error) {
      lastError = error;
      console.error(`Model ${target.model} failed:`, error instanceof Error ? error.message : String(error));
      if (attempt < modelsToTry.length - 1 && (isRetryableError(error) || String(error).includes('504') || String(error).includes('DEADLINE_EXCEEDED'))) {
        await sleep(300);
        continue;
      }
      break;
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function startServer() {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      service: 'AI Review Studio',
      model: 'gemini-3.1-flash-lite',
      hasApiKey: Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY !== 'MY_GEMINI_API_KEY'),
    });
  });

  app.post('/api/reviews/generate', async (req: Request, res: Response) => {
    try {
      const body = (req.body ?? {}) as GenerateReviewsBody;

      const businessName = typeof body.businessName === 'string' ? body.businessName.trim() : '';
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      const keywords = typeof body.keywords === 'string' ? body.keywords.trim() : '';
      const language = typeof body.language === 'string' ? body.language.trim() : '';
      const isRegenerate = Boolean(body.isRegenerate);
      const previousReviews = Array.isArray(body.previousReviews)
        ? body.previousReviews.filter((item): item is string => typeof item === 'string').slice(0, 3)
        : [];

      if (businessName.length < 2 || businessName.length > 120) {
        res.status(400).json({ error: 'Please select or enter a valid business name (2–120 characters).' });
        return;
      }
      if (category.length < 2 || category.length > 80) {
        res.status(400).json({ error: 'Please select a valid business category.' });
        return;
      }
      if (keywords.length < 2 || keywords.length > 250) {
        res.status(400).json({
          error: 'Please enter 2–3 keywords describing your genuine experience (2–250 characters).',
        });
        return;
      }
      if (!ALLOWED_LANGUAGES.includes(language as AllowedLanguage)) {
        res.status(400).json({ error: 'Language must be English, Hindi, Marathi, or Hinglish.' });
        return;
      }

      const reviews = await generateThreeReviews({
        businessName,
        category,
        keywords,
        language: language as AllowedLanguage,
        isRegenerate,
        previousReviews,
      });

      res.json({
        reviews,
        language,
        model: 'gemini-3.1-flash-lite',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      console.error('Review generation failed:', msg);

      if (msg === 'GEMINI_API_KEY_MISSING') {
        res.status(500).json({
          error: 'Gemini API key is not configured on the server. Please check GEMINI_API_KEY in Settings > Secrets.',
        });
        return;
      }
      if (msg.includes('API_KEY_INVALID') || msg.includes('PERMISSION_DENIED') || msg.includes('403')) {
        res.status(502).json({
          error: 'Gemini API key was rejected. Please verify your API key in Settings > Secrets.',
        });
        return;
      }
      if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
        res.status(429).json({
          error: 'AI review generation is temporarily busy. Please wait a few seconds and try again.',
        });
        return;
      }

      res.status(502).json({
        error: 'Could not generate reviews right now. Please try again in a moment.',
      });
    }
  });

  app.post(
    '/api/audio/transcribe',
    express.json({ limit: '10mb' }),
    async (req: Request, res: Response) => {
      try {
        const body = (req.body ?? {}) as TranscribeAudioBody;
        const rawBase64 = typeof body.audioBase64 === 'string' ? body.audioBase64.trim() : '';
        const rawMime = typeof body.mimeType === 'string' ? body.mimeType.trim() : 'audio/webm';
        const cleanMimeType = rawMime.split(';')[0].trim() || 'audio/webm';

        if (!rawBase64 || rawBase64.length < 32) {
          res.status(400).json({ error: 'No audio recording was received. Please speak for at least 1 second.' });
          return;
        }
        if (!cleanMimeType.startsWith('audio/')) {
          res.status(400).json({ error: 'Invalid audio format.' });
          return;
        }

        const ai = getGeminiClient();
        const transcriptionPrompt = `Transcribe the customer's spoken audio verbatim WITHOUT translating anything.
Follow these strict script rules word-for-word:
1. Spoken English words MUST be written in Roman English script (e.g., coffee, fast service, polite staff, furniture, quality).
2. Spoken Hindi words MUST be written in Devanagari script (e.g., बहुत अच्छा, कॉफ़ी, बढ़िया, साफ).
3. Spoken Marathi words MUST be written in Devanagari script (e.g., छान, उत्तम सेवा, खूप आवडले).
4. If the speaker mixes languages in the same sentence (for example Hindi or Marathi mixed with English words), write the Hindi/Marathi words in Devanagari and the English words in Roman English script in the exact order spoken.
5. NEVER translate Hindi or Marathi into English, and NEVER translate English into Hindi or Marathi.
6. Return ONLY the clean transcribed text with no quotes, labels, or commentary. If the audio is silent, static, or contains no speech, return EXACTLY: [SILENT]`;

        const audioPart = {
          inlineData: {
            mimeType: cleanMimeType,
            data: rawBase64,
          },
        };

        let transcript = '';
        let usedModel = 'gemini-3.5-transcribe';
        const transcribeModels = ['gemini-3.5-transcribe', 'gemini-3.1-flash-lite'] as const;

        for (let idx = 0; idx < transcribeModels.length; idx++) {
          const modelName = transcribeModels[idx];
          try {
            const response = await ai.models.generateContent({
              model: modelName,
              contents: { parts: [audioPart, { text: transcriptionPrompt }] },
              config: {
                abortSignal: AbortSignal.timeout(20000),
              },
            });
            const rawTranscript = (response.text ?? '').trim();
            transcript = rawTranscript === '[SILENT]' || rawTranscript.toLowerCase() === '[silent]' ? '' : rawTranscript;
            usedModel = modelName;
            break;
          } catch (err) {
            console.error(`Transcription model ${modelName} failed:`, err instanceof Error ? err.message : String(err));
            if (idx === transcribeModels.length - 1) {
              throw err;
            }
          }
        }

        if (!transcript) {
          res.status(422).json({
            error: 'Could not detect clear speech in that recording. Please try speaking closer to the mic or typing.',
          });
          return;
        }

        res.json({
          transcript,
          model: usedModel,
        });
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error('Audio transcription failed:', msg);

        if (msg === 'GEMINI_API_KEY_MISSING') {
          res.status(500).json({
            error: 'Gemini API key is not configured on the server. Please check GEMINI_API_KEY in Settings > Secrets.',
          });
          return;
        }
        if (msg.includes('RESOURCE_EXHAUSTED') || msg.includes('429')) {
          res.status(429).json({
            error: 'Voice transcription is temporarily busy. Please wait a moment and try again.',
          });
          return;
        }

        res.status(502).json({
          error: 'Could not transcribe voice recording right now. Please try again or type your keywords.',
        });
      }
    }
  );

  const distDir = path.resolve(__dirname, 'dist');
  const isDev = process.env.NODE_ENV === 'development' || !fs.existsSync(path.join(distDir, 'index.html'));

  if (isDev) {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(distDir));
    app.get('*', (_req: Request, res: Response) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  const port = Number(process.env.PORT || 3000);
  app.listen(port, '0.0.0.0', () => {
    console.log(`AI Review Studio server listening on http://0.0.0.0:${port} (${isDev ? 'development' : 'production'})`);
  });
}

void startServer();
