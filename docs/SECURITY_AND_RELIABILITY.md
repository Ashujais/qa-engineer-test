# EU Pay — Security and Reliability Assessment

This document provides a comprehensive security and reliability analysis of the European Pay payment API, detailing existing security controls, confirmed defects, implemented fixes, and production-readiness recommendations.

---

## 1. Authentication & JWT Authorization

### Existing Controls
- JSON Web Token (JWT) based authentication using `jsonwebtoken` library.
- Protected routes require `Authorization: Bearer <token>` header verified by `src/middleware/auth.middleware.js`.
- Merchant identity (`req.user = { id, email, type }`) attached to request context for downstream route handlers.

### Confirmed Defects & Fixes
- **Confirmed Defect (BUG-C):** In `src/routes/auth.routes.js`, the email validation regular expression `/^[^\s@]+@[^\s@]+$/` accepted addresses without top-level domains (e.g. `user@domain`).
  - *Fix:* Replaced with `/^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/`, enforcing standard domain and TLD formats.
- **Seeded Credential Defect (BUG-H):** In `src/db/database.js`, the pre-seeded merchant password was a repeating dummy string rather than a valid bcrypt hash for `'Test123!'`.
  - *Fix:* Replaced with a valid bcrypt hash (`$2a$10$bT./GnGTJkbBbZNpVaAel.bnPiTdm8fids8jg8jtnF6hSj3gkY8Ru`).

### Verified Security Controls
- **Token Tampering / Forgery:** Tests verify that tokens with invalid signatures, altered claims, or signed with unauthorized keys return HTTP 401 Unauthorized.
- **Token Expiration:** Expired tokens are rejected with `{"error": "Token expired"}`.
- **Deleted Account Handling:** If a token contains a user ID that no longer exists in the database, the request is rejected with `{"error": "User not found"}`.

### Future Recommendations
- Implement token refresh rotation using short-lived access tokens (15 minutes) and revocable refresh tokens stored in Redis.
- Explicitly enforce algorithm whitelisting (`algorithms: ['HS256']`) during `jwt.verify` to mitigate algorithm-confusion attacks.

---

## 2. Secrets Management

### Existing Controls & Fixes
- Fallback secrets were hardcoded in source files (`test-secret-key-do-not-use-in-production`, `test-webhook-secret-key`).
- *Fix Implemented:* Updated `auth.middleware.js`, `auth.routes.js`, and `webhook.routes.js` to prioritize environment variables (`process.env.JWT_SECRET`, `process.env.WEBHOOK_SECRET`) with safe non-production defaults.
- Created `.env.example` documenting configuration keys without exposing production secrets.
- Verified that `.gitignore` excludes `.env`, private keys, and credential stores.

### Future Recommendations
- In production deployment (AWS ECS), inject secrets directly via AWS Secrets Manager or AWS Systems Manager Parameter Store.
- Implement automated secret scanning in CI/CD (e.g. GitGuardian or Trufflehog).

---

## 3. Webhook Signature Verification & Cryptographic Integrity

### Confirmed Defect (BUG-D)
- In `src/routes/webhook.routes.js`, signature verification was commented out. Unauthenticated external callers could invoke `POST /api/webhooks/payment-status` and mark pending payments as `completed`.

### Fix Implemented
- Enforced cryptographic verification of the `x-webhook-signature` header using HMAC-SHA256:
```javascript
const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```
- Missing signature header immediately terminates with HTTP 401 Unauthorized.

### Future Recommendations
- In production with live payment gateways (Powens / Stripe), compute the HMAC signature over the raw request payload buffer (`req.rawBody`) rather than `JSON.stringify(req.body)` to eliminate JSON key serialization discrepancies.
- Employ `crypto.timingSafeEqual()` over binary buffers to defend against timing attacks.

---

## 4. Idempotency & Duplicate Request Protection

### Webhook Idempotency (BUG-E)
- **Defect:** Duplicate webhook deliveries re-mutated payment timestamps and re-triggered updates.
- **Fix:** Added deduplication logic storing and checking `event_id` in `db.processed_webhooks`. Repeated submissions return HTTP 200 OK with `{"message": "Already processed"}`.

### Table Order Idempotency (BUG-F)
- **Defect:** Dining tables could place simultaneous duplicate orders while a previous order was `pending`.
- **Fix:** Validated that no pending order exists for `merchant_id` + `table_number` prior to accepting a new order (returns HTTP 409 Conflict if pending).

### E-Invoice Idempotency (BUG-G)
- **Defect:** E-invoices could be resubmitted multiple times, generating duplicate tax submissions.
- **Fix:** Guarded against resubmission if status is already `'submitted'` or `'accepted'` (returns HTTP 409 Conflict).

### Future Recommendations
- Implement client-driven idempotency keys on payment creation (`Idempotency-Key` header stored in Redis with 24-hour TTL) to prevent double billing from network retries.

---

## 5. Payment Transaction Consistency & Boundary Enforcement

### Transaction Limit Validation (BUG-B)
- **Defect:** Missing maximum transaction check allowed €999,999,999 transactions.
- **Fix:** Enforced strict ceiling at €50,000 per transaction, returning HTTP 400 Bad Request with `"Amount exceeds maximum allowed limit (50,000 EUR)"`.
- **Boundaries Tested:** Negative amounts (`-50`), zero amounts (`0`), non-numeric amounts (`NaN`), and exact boundary values (`50000.00` vs `50000.01`).

### Data Type Consistency (BUG-A)
- **Defect:** Amounts were converted to string on retrieval.
- **Fix:** Preserved floating point numeric values across all payment queries.

### Multi-Tenant Resource Authorization
- **Controls Tested:** Verified that merchant A cannot read payment records, table orders, or invoice statuses belonging to merchant B (enforces HTTP 403 Forbidden).

---

## 6. Real-Time Socket.IO Security

### Existing Controls & Fixes
- Socket.IO server configured with CORS origin restrictions.
- Merchant and table rooms isolate real-time event broadcasts:
  - `join_merchant(merchantId)` -> joins `merchant_${merchantId}` room.
  - `join_table(tableNumber)` -> joins `table_${tableNumber}` room.
- *Fix Implemented:* Wired up Express routes to retrieve `io` via `req.app.get('io')` and emit events only to authorized scoped rooms (`merchant_${merchant_id}` for `new_order`, `table_${table_number}` for `order_status_changed`).

### Future Recommendations
- Implement Socket.IO handshake authentication middleware validating JWT tokens before allowing socket connections or room joins.

---

## 7. Sensitive Data Logging & Error Handling

### Existing Controls & Fixes
- Express error handler catches unexpected exceptions:
  `res.status(500).json({ error: "Something went wrong!" })`
  preventing stack traces or server paths from leaking to API clients.
- Passwords are never returned in user payloads upon registration or login.
- Password hashes use `bcryptjs` with salt round 10.

### Verified Best Practices
- No live financial credentials, production cards, or API keys are committed or logged.
- Webhook signature secrets and JWT secrets are isolated from client-facing output.
