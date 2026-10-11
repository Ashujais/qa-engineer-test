# Bug Fixes — EU Pay QA Engineer Assessment

This document details the code-level fixes implemented for all bugs in the EU Pay API, matching the format required by the technical assignment.

---

## Fix 1: Payment Amount Data Type (Bug A)

**Bug:** Amount returned as string instead of number in payment list and detail endpoints.

**Files Changed:**
- `src/routes/payment.routes.js` (lines 14-16, 52)

**Code Changes:**
```diff
--- a/src/routes/payment.routes.js
+++ b/src/routes/payment.routes.js
@@ -13,7 +13,7 @@ router.get('/', authenticate, (req, res) => {
-    // BUG A: Amount is being converted to string instead of remaining as number
+    // Fix Bug A: Maintain numeric type for amount
     const formattedPayments = payments.map(p => ({
       id: p.id,
-      amount: p.amount.toString(), // ← BUG: Should be number, not string
+      amount: typeof p.amount === 'number' ? p.amount : parseFloat(p.amount),
       currency: p.currency,
@@ -49,7 +49,7 @@ router.get('/:id', authenticate, (req, res) => {
       data: {
         id: payment.id,
-        amount: payment.amount.toString(), // Same bug as above
+        amount: typeof payment.amount === 'number' ? payment.amount : parseFloat(payment.amount), // Fix Bug A
         currency: payment.currency,
```

**Why This Fix:**
Frontend JavaScript/Flutter calculations require numeric types. Returning strings causes string concatenation errors (e.g., `"25.5" + 5 = "25.55"`), `NaN` calculations, and schema type errors in mobile and web clients. Preserving numeric floats ensures precision and seamless downstream arithmetic.

**Testing:**
```bash
curl -H "Authorization: Bearer <TOKEN>" http://localhost:3000/api/payments/1
# Response: amount is now numeric type (25.5), verified via typeof data.amount === 'number'
npm test -- -t "Bug A"
```

---

## Fix 2: Maximum Payment Amount Limit (Bug B)

**Bug:** Missing maximum amount check allows unrealistic transaction amounts (e.g. €999,999,999).

**Files Changed:**
- `src/routes/payment.routes.js` (lines 75-78)

**Code Changes:**
```diff
--- a/src/routes/payment.routes.js
+++ b/src/routes/payment.routes.js
@@ -72,6 +72,10 @@ router.post('/', authenticate, (req, res) => {
       return res.status(400).json({ error: 'Valid amount is required' });
     }
 
+    // Fix Bug B: Maximum amount validation (e.g., max €50,000 per transaction)
+    const MAX_AMOUNT = 50000;
+    if (amount > 50000) {
+      return res.status(400).json({ error: `Amount exceeds maximum allowed limit (${MAX_AMOUNT.toLocaleString()} EUR)` });
+    }
```

**Why This Fix:**
Production payment gateways enforce hard limits to comply with EU Anti-Money Laundering (AML) directives, mitigate fraud risks, and avoid gateway transaction rejections. The €50,000 threshold enforces realistic transaction caps while allowing legitimate retail commerce.

**Testing:**
```bash
curl -X POST http://localhost:3000/api/payments \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"amount":999999999,"currency":"EUR","customer_email":"buyer@example.com"}'
# Response: HTTP 400 Bad Request with error stating maximum limit exceeded
```

---

## Fix 3: Strict Email Validation with Domain and TLD (Bug C)

**Bug:** Email validation regex allowed addresses without top-level domain (e.g. `user@domain`).

**Files Changed:**
- `src/routes/auth.routes.js` (lines 10-14)

**Code Changes:**
```diff
--- a/src/routes/auth.routes.js
+++ b/src/routes/auth.routes.js
@@ -9,5 +9,5 @@ const router = express.Router();
-// BUG C: Email validation is too permissive
-function validateEmail(email) {
-  // BUG: This regex allows emails without TLD like "user@domain"
-  const emailRegex = /^[^\s@]+@[^\s@]+$/;
-  return emailRegex.test(email);
-}
+// Fix Bug C: Require valid domain and top-level domain (TLD)
+export function validateEmail(email) {
+  const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;
+  return emailRegex.test(email);
+}
```

**Why This Fix:**
The original regex `/^[^\s@]+@[^\s@]+$/` permitted incomplete email strings missing a dot and TLD. Enforcing `\.[a-zA-Z]{2,}$` ensures that email addresses conform to standard domain naming structures, preventing invalid merchant accounts and failed transactional communications.

**Testing:**
```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@domain","password":"Password123!","business_name":"Test Co"}'
# Response: HTTP 400 Bad Request {"error":"Invalid email format"}
```

---

## Fix 4: Webhook Signature Verification (Bug D)

**Bug:** Payment webhook accepted unsigned and spoofed payloads without cryptographic HMAC-SHA256 verification.

**Files Changed:**
- `src/routes/webhook.routes.js` (lines 8, 21-33)

**Code Changes:**
```diff
--- a/src/routes/webhook.routes.js
+++ b/src/routes/webhook.routes.js
@@ -8,3 +8,3 @@
-const WEBHOOK_SECRET = 'test-webhook-secret-key';
+const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret-key';
@@ -21,12 +21,16 @@ router.post('/payment-status', (req, res) => {
-    // BUG D: No signature verification
-    // Real systems MUST verify webhook signatures to prevent spoofing
-    // Missing validation below:
-    
-    // const expectedSignature = crypto
-    //   .createHmac('sha256', WEBHOOK_SECRET)
-    //   .update(JSON.stringify(req.body))
-    //   .digest('hex');
-    // 
-    // if (signature !== expectedSignature) {
-    //   return res.status(401).json({ error: 'Invalid signature' });
-    // }
+    // Fix Bug D: Webhook signature verification to prevent spoofing
+    if (!signature) {
+      return res.status(401).json({ error: 'Webhook signature required' });
+    }
+
+    const expectedSignature = crypto
+      .createHmac('sha256', WEBHOOK_SECRET)
+      .update(JSON.stringify(req.body))
+      .digest('hex');
+
+    if (signature !== expectedSignature) {
+      return res.status(401).json({ error: 'Invalid signature' });
+    }
```

**Why This Fix:**
Without signature verification, an attacker can forge payment status webhooks and mark pending payments as completed without sending real funds. Verifying `x-webhook-signature` using HMAC-SHA256 guarantees authenticity and payload integrity.

**Testing:**
```bash
curl -X POST http://localhost:3000/api/webhooks/payment-status \
  -H "Content-Type: application/json" \
  -H "x-webhook-signature: fake-sig" \
  -d '{"payment_id":"2","status":"completed","event_id":"evt_1"}'
# Response: HTTP 401 Unauthorized {"error":"Invalid signature"}
```

---

## Fix 5: Webhook Idempotency & Replay Protection (Bug E)

**Bug:** Re-delivering a webhook re-processed the event and updated payment timestamps repeatedly.

**Files Changed:**
- `src/routes/webhook.routes.js` (lines 38-44, 55-57)

**Code Changes:**
```diff
--- a/src/routes/webhook.routes.js
+++ b/src/routes/webhook.routes.js
@@ -38,7 +38,5 @@ router.post('/payment-status', (req, res) => {
-    // BUG E: No idempotency check
-    // Webhooks can be delivered multiple times - must be idempotent
-    // Missing check below:
-    
-    // if (db.processed_webhooks.includes(event_id)) {
-    //   return res.status(200).json({ message: 'Already processed' });
-    // }
+    // Fix Bug E: Webhook idempotency check to prevent duplicate processing
+    if (event_id && db.processed_webhooks.includes(event_id)) {
+      return res.status(200).json({ message: 'Already processed' });
+    }
@@ -55,3 +53,4 @@ router.post('/payment-status', (req, res) => {
-    // Mark webhook as processed (if idempotency was implemented)
-    // db.processed_webhooks.push(event_id);
+    // Mark webhook as processed for idempotency
+    if (event_id) {
+      db.processed_webhooks.push(event_id);
+    }
```

**Why This Fix:**
Payment providers frequently retry webhook events upon network delays or timeouts. Idempotency guarantees that identical `event_id` deliveries do not trigger duplicate state transitions, double fulfillment, or race conditions.

**Testing:**
```bash
# First request with valid signature -> 200 OK {"message":"Webhook processed"}
# Second request with same event_id -> 200 OK {"message":"Already processed"}
```

---

## Fix 6: Table Order Duplicate Prevention (Bug F)

**Bug:** Tables could place multiple orders while an existing order was already in `pending` status.

**Files Changed:**
- `src/routes/table-order.routes.js` (lines 44-56, 76-78, 120-125)

**Code Changes:**
```diff
--- a/src/routes/table-order.routes.js
+++ b/src/routes/table-order.routes.js
@@ -44,13 +44,10 @@ router.post('/', (req, res) => {
-    // BUG F: No duplicate order prevention
-    // Should check if table already has a pending order
-    // Missing validation below:
-    
-    // const existingOrder = (db.table_orders || []).find(
-    //   o => o.merchant_id === merchant_id && 
-    //        o.table_number === table_number && 
-    //        o.status === 'pending'
-    // );
-    // if (existingOrder) {
-    //   return res.status(409).json({ error: 'Table already has a pending order' });
-    // }
+    // Fix Bug F: Prevent duplicate pending table order
+    const existingOrder = (db.table_orders || []).find(
+      o => o.merchant_id === merchant_id && 
+           o.table_number === table_number && 
+           o.status === 'pending'
+    );
+    if (existingOrder) {
+      return res.status(409).json({ error: 'Table already has a pending order' });
+    }
@@ -76,3 +73,5 @@ router.post('/', (req, res) => {
-    // Emit socket event (would be handled by socket.io)
-    // io.to(`merchant_${merchant_id}`).emit('new_order', newOrder);
+    // Emit socket event for real-time order notification
+    const io = req.app.get('io');
+    if (io) {
+      io.to(`merchant_${merchant_id}`).emit('new_order', newOrder);
+    }
```

**Why This Fix:**
In dining establishments, duplicate submissions create accidental duplicate orders in the kitchen. Enforcing single active pending orders per table prevents food waste and billing errors. In addition, wiring up `req.app.get('io')` enables real-time kitchen tablet order updates.

**Testing:**
```bash
# Order 1 on table 5 -> 201 Created
# Order 2 on table 5 while pending -> 409 Conflict {"error":"Table already has a pending order"}
```

---

## Fix 7: E-Invoice Duplicate Submission Prevention (Bug G)

**Bug:** Allowed resubmitting the same invoice to the tax authority multiple times.

**Files Changed:**
- `src/routes/einvoice.routes.js` (lines 50-58)

**Code Changes:**
```diff
--- a/src/routes/einvoice.routes.js
+++ b/src/routes/einvoice.routes.js
@@ -50,9 +50,6 @@ router.post('/submit', authenticate, async (req, res) => {
-    // BUG G: No duplicate submission check
-    // Should prevent submitting the same invoice twice
-    // Missing validation below:
-    
-    // if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
-    //   return res.status(409).json({ 
-    //     error: 'Invoice already submitted to tax authority' 
-    //   });
-    // }
+    // Fix Bug G: Prevent duplicate invoice submission to tax authority
+    if (invoice.einvoice_status === 'submitted' || invoice.einvoice_status === 'accepted') {
+      return res.status(409).json({ 
+        error: 'Invoice already submitted to tax authority' 
+      });
+    }
```

**Why This Fix:**
European electronic invoicing frameworks (e.g., French Seqino PDP, Factur-X) mandate that an invoice is submitted once. Duplicate submissions cause regulatory rejection, audit penalties, and duplicate tax reporting.

**Testing:**
```bash
# Submit invoice inv_100 -> 200 OK {"status":"submitted"}
# Re-submit invoice inv_100 -> 409 Conflict {"error":"Invoice already submitted to tax authority"}
```

---

## Additional Improvement: Seeded Merchant Password Fix & Database Isolation

**Bug:** The seeded merchant record in `src/db/database.js` had an invalid bcrypt hash that failed authentication for the documented password `'Test123!'`.

**Files Changed:**
- `src/db/database.js` (lines 19, 87-95)

**Code Changes:**
```diff
--- a/src/db/database.js
+++ b/src/db/database.js
@@ -19,1 +19,1 @@
-    password: "$2a$10$8Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9Z3KxGXvGqJQZ.ZF9", // password: Test123!
+    password: "$2a$10$bT./GnGTJkbBbZNpVaAel.bnPiTdm8fids8jg8jtnF6hSj3gkY8Ru", // password: Test123!
@@ -87,0 +87,8 @@
+// Helper to reset database for tests
+export function resetDatabase() {
+  db.users = [];
+  db.payments = [];
+  db.sessions = [];
+  db.table_orders = [];
+  db.invoices = [];
+  db.processed_webhooks = [];
+  initDatabase();
+}
```

**Why This Fix:**
Enables out-of-the-box authentication for `merchant@test.com` with `Test123!` exactly as documented in the README, and provides clean test isolation across test suites.
