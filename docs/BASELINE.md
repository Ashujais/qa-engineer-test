# EU Pay QA Engineer Assessment — Baseline Record

## 1. System & Environment Overview

- **Operating System:** Windows 10/11 (win32 x64)
- **Shell:** PowerShell 7 / Windows PowerShell
- **Node.js Version:** `v20.18.0` (Satisfies requirement of Node.js 20+)
- **npm Version:** `10.8.2`
- **Git Version:** `2.50.1.windows.1`
- **Working Directory:** `f:\Dots_QA`
- **Repository Origin:** `https://github.com/European-pay/qa-engineer-test`
- **Initial Branch:** `main` (clean working tree, commit `c896582` / HEAD)
- **Working Submission Branch:** `submission/qa-engineer`

---

## 2. Dependency Installation

Command executed:
```bash
npm install
```

### Result:
- Successfully installed 135 packages in 19s.
- Manifest dependencies:
  - `express`: `^4.18.2`
  - `cors`: `^2.8.5`
  - `bcryptjs`: `^2.4.3`
  - `jsonwebtoken`: `^9.0.2`
  - `uuid`: `^9.0.1`
  - `socket.io`: `^4.7.2`
  - `axios`: `^1.6.2`
- Dev dependencies:
  - `supertest`: `^6.3.4`

---

## 3. Baseline Verification Commands & Outcomes

### 3.1 Intentional Bug Verification (`verify-bugs.js`)
Command executed:
```bash
npm run verify-bugs
```
**Outcome:** Exit code 0.
```text
🔍 Verifying bugs are present in the codebase...

✅ Bug A found: amount.toString() in payment.routes.js
✅ Bug B found: Missing maximum amount validation
✅ Bug D found: Missing webhook signature verification
✅ Bug E found: Missing webhook idempotency check
✅ Bug F found: Missing duplicate table order prevention
✅ Bug G found: Missing duplicate e-invoice submission check
✅ Bug C found: Email validation regex too permissive

📊 Bugs found: 7/7

✅ All bugs are present! Repository is ready for candidates.
```

### 3.2 Baseline Test Suite (`npm test`)
Command executed:
```bash
npm test
```
**Outcome:** Exit code 1.
```text
> eupay-qa-test@1.0.0 test
> node --test src/**/*.test.js

Could not find 'F:\Dots_QA\src\**\*.test.js'
```
**Root Cause Analysis:**
On Windows platforms, `npm` runs scripts via `cmd.exe`. Shell wildcard glob patterns with double asterisks (`src/**/*.test.js`) are not expanded by Windows command interpreters. Node receives the literal string `src/**/*.test.js` rather than expanded file names, and fails to find the path.

When executed using Node's native test discovery:
```bash
node --test src
# or
node --test
```
**Outcome:** Exit code 0.
```text
TAP version 13
# Subtest: placeholder test - candidates should add real tests
ok 1 - placeholder test - candidates should add real tests
  ---
  duration_ms: 5.1379
  ...
# Subtest: placeholder test - candidates should add real tests
ok 2 - placeholder test - candidates should add real tests
  ---
  duration_ms: 7.6869
  ...
1..2
# tests 2
# suites 0
# pass 2
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 349.9378
```
**Fix Planned:**
Update `package.json` test script to `"test": "node --test"` (or `"node --test \"src/**/*.test.js\""`) to ensure universal cross-platform compatibility across Windows, macOS, and Linux CI runners.

### 3.3 Server Startup & Health Check
Command executed:
```bash
node src/server.js
curl http://localhost:3000
```
**Server Startup Output:**
```text
📊 Database initialized with test data
✅ EU Pay QA Test API running on http://localhost:3000
📖 Visit http://localhost:3000 for available endpoints
🔌 Socket.IO ready for real-time updates
```
**HTTP Response (Status 200 OK):**
```json
{
  "message": "EU Pay QA Test API",
  "version": "1.0.0",
  "features": [
    "🔐 Authentication (JWT)",
    "💳 Payment Processing",
    "🪝 Webhook Handling",
    "🍽️ Table Orders (Socket.IO)",
    "📄 E-Invoicing"
  ],
  "endpoints": [
    "POST /api/auth/register",
    "POST /api/auth/login",
    "GET /api/payments",
    "POST /api/payments",
    "GET /api/payments/:id",
    "POST /api/webhooks/payment-status",
    "POST /api/webhooks/e-invoice",
    "GET /api/table-orders",
    "POST /api/table-orders",
    "PATCH /api/table-orders/:id/status",
    "POST /api/einvoice/submit",
    "GET /api/einvoice/status/:invoice_id"
  ],
  "socket_events": [
    "join_merchant",
    "join_table",
    "new_order",
    "order_status_changed"
  ]
}
```

---

## 4. Application Architecture & Inventory

### 4.1 Persistence Layer (`src/db/database.js`)
- In-memory database structure containing:
  - `users`: Seeded with merchant `merchant@test.com` (password `Test123!`).
  - `payments`: Seeded with payments `id: 1` (€25.50 completed) and `id: 2` (€100.00 pending).
  - `sessions`: Session records storage.
  - `table_orders`: In-memory list for table ordering.
  - `invoices`: In-memory invoice storage.
  - `processed_webhooks`: Storage array for webhook idempotency tracking.

### 4.2 Middleware Layer (`src/middleware/auth.middleware.js`)
- `authenticate`: Extracts `Bearer <token>` from `req.headers.authorization`. Verifies signature using `JWT_SECRET`. Resolves merchant from `db.users`.
- Hardcoded fallback secret: `'test-secret-key-do-not-use-in-production'`. Configurable via environment variable.

### 4.3 Endpoint Inventory

| Endpoint | Method | Auth Required | Purpose |
|----------|--------|---------------|---------|
| `/` | GET | None | API Info & Endpoint catalog |
| `/api/auth/register` | POST | None | Merchant registration |
| `/api/auth/login` | POST | None | Merchant login & token issuance |
| `/api/payments` | GET | Bearer JWT | List merchant's payments |
| `/api/payments/:id` | GET | Bearer JWT | Get payment by ID (with ownership check) |
| `/api/payments` | POST | Bearer JWT | Create new transaction |
| `/api/webhooks/payment-status` | POST | None (Signature) | Provider webhook for payment status |
| `/api/webhooks/e-invoice` | POST | None | Tax authority status webhook |
| `/api/table-orders` | GET | Bearer JWT | List merchant orders |
| `/api/table-orders` | POST | None | Create customer table order |
| `/api/table-orders/:id/status` | PATCH | Bearer JWT | Update order status & emit Socket.IO event |
| `/api/einvoice/submit` | POST | Bearer JWT | Submit invoice to e-invoicing PDP |
| `/api/einvoice/status/:invoice_id` | GET | Bearer JWT | Query tax authority submission status |

---

## 5. Identified Defects in Baseline

1. **Bug A (Payment API):** `amount` serialized as string rather than float/number on `GET /api/payments` and `GET /api/payments/:id`.
2. **Bug B (Payment API):** Missing transaction maximum boundary check (`amount > 50000`) allows unrealistic transaction volumes.
3. **Bug C (Auth API):** Permissive email regex accepts email missing Top-Level Domain (e.g. `user@domain`).
4. **Bug D (Webhooks):** Webhook signature verification commented out, permitting unsigned or spoofed payment status updates.
5. **Bug E (Webhooks):** Webhook idempotency tracking commented out, permitting replay attacks and duplicate state mutations.
6. **Bug F (Table Orders):** Missing pending duplicate order check on tables allows duplicate orders while a previous order is pending.
7. **Bug G (E-Invoicing):** Missing check for duplicate submission allows resubmitting already `submitted` or `accepted` invoices.
8. **Platform Issue (Test Runner):** `npm test` script in `package.json` uses non-portable glob pattern failing on Windows shells.
