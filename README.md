# AI Review Studio

A mobile-first, multi-business AI customer review studio powered by the Google Gemini API (`@google/genai`) and backed by Firebase Firestore & Authentication.

Customers enter or speak **2–3 genuine experience keywords**, pick **English**, **Hindi (हिंदी)**, **Marathi (मराठी)**, or **Hinglish**, and receive **3 distinct, human-sounding review drafts** grounded strictly in what they shared. Each review can be edited and copied in one tap, followed by a prominent **Write a Google Review** button pointing to that specific business's Google Review URL.

---

## Core Features

- **One Store – One Unique Link & QR Code (`/b/:slug`, `/store/:slug`)**
  - Every registered store has its own unique customer review page, optional Store Logo, Store Name, and dedicated Google Review URL.
  - Each store gets a permanent QR code pointing to `/b/:slug` — updating the store's Google Review URL or name never requires reprinting the QR code.
- **Customer Review Page Flow**
  - **First Section – Write Your Review (`Share Your Experience`)**: Customers select a language (**English**, **Hindi (हिंदी)**, **Marathi (मराठी)**, or **Hinglish**), type or speak via microphone (`POST /api/audio/transcribe`), and click **AI Generate Review** to produce 3 distinct, natural-sounding, editable & copyable review drafts grounded strictly in their words.
  - **Second Section – Google Review (`Continue to Google Reviews`)**: Located directly below the AI review section, opening that specific store's configured Google Review URL so customers submit their own review directly on Google.
- **17+ Business Categories**
  - Includes Cafe and Restaurant, Hotels and Bakery, Furniture and Interior Design, Clothing and Fashion, Electronics and Mobile Shops, Automobile and Bike Showrooms, Beauty Parlour and Salon, Gym and Fitness, Medical Shops and Clinics, Grocery and Supermarkets, Real Estate, Education and Coaching, Hardware and Construction, Travel Agencies, Photography and Event Services, Home Services, and Other / Custom Business Category.
  - Administrators can add and manage custom categories.
- **Secure Admin Dashboard & Store Settings (`/admin`)**
  - Google Sign-In authentication verified against Firebase Auth & Firestore security rules.
  - **Store Settings** panel: edit **Store Name**, upload or link optional **Store Logo**, paste & validate **Google Review URL**, click **Save Settings**, **Preview Customer Page**, and copy/download the store's permanent QR code.
  - Add, edit, delete, enable, or disable stores, plus view per-store and per-language usage statistics.

---

## Architecture & Tech Stack

- **Frontend**: React 19, TypeScript, Tailwind CSS v4, Lucide Icons, `qrcode.react`
- **Backend**: Node.js + Express (`server.ts`)
- **AI**: `@google/genai` (`gemini-3.1-flash-lite`, with automatic `gemini-4-hydrogen` fallback) running exclusively on the server via `POST /api/reviews/generate`
- **Database & Auth**: Firebase Firestore + Firebase Authentication (`firebase-applet-config.json`, `firestore.rules`)

---

## Environment Variables

Configure the following environment variables (in `.env` locally or **Settings > Secrets** in Google AI Studio):

```env
GEMINI_API_KEY="YOUR_GEMINI_API_KEY"
APP_URL="https://your-app-url"
PORT="3000"
```

> `GEMINI_API_KEY` is accessed strictly on the server in `server.ts` and is never exposed to browser bundles.

---

## Local Setup & Commands

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run in development** (Express + Vite middleware on port `3000`):
   ```bash
   npm run dev
   ```

3. **Type-check & lint**:
   ```bash
   npm run lint
   npm run lint:rules
   ```

4. **Build for production**:
   ```bash
   npm run build
   ```

5. **Run production server**:
   ```bash
   npm start
   ```

---

## Deployment from Google AI Studio

1. Ensure `GEMINI_API_KEY` is set in **Settings > Secrets**.
2. Confirm `firebase-applet-config.json` and `firestore.rules` are provisioned and deployed.
3. Build command: `npm run build`
4. Start command: `npm start` (`node server.ts` serving `dist/` and `/api/*` on port `3000`).
