# EU Pay — Test Execution & Results Report

## 1. Test Environment & Runtime Summary

- **OS:** Windows 10/11 x64
- **Runtime:** Node.js v20.18.0
- **Package Manager:** npm 10.8.2
- **Test Framework:** Node.js Built-in Test Runner (`node:test`, `node:assert`)
- **HTTP Testing Library:** `supertest` v6.3.4
- **Git Branch:** `submission/qa-engineer`
- **Execution Date:** 2026-10-11

---

## 2. Test Execution Commands & Results

### 2.1 Baseline Verification Commands (Before Fixes)

#### Command 1: Bug Verification Script
```bash
npm run verify-bugs
```
**Outcome:** Exit Code 0  
**Summary:** 7/7 intentional bugs detected in starter repository.

#### Command 2: Baseline Test Suite
```bash
npm test
```
**Outcome:** Exit Code 1  
**Error:** `Could not find 'F:\Dots_QA\src\**\*.test.js'`  
**Reason:** Unquoted shell wildcard glob in `package.json` failed on Windows `cmd.exe`.

---

### 2.2 Final Verification Commands (After Fixes)

#### Command 1: Full Automated Test Suite
```bash
npm test
```
**Outcome:** Exit Code 0 (PASS)  
**Total Tests:** 61  
**Passed:** 61  
**Failed:** 0  
**Skipped:** 0  
**Duration:** ~11.6 seconds  

#### Breakdown by Test Suite:
1. `src/routes/__tests__/auth.routes.test.js`: 15 passed, 0 failed
   - Bug C unit tests (reject email missing TLD, accept valid emails)
   - Registration validation (valid, duplicate, short password, missing business name)
   - Login authentication (valid merchant, wrong password, non-existent email)
   - JWT security (missing token, malformed scheme, tampered token, expired token, deleted user)
2. `src/routes/__tests__/payment.routes.test.js`: 12 passed, 0 failed
   - Bug A regression (GET payments returns numeric amount)
   - Bug B regression (rejects > €50,000 with "maximum" error)
   - Boundary tests (€50,000 accepted, €50,000.01 rejected)
   - Currency validations (EUR, USD, GBP accepted; BTC rejected)
   - Amount validations (negative amount rejected, zero amount rejected, NaN rejected)
   - Multi-tenant isolation (403 when accessing another merchant's payment)
3. `src/routes/__tests__/webhook.routes.test.js`: 10 passed, 0 failed
   - Bug D regression (reject missing signature, reject forged signature, accept valid HMAC-SHA256 signature)
   - Bug E regression (idempotency: duplicate event_id returns "Already processed")
   - Webhook validations (missing fields 400, non-existent payment 404)
   - E-invoice status webhooks (accepted status, tax authority ID update, 404 handling)
4. `src/routes/__tests__/table-order.routes.test.js`: 11 passed, 0 failed
   - Bug F regression (reject duplicate order when table has pending order)
   - State progression (allow new order after previous order moves past pending)
   - Input validations (missing fields 400, empty items 400)
   - Order list and status progression (confirmed, preparing, ready, served, cancelled)
   - Access control (403 for unauthorized merchant)
5. `src/routes/__tests__/einvoice.routes.test.js`: 10 passed, 0 failed
   - Bug G regression (reject duplicate submission for submitted invoice)
   - Bug G regression (reject submission for accepted invoice)
   - French SIRET validation (enforce exact 14 digits)
   - Ownership and status queries (200 for owner, 403 for other merchant, 404 for non-existent)
6. `src/routes/__tests__/socket.routes.test.js`: 3 passed, 0 failed
   - Server instance attachment (`app.get('io')`)
   - Real-time `new_order` event emission to merchant room
   - Real-time `order_status_changed` event emission to table room

---

### 2.3 Bug Fix Verification Script
```bash
npm run verify-fixes
```
**Outcome:** Exit Code 0 (PASS)  
**Output:**
```text
🔍 Verifying all 7 bug fixes in the codebase...

✅ Fix A verified: Numeric amount maintained in payment.routes.js
✅ Fix B verified: Maximum transaction limit (€50,000) enforced
✅ Fix C verified: Email validation strictly requires domain and TLD
✅ Fix D verified: Webhook HMAC-SHA256 signature verification enabled
✅ Fix E verified: Webhook idempotency tracking enabled
✅ Fix F verified: Table order duplicate prevention enabled
✅ Fix G verified: E-invoice duplicate submission prevention enabled

📊 Fixes verified: 7/7

🎉 All 7 intentional bugs have been successfully fixed and verified!
```

---

### 2.4 Code Coverage Report
Command executed:
```bash
npm run test:coverage
```
**Measured Coverage Table:**

| File | Line % | Branch % | Functions % | Uncovered Lines |
|---|---|---|---|---|
| `src/db/database.js` | 100.00% | 100.00% | 100.00% | None |
| `src/middleware/auth.middleware.js` | 100.00% | 100.00% | 100.00% | None |
| `src/routes/auth.routes.js` | 94.78% | 88.89% | 100.00% | 67-69, 110-112 (Catch blocks) |
| `src/routes/einvoice.routes.js` | 94.87% | 81.82% | 100.00% | 77-79, 112-114 (Catch blocks) |
| `src/routes/payment.routes.js` | 92.11% | 79.17% | 100.00% | 29-31, 60-62, 109-111 (Catch blocks) |
| `src/routes/table-order.routes.js` | 93.62% | 77.42% | 100.00% | 23-25, 85-87, 136-138 (Catch blocks) |
| `src/routes/webhook.routes.js` | 94.39% | 90.00% | 100.00% | 65-67, 102-104 (Catch blocks) |
| `src/server.js` | 52.89% | 50.00% | 0.00% | Standalone socket listeners |
| **All Test Suites (`__tests__/*`)** | 100.00% | 100.00% | 100.00% | None |
| **TOTAL (All Files)** | **95.49%** | **91.50%** | **96.43%** | — |

*The measured business logic line coverage (95.49%) and branch coverage (91.50%) exceed the 80% assignment benchmark.*

---

## 3. Manual Exploratory Testing Summary

| Test Area | Scenario | Method | Result | Notes |
|---|---|---|---|---|
| API Health | Query API Root | GET `/` | PASS | Status 200 OK, returns catalog of 12 endpoints |
| Auth | Register Merchant | POST `/api/auth/register` | PASS | Status 201 Created, returns JWT token |
| Auth | Login Documented Credentials | POST `/api/auth/login` | PASS | Status 200 OK with `merchant@test.com` / `Test123!` |
| Payments | Query Seeded Payments | GET `/api/payments` | PASS | Status 200 OK, returns 2 payments with numeric amounts |
| Payments | Query Single Payment | GET `/api/payments/1` | PASS | Status 200 OK, amount is `25.5` (number) |
| Payments | Create Payment Limit | POST `/api/payments` | PASS | Amount `50000` -> 201, `50001` -> 400 |
| Webhook | Sign with HMAC-SHA256 | POST `/api/webhooks/payment-status` | PASS | Valid signature -> 200 OK |
| Webhook | Forged Signature Spoofing | POST `/api/webhooks/payment-status` | PASS | Forged signature -> 401 Unauthorized |
| Webhook | Replay Same Event ID | POST `/api/webhooks/payment-status` | PASS | Replay -> 200 OK `{"message":"Already processed"}` |
| Table Orders | Sequential Orders | POST `/api/table-orders` | PASS | Order 1 -> 201, Immediate duplicate -> 409 Conflict |
| E-Invoice | French SIRET Format | POST `/api/einvoice/submit` | PASS | 14 digits -> 200, 9 digits -> 400 |
| E-Invoice | Duplicate Filing | POST `/api/einvoice/submit` | PASS | Second submission -> 409 Conflict |

---

## 4. Known Limitations & Untested Areas

1. **In-Memory Storage Across Process Restarts:**
   The test application relies on an in-memory database (`db`). In a production deployment with multiple horizontal instances, idempotency and persistence require an external distributed data store (e.g., PostgreSQL for transactions and Redis for webhook idempotency locking).
2. **Raw Body Buffer Verification:**
   Signature verification serializes `JSON.stringify(req.body)` as designed in the assignment. In a live payment gateway integration, hashing the raw unparsed request buffer (`req.rawBody`) is recommended to guard against whitespace formatting differences from external gateways.
3. **External Network Mocking:**
   Third-party payment and PDP gateways (Powens AIS/PIS and Seqino PDP) are simulated in memory; no live external financial networks were contacted during test execution.
