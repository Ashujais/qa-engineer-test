# Bug Reports — EU Pay QA Engineer Assessment

This document contains detailed bug reports for all 7 intentional bugs discovered in the EU Pay API, matching the exact format specified in the assessment requirements.

---

## Bug A: Payment Amount Data Type Returned as String

**Location:** `src/routes/payment.routes.js` (lines 16, 52)  
**Severity:** Medium  
**Component:** Payment API  

### How to Reproduce:
1. Start server: `npm start`
2. Login: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`
3. Send request: `GET /api/payments` with JWT token in `Authorization: Bearer <token>`
4. Observe `data[0].amount` in the response payload.
5. Send request: `GET /api/payments/1` with JWT token.
6. Observe `data.amount` in the response payload.

### Expected Behavior:
The `amount` field should be returned as a numeric type (`number`), matching the numeric data stored in the database (e.g. `25.5` and `100.0`).

### Actual Behavior:
The `amount` field is returned as a string (`"25.5"` and `"100"`), with `typeof amount === "string"`.

### Impact:
Frontend applications (Flutter mobile app, Next.js web dashboard) performing arithmetic calculations receive string values instead of numbers. This causes incorrect string concatenation (e.g. `"25.5" + 5 = "25.55"`), `NaN` errors, and strict schema validation failures.

### Root Cause:
In `src/routes/payment.routes.js`:
- Line 16: `amount: p.amount.toString()`
- Line 52: `amount: payment.amount.toString()`
The code explicitly converts numeric payment amounts to strings during JSON response formatting.

### Suggested Fix:
Remove `.toString()` and maintain numeric representation:
```javascript
amount: typeof p.amount === 'number' ? p.amount : parseFloat(p.amount)
```

---

## Bug B: Missing Maximum Transaction Limit Validation

**Location:** `src/routes/payment.routes.js` (line 75)  
**Severity:** High  
**Component:** Payment API  

### How to Reproduce:
1. Start server: `npm start`
2. Login: `POST /api/auth/login` with `{"email":"merchant@test.com","password":"Test123!"}`
3. Send request: `POST /api/payments` with `Authorization: Bearer <token>` and body:
```json
{
  "amount": 999999999,
  "currency": "EUR",
  "customer_email": "customer@example.com"
}
```
4. Observe the response status code and data.

### Expected Behavior:
Transactions exceeding the business transaction limit (e.g. €50,000) should be rejected with HTTP 400 Bad Request and an informative error message containing `"maximum"`.

### Actual Behavior:
The API accepts €999,999,999 without restriction, responding with HTTP 201 Created and creating a pending payment.

### Impact:
Uncapped payment sizes expose merchants and EU Pay to financial fraud, compliance violations under EU Anti-Money Laundering (AML) directives, and potential payment gateway chargeback liabilities.

### Root Cause:
In `src/routes/payment.routes.js`, lines 75-78, the maximum limit check was noted as a comment (`// Missing: if (amount > 50000) { return 400 }`) but never implemented in executable code.

### Suggested Fix:
Add maximum threshold validation before transaction creation:
```javascript
const MAX_AMOUNT = 50000;
if (amount > 50000) {
  return res.status(400).json({ error: `Amount exceeds maximum allowed limit (${MAX_AMOUNT.toLocaleString()} EUR)` });
}
```

---

## Bug C: Email Validation Regex Allows Addresses Without TLD

**Location:** `src/routes/auth.routes.js` (line 12)  
**Severity:** Medium  
**Component:** Auth API  

### How to Reproduce:
1. Start server: `npm start`
2. Send request: `POST /api/auth/register` with body:
```json
{
  "email": "user@domain",
  "password": "Password123!",
  "business_name": "Test Merchant"
}
```
3. Observe the response status code and user record.

### Expected Behavior:
The API should reject email addresses that lack a top-level domain (TLD) with HTTP 400 Bad Request and `{"error": "Invalid email format"}`.

### Actual Behavior:
The API accepts `user@domain`, returns HTTP 201 Created, and registers the account.

### Impact:
Invalid and uncontactable email addresses enter the system, causing failed notification deliveries, broken password reset workflows, and database hygiene issues.

### Root Cause:
In `src/routes/auth.routes.js`, lines 10-14:
```javascript
const emailRegex = /^[^\s@]+@[^\s@]+$/;
```
The regular expression only checks for the presence of `@` surrounded by non-whitespace characters, without requiring a dot (`.`) and valid top-level domain.

### Suggested Fix:
Update the validation regex to enforce a domain dot and minimum 2-character TLD:
```javascript
export function validateEmail(email) {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
  return emailRegex.test(email);
}
```

---

## Bug D: Missing Webhook Signature Verification

**Location:** `src/routes/webhook.routes.js` (lines 21-33)  
**Severity:** Critical  
**Component:** Webhooks  

### How to Reproduce:
1. Start server: `npm start`
2. Send request: `POST /api/webhooks/payment-status` with a fake signature or no signature:
```bash
curl -X POST http://localhost:3000/api/webhooks/payment-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: fake-signature" \
  -d '{"payment_id":"2","status":"completed","event_id":"evt_123"}'
```
3. Observe the response status code and check payment status in database.

### Expected Behavior:
The API should cryptographically verify the signature header against the shared secret (`WEBHOOK_SECRET`) using HMAC-SHA256 and reject invalid or missing signatures with HTTP 401 Unauthorized.

### Actual Behavior:
The API ignores the signature, returns HTTP 200 OK (`"Webhook processed"`), and updates payment status to `"completed"`.

### Impact:
Critical security flaw allowing unauthorized third parties to spoof payment confirmations, marking unpaid transactions as completed without authentic funds being transferred.

### Root Cause:
In `src/routes/webhook.routes.js`, the signature verification block was commented out, bypassing validation entirely.

### Suggested Fix:
Enforce HMAC-SHA256 signature verification on the incoming request body:
```javascript
if (!signature) {
  return res.status(401).json({ error: 'Webhook signature required' });
}
const expectedSignature = crypto
  .createHmac('sha256', WEBHOOK_SECRET)
  .update(JSON.stringify(req.body))
  .digest('hex');

if (signature !== expectedSignature) {
  return res.status(401).json({ error: 'Invalid signature' });
}
```

---

## Bug E: Missing Webhook Idempotency Check

**Location:** `src/routes/webhook.routes.js` (lines 38-44, 56)  
**Severity:** High  
**Component:** Webhooks  

### How to Reproduce:
1. Start server: `npm start`
2. Send a valid signed webhook: `POST /api/webhooks/payment-status` with `event_id: "evt_101"`.
3. First request returns HTTP 200 OK (`"Webhook processed"`).
4. Send the exact same request again with `event_id: "evt_101"`.
5. Observe the response and payment modification timestamp.

### Expected Behavior:
The API should recognize previously processed `event_id`s, return HTTP 200 OK with `{"message": "Already processed"}`, and avoid duplicate processing or re-mutating timestamps.

### Actual Behavior:
The API re-processes the webhook on every submission, returning `"Webhook processed"` and re-writing the payment timestamp.

### Impact:
Payment gateways (e.g. Powens, Stripe) retry webhooks upon transient network timeouts. Lack of idempotency causes duplicate status transitions, inaccurate event logs, duplicate stock deductions, and race conditions.

### Root Cause:
In `src/routes/webhook.routes.js`, the idempotency lookup `db.processed_webhooks.includes(event_id)` and storage call `db.processed_webhooks.push(event_id)` were commented out.

### Suggested Fix:
Check and store `event_id` in `db.processed_webhooks`:
```javascript
if (event_id && db.processed_webhooks.includes(event_id)) {
  return res.status(200).json({ message: 'Already processed' });
}
...
if (event_id) {
  db.processed_webhooks.push(event_id);
}
```

---

## Bug F: Missing Duplicate Table Order Prevention

**Location:** `src/routes/table-order.routes.js` (lines 44-56)  
**Severity:** Medium  
**Component:** Table Orders  

### How to Reproduce:
1. Start server: `npm start`
2. Place an order on table 5: `POST /api/table-orders` with `table_number: 5`.
3. First request returns HTTP 201 Created with `status: "pending"`.
4. Immediately submit a second order for table 5 while the first order is still pending.

### Expected Behavior:
The API should reject placing a new order on a table that already has an active `pending` order, returning HTTP 409 Conflict with `{"error": "Table already has a pending order"}`.

### Actual Behavior:
The API accepts the second order, creating multiple pending orders for the same table.

### Impact:
Restaurant diners scanning table QR codes may accidentally submit multiple orders by double-clicking or ordering simultaneously, creating duplicate kitchen tickets, food waste, and customer dissatisfaction.

### Root Cause:
In `src/routes/table-order.routes.js`, the check searching for existing orders with status `'pending'` for the table was commented out.

### Suggested Fix:
Check for active pending orders before saving new orders:
```javascript
const existingOrder = (db.table_orders || []).find(
  o => o.merchant_id === merchant_id && 
       o.table_number === table_number && 
       o.status === 'pending'
);
if (existingOrder) {
  return res.status(409).json({ error: 'Table already has a pending order' });
}
```

---

## Bug G: Missing Duplicate E-Invoice Submission Check

**Location:** `src/routes/einvoice.routes.js` (lines 50-58)  
**Severity:** Medium  
**Component:** E-Invoice  

### How to Reproduce:
1. Start server: `npm start`
2. Login to get JWT token.
3. Submit an invoice: `POST /api/einvoice/submit` with `{"invoice_id": "inv_99", "customer_siret": "12345678901234"}`.
4. First request returns HTTP 200 OK (`status: "submitted"`).
5. Resubmit the same invoice ID: `POST /api/einvoice/submit` with `invoice_id: "inv_99"`.

### Expected Behavior:
The API should prevent re-submitting an invoice that has already been submitted or accepted, returning HTTP 409 Conflict with `{"error": "Invoice already submitted to tax authority"}`.

### Actual Behavior:
The API accepts duplicate submissions, generates a new `submission_id`, and overwrites the submission timestamp.

### Impact:
E-invoicing compliance regulations (such as the French B2B mandate via Seqino PDP) prohibit duplicate tax filings for the same invoice, triggering tax authority rejections, administrative audits, and duplicate VAT liabilities.

### Root Cause:
In `src/routes/einvoice.routes.js`, the check verifying if `einvoice_status` is already `'submitted'` or `'accepted'` was commented out.

### Suggested Fix:
Check current invoice submission status before submitting:
```javascript
if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
  return res.status(409).json({ 
    error: 'Invoice already submitted to tax authority' 
  });
}
```
