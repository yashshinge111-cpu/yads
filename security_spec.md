# Firestore Security Specification — AI Review Studio

## 1. Data Invariants
1. **Default-Deny Baseline**: Any unrecognized collection or document path is unconditionally denied (`match /{document=**} { allow read, write: if false; }`).
2. **Admin Privilege Integrity**: Only the verified bootstrapped owner email (`yashshinge111@gmail.com` with `email_verified == true`) or verified users listed in `/admins/{uid}` (`email_verified == true`) can create, update, or delete businesses and categories, or read usage logs.
3. **Public Visibility Boundary**: Unauthenticated customers can only `get` or `list` businesses where `enabled == true`. Disabled businesses are invisible to public queries and only accessible to verified admins.
4. **Strict Usage Telemetry Isolation**: Customers may `create` a `usageLogs` record only for an existing, enabled business (`exists(...)` and `get(...).data.enabled == true`) with server timestamp `createdAt == request.time`, valid language (`English`, `Hindi`, `Marathi`, `Hinglish`), and zero PII fields. Customers cannot read, list, update, or delete `usageLogs`.
5. **Immutable Audit & Ownership Fields**: `createdBy` and `createdAt` cannot be altered after creation; `updatedAt` must equal `request.time` on updates.
6. **Path & String Bounds**: Every document ID matches `^[a-zA-Z0-9_-]+$` (`<= 128` chars), every string/URL enforces strict `size()` and `matches()` constraints, and optional `logoUrl` accepts only empty strings, `http(s)://` URLs, or `data:image/(png|jpeg|jpg|webp);base64,...` up to 100,000 chars.
7. **Subscription & Account PII Isolation**: `/subscriptions/{businessId}` (containing `ownerEmail`, `plan`, `status`, `billingCycle`, `renewalDate`, `notes`) is strictly admin-only (`get`, `list`, `create`, `update`, `delete` require `isAdmin()`) and enforces `exists(/businesses/{businessId})`.

## 2. "Dirty Dozen" Adversarial Payloads (Must Return PERMISSION_DENIED)
1. **Shadow Field Injection on Business Create**: `{ name: "Cafe", ..., isVerified: true }` -> Blocked by `keys().hasOnly(...)`.
2. **Unverified Email Admin Spoof**: `auth.token.email == "yashshinge111@gmail.com"` with `email_verified: false` -> Blocked by `email_verified == true`.
3. **Self-Assigned Admin Escalation**: Non-admin authenticated user writing `/admins/{ownUid}` -> Blocked by `isAdmin()`.
4. **Public List of Disabled Businesses**: Unauthenticated `getDocs(collection(db, 'businesses'))` without `where('enabled', '==', true)` -> Blocked by `allow list: if resource.data.enabled == true || isAdmin();`.
5. **Public Read of Usage Logs (Analytics Scraping)**: Unauthenticated or non-admin user reading `/usageLogs` -> Blocked by `allow read: if isAdmin();`.
6. **Usage Log Spoof for Disabled/Non-Existent Business**: Creating `/usageLogs/{id}` referencing an invalid or disabled `businessId` -> Blocked by `exists()` and `get().data.enabled == true`.
7. **Forged Timestamp on Create/Update**: Supplying past/future `createdAt` or `updatedAt` (`!= request.time`) -> Blocked by `incoming().createdAt == request.time`.
8. **Immutable Field Mutation**: Admin or user modifying `createdAt` or `createdBy` during business update -> Blocked by `incoming().createdAt == existing().createdAt && incoming().createdBy == existing().createdBy`.
9. **XSS / Invalid Google Review URL**: Setting `googleReviewUrl: "javascript:alert(1)"` -> Blocked by `matches('^https?://.+')`.
10. **ID Poisoning**: Creating document with 500-char ID or special characters `../admin` -> Blocked by `isValidId(id)`.
11. **Invalid Language Enum in UsageLog**: `{ language: "Spanish", ... }` -> Blocked by `data.language in ['English', 'Hindi', 'Marathi']`.
12. **UsageLog Mutation / Tampering**: Attempting to `update` an existing `/usageLogs/{id}` document -> Blocked by `allow update: if false;`.
