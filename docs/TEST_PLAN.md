# EU Pay — Master Test Plan

## 1. Objectives & Quality Goals

The primary objective of this quality assurance test plan is to establish a rigorous, repeatable verification strategy for the European Pay payment platform. Specifically, this plan aims to:
- Verify end-to-end payment creation, retrieval, and state progression.
- Enforce strict HMAC-SHA256 signature verification and idempotency on incoming webhook streams.
- Validate JWT authentication, token life-cycle, and multi-tenant authorization barriers.
- Ensure e-invoicing submissions meet European regulatory format constraints (14-digit French SIRET) without duplicate filings.
- Verify real-time Socket.IO table ordering and status updates.
- Ensure minimum 80%+ automated code coverage across all core business modules and routes.

---

## 2. Scope & Out-of-Scope

### In-Scope
- **Authentication:** Registration, login, password strength, RFC-compliant email validation, JWT token issuance, token expiration, signature forgery rejection.
- **Payment Lifecycle:** Creation, listing, retrieval, currency constraints (EUR, USD, GBP), amount boundaries (min > 0, max <= €50,000), ownership enforcement.
- **Webhook Processing:** Signature calculation (HMAC-SHA256), replay attacks, duplicate deliveries (`event_id` tracking), payment status mutations, e-invoice status callbacks.
- **Table Orders:** Real-time restaurant ordering, duplicate pending order prevention on dining tables, total calculation, status progression (`pending` -> `confirmed` -> `preparing` -> `ready` -> `served` / `cancelled`), Socket.IO room messaging.
- **E-Invoicing:** Tax authority PDP submission simulation, 14-digit SIRET validation, duplicate submission rejection, submission status queries.
- **Security & Error Handling:** Injection safety, information leakage, HTTP status code accuracy.

### Out-of-Scope
- Frontend UI visual regression testing (Flutter mobile and Next.js web clients).
- Production payment network clearing (live SEPA transfers, live Visa/Mastercard interchange).
- Live external tax authority network submission (Chorus Pro / French DGFIP live network endpoints).
- Distributed stress and volumetric load testing (> 10,000 requests/sec).

---

## 3. Test Environment & Tooling

- **Application Server:** Node.js v20.18.0 / Express.js running on `http://localhost:3000`.
- **Database:** In-memory transactional test database with clean state isolation via `resetDatabase()`.
- **Test Runner:** Node.js native test runner (`node:test`) and assertion engine (`node:assert`).
- **HTTP Integration Testing:** `supertest` v6.3.4 for simulated network requests.
- **Real-Time Testing:** `socket.io` server event interception and room assertions.
- **Security Tooling:** Node.js native `crypto` library for cryptographic HMAC-SHA256 signing and verification.

---

## 4. Endpoint Inventory & Test Coverage

| Method | Route | Auth | Key Validations |
|---|---|---|---|
| GET | `/` | None | API metadata, feature flags, endpoint catalog |
| POST | `/api/auth/register` | None | Valid email (with TLD), password >= 8 chars, unique email |
| POST | `/api/auth/login` | None | Valid credentials, JWT token generation |
| GET | `/api/payments` | JWT | Merchant ownership, numeric amount format |
| GET | `/api/payments/:id` | JWT | Payment existence, merchant ownership, numeric amount |
| POST | `/api/payments` | JWT | Amount > 0, amount <= 50,000, valid currency, valid customer email |
| POST | `/api/webhooks/payment-status` | Signature | HMAC-SHA256 verification, `event_id` idempotency, payment status update |
| POST | `/api/webhooks/e-invoice` | None | Invoice existence, tax authority status and ID update |
| GET | `/api/table-orders` | JWT | Merchant ownership, order list filtering |
| POST | `/api/table-orders` | None | Non-empty items, single pending order per table, Socket.IO emit |
| PATCH | `/api/table-orders/:id/status` | JWT | Valid status transition, merchant ownership, Socket.IO emit |
| POST | `/api/einvoice/submit` | JWT | 14-digit SIRET, merchant ownership, duplicate submission prevention |
| GET | `/api/einvoice/status/:invoice_id` | JWT | Invoice existence, merchant ownership, submission details |

---

## 5. Webhook Payment Flow — Detailed Test Scenarios (14 Scenarios)

| Scenario ID | Test Title | Method & Route | Payload / Headers | Expected Status | Expected Behavior |
|---|---|---|---|---|---|
| **WH-01** | Valid webhook with correct signature | POST `/api/webhooks/payment-status` | Valid payload + valid `x-webhook-signature` | `200 OK` | Payment status transitions to `completed`; `webhook_received_at` set. |
| **WH-02** | Webhook with missing signature header | POST `/api/webhooks/payment-status` | Valid payload + NO `x-webhook-signature` | `401 Unauthorized` | Rejected with `{"error": "Webhook signature required"}`; DB unmutated. |
| **WH-03** | Webhook with forged/tampered signature | POST `/api/webhooks/payment-status` | Valid payload + spoofed signature | `401 Unauthorized` | Rejected with `{"error": "Invalid signature"}`; DB unmutated. |
| **WH-04** | Duplicate webhook (same `event_id`) | POST `/api/webhooks/payment-status` | Repeated payload with identical `event_id` | `200 OK` | Responds `{"message": "Already processed"}`; no duplicate mutation. |
| **WH-05** | Webhook for non-existent payment | POST `/api/webhooks/payment-status` | `payment_id: "nonexistent_9999"` + signed | `404 Not Found` | Responds `{"error": "Payment not found"}`. |
| **WH-06** | Webhook missing required fields | POST `/api/webhooks/payment-status` | `{ "status": "completed" }` (no payment_id) | `400 Bad Request` | Responds `{"error": "payment_id and status required"}`. |
| **WH-07** | Multiple webhooks for same payment | POST `/api/webhooks/payment-status` | Step 1: `status: "processing"`, Step 2: `status: "completed"` | `200 OK` | Payment status sequentially transitions; each valid distinct `event_id` accepted. |
| **WH-08** | Webhook with SQL injection in payment_id | POST `/api/webhooks/payment-status` | `payment_id: "1' OR '1'='1"` + signed | `404 Not Found` | Treated as string literal lookup; safely returns 404 without database exception. |
| **WH-09** | Webhook signature timing attack safety | POST `/api/webhooks/payment-status` | Partial match signature | `401 Unauthorized` | Deterministic constant-time or hash comparison rejects invalid signature. |
| **WH-10** | Webhook replay attack with old event_id | POST `/api/webhooks/payment-status` | Valid signature + previously processed `event_id` | `200 OK` | Deduplicated; responds `Already processed`. |
| **WH-11** | Malformed JSON payload | POST `/api/webhooks/payment-status` | Invalid JSON syntax (`{bad json`) | `400 Bad Request` | Express JSON middleware returns 400 Bad Request gracefully. |
| **WH-12** | Null / empty event_id handling | POST `/api/webhooks/payment-status` | `event_id: null` with valid signature | `200 OK` | Updates status; handles missing `event_id` gracefully. |
| **WH-13** | Very large payment_id string | POST `/api/webhooks/payment-status` | 10KB string for `payment_id` | `404 Not Found` | Safely rejects non-existent ID without buffer overflow or crash. |
| **WH-14** | Webhook arrives before payment created | POST `/api/webhooks/payment-status` | Valid signed webhook with unknown ID | `404 Not Found` | Returns 404 cleanly; provider retries until payment record is available. |

---

## 6. Authentication & Security Test Suite

1. **Email Format Integrity (Bug C):**
   - Rejection of addresses without top-level domain: `user@domain`, `merchant@local`, `admin@host`.
   - Rejection of empty, space-containing, and malformed emails.
   - Acceptance of standard domains (`user@domain.com`, `qa@european-pay.eu`).
2. **Password & Credential Strength:**
   - Rejection of passwords < 8 characters.
   - Rejection of missing email, password, or business name.
   - Password hashing via bcrypt with minimum 10 salt rounds.
3. **JWT Access Control:**
   - Rejection of unauthenticated requests on protected routes (`/api/payments`, `/api/table-orders`, `/api/einvoice/*`).
   - Rejection of missing `Bearer ` token scheme.
   - Rejection of tampered / forged tokens signed with incorrect secret.
   - Rejection of expired tokens (`exp` timestamp in past).
   - Rejection of tokens referencing deleted/non-existent user accounts.

---

## 7. Payments & Financial Integrity Suite

1. **Data Type Preservation (Bug A):**
   - Verification that `GET /api/payments` and `GET /api/payments/:id` return `amount` as numeric float (`typeof amount === 'number'`).
2. **Transaction Boundaries (Bug B):**
   - Rejection of amounts > €50,000 (status 400 with error containing `"maximum"`).
   - Acceptance of exact boundary €50,000 (status 201).
   - Rejection of €50,000.01 (status 400).
   - Rejection of zero amount (€0.00) and negative amounts (e.g. -€50.00).
   - Rejection of non-numeric strings (`NaN`).
3. **Multi-Currency Support:**
   - Validation of supported currencies: `EUR`, `USD`, `GBP`.
   - Rejection of unsupported or crypto currencies (`JPY`, `BTC`, `ETH`).
4. **Tenant Isolation:**
   - Isolation of payment listings: Merchant A cannot see Merchant B's payments.
   - Access control on `GET /api/payments/:id`: Merchant A receives HTTP 403 Forbidden when requesting Merchant B's payment.

---

## 8. Table Orders & Socket.IO Real-time Suite

1. **Duplicate Prevention (Bug F):**
   - Single active pending order permitted per table.
   - Rejection of duplicate order placement while status is `'pending'` (HTTP 409 Conflict).
   - Placement of new order permitted after previous order transitions to `'confirmed'`, `'served'`, or `'cancelled'`.
2. **Order Calculation & Validation:**
   - Rejection of order missing `merchant_id`, `table_number`, or `items`.
   - Rejection of empty `items` array.
   - Accurate calculation of order total (`sum(price * quantity)`).
3. **Socket.IO Event Emission:**
   - Real-time `new_order` event emitted to `merchant_{merchant_id}` room upon successful order creation.
   - Real-time `order_status_changed` event emitted to `table_{table_number}` room upon order status update.
   - Validation that order status transitions match allowed state machine values (`pending`, `confirmed`, `preparing`, `ready`, `served`, `cancelled`).

---

## 9. E-Invoicing Regulatory Compliance Suite

1. **Duplicate Prevention (Bug G):**
   - Rejection of duplicate submission for an invoice already in status `'submitted'` (HTTP 409 Conflict).
   - Rejection of duplicate submission for an invoice already in status `'accepted'` (HTTP 409 Conflict).
2. **French B2B Mandate (SIRET Validation):**
   - Enforce 14-digit customer SIRET requirement for e-invoicing submissions.
   - Rejection of 9-digit SIREN or non-14-digit identifiers.
3. **Status Queries & Ownership:**
   - Querying submission status returns `submission_id`, `einvoice_status`, and timestamps.
   - HTTP 403 Forbidden when merchant attempts to query another merchant's invoice.

---

## 10. Risk Assessment & Mitigation Matrix

| Identified Production Risk | Probability | Impact | Detection Strategy | Mitigation Strategy |
|---|---|---|---|---|
| **Webhook Spoofing** | High | Critical | Audit log alerts on unsigned webhook attempts; rejected signature metric tracking. | HMAC-SHA256 signature verification with secret stored in KMS/environment variable. |
| **Duplicate Webhook Retries** | High | Medium | Metric counter for `Already processed` responses from payment gateways. | Idempotency key tracking via database/Redis with TTL expiration. |
| **Excessive Transaction Volume** | Medium | High | Automated transaction monitoring for transactions > €10,000. | Enforced hard validation cap at €50,000 per transaction at the API layer. |
| **Concurrent Table Orders** | High | Low | Kitchen ticket monitoring and 409 Conflict logging. | Atomic lookup and locking on table status before order creation. |
| **Duplicate Tax Filings** | Low | High | Automated reconciliation report comparing PDP submission IDs with internal invoices. | Strict state machine preventing re-submission of `submitted`/`accepted` invoices. |
