# Webhook Payment Flow Test Plan — EU Pay

This document provides a comprehensive test plan for the **Webhook Payment Flow** as specified in Task 4 of the EU Pay QA Engineer assessment.

---

## 1. Test Scope

### What Will Be Tested:
- **End-to-End Payment Webhook Lifecycle:** Receiving, validating, deduplicating, and persisting payment status updates from external payment providers (e.g. Powens, Stripe).
- **Cryptographic Signature Verification:** Strict HMAC-SHA256 signature validation over the raw payload against the shared webhook secret.
- **Webhook Idempotency & Replay Protection:** Prevention of duplicate status transitions or side-effects when payment gateways retry requests.
- **Error Handling & Boundary Conditions:** Missing payload fields, invalid payment IDs, malformed JSON bodies, extreme lengths, and non-existent payments.
- **Security & Attack Vectors:** Forged signatures, replay attacks, SQL injection payloads, and timing attack resistance.
- **E-Invoice Tax Authority Webhook:** Processing tax authority status callbacks (`POST /api/webhooks/e-invoice`).

### What Won't Be Tested:
- Frontend user interfaces (Flutter mobile app, Next.js web application).
- Live external banking networks (real bank clearing networks or production Powens API credentials).
- Distributed high-volume stress testing (> 10,000 requests/sec).

---

## 2. Test Environment

- **Target API:** `http://localhost:3000`
- **Webhook Simulator:** Automated test runner (`node:test` + `supertest`) and manual `curl` scripts.
- **Database:** In-memory transactional store (`db.payments`, `db.processed_webhooks`), reset cleanly per test scenario.
- **Cryptography:** Node.js native `crypto.createHmac('sha256', WEBHOOK_SECRET)`.
- **Configuration:** `WEBHOOK_SECRET=test-webhook-secret-key` (configurable via `.env`).

---

## 3. Test Scenarios (14 Scenarios)

### Scenario 1: Valid Webhook with Correct Signature
- **Precondition:** Payment `id: "2"` exists in status `"pending"`.
- **Action:** Send `POST /api/webhooks/payment-status` with body:
  ```json
  { "payment_id": "2", "status": "completed", "event_id": "evt_valid_1" }
  ```
  and `x-webhook-signature` header containing valid HMAC-SHA256 hex digest.
- **Expected Result:** HTTP 200 OK (`{"success": true, "message": "Webhook processed"}`), payment status updated to `"completed"`, `webhook_received_at` timestamp recorded.

### Scenario 2: Webhook with Invalid Signature (Should Reject)
- **Precondition:** Payment `id: "2"` in status `"pending"`.
- **Action:** Send `POST /api/webhooks/payment-status` with `x-webhook-signature: "invalid_spoofed_signature"`.
- **Expected Result:** HTTP 401 Unauthorized (`{"error": "Invalid signature"}`), payment status remains `"pending"`.

### Scenario 3: Webhook Missing Signature Header
- **Precondition:** Payment `id: "2"` exists.
- **Action:** Send `POST /api/webhooks/payment-status` without `x-webhook-signature` header.
- **Expected Result:** HTTP 401 Unauthorized (`{"error": "Webhook signature required"}`), request rejected before processing.

### Scenario 4: Duplicate Webhook (Same `event_id` Twice)
- **Precondition:** Webhook with `event_id: "evt_dup_100"` was previously delivered and processed.
- **Action:** Send another request with identical payload and `event_id: "evt_dup_100"`.
- **Expected Result:** HTTP 200 OK with `{"message": "Already processed"}`. Idempotency prevents redundant state mutations or timestamp updates.

### Scenario 5: Webhook for Non-Existent Payment
- **Precondition:** Payment ID `"999999"` does not exist in database.
- **Action:** Send signed webhook with `payment_id: "999999"`, `status: "completed"`.
- **Expected Result:** HTTP 404 Not Found (`{"error": "Payment not found"}`).

### Scenario 6: Webhook Arrives Before Payment Created
- **Precondition:** Webhook arrives out-of-order due to asynchronous processing delay in payment creation.
- **Action:** Send signed webhook for an ID not yet stored.
- **Expected Result:** HTTP 404 Not Found. Provider will retry according to backoff policy until payment creation completes.

### Scenario 7: Multiple Webhooks for Same Payment (State Progression)
- **Precondition:** Payment `id: "2"` in status `"pending"`.
- **Action:**
  1. Send webhook 1 with `status: "processing"`, `event_id: "evt_step_1"`.
  2. Send webhook 2 with `status: "completed"`, `event_id: "evt_step_2"`.
- **Expected Result:** Both requests return 200 OK; payment status progressively updates from `"pending"` -> `"processing"` -> `"completed"`.

### Scenario 8: Webhook with Missing Fields
- **Precondition:** Server active.
- **Action:** Send signed webhook missing `payment_id`: `{ "status": "completed", "event_id": "evt_missing" }`.
- **Expected Result:** HTTP 400 Bad Request (`{"error": "payment_id and status required"}`).

### Scenario 9: Webhook with Malformed JSON
- **Precondition:** Server active.
- **Action:** Send raw body `{"payment_id": 2, status: ` with `Content-Type: application/json`.
- **Expected Result:** HTTP 400 Bad Request returned by Express body-parser, preventing unhandled server crashes.

### Scenario 10: Concurrent Webhooks (Race Condition Simulation)
- **Precondition:** Payment `id: "2"` in status `"pending"`.
- **Action:** Dispatch two parallel requests with the same `event_id` simultaneously using `Promise.all()`.
- **Expected Result:** Exactly one request executes the state update; subsequent request is recognized as `"Already processed"`.

### Scenario 11: Webhook with SQL Injection in `payment_id`
- **Precondition:** Server active.
- **Action:** Send signed webhook with `payment_id: "2' OR '1'='1"`.
- **Expected Result:** Handled safely as string lookup; returns HTTP 404 Not Found without SQL or memory evaluation anomalies.

### Scenario 12: Webhook Signature Timing Attack
- **Precondition:** Server active.
- **Action:** Submit candidate signatures with identical prefix lengths to evaluate timing leakage.
- **Expected Result:** Cryptographic evaluation rejects invalid signatures in consistent processing time.

### Scenario 13: Webhook Replay Attack (Old `event_id`)
- **Precondition:** Valid transaction processed 24 hours earlier with `event_id: "evt_old_1"`.
- **Action:** Attacker captures and replays identical request.
- **Expected Result:** Recognized as duplicate; returns `"Already processed"` without changing payment state.

### Scenario 14: Null or Empty `event_id`
- **Precondition:** Payment `id: "2"` exists.
- **Action:** Send signed webhook with `event_id: null` or omitted `event_id`.
- **Expected Result:** Updates payment status to requested status; does not crash on missing `event_id`.

---

## 4. Security Tests

1. **HMAC-SHA256 Signature Verification:**
   - Verify every incoming request against `WEBHOOK_SECRET`.
   - Reject empty, truncated, or tampered signatures with HTTP 401.
2. **Replay Attack Prevention:**
   - Store processed `event_id` identifiers in `processed_webhooks`.
   - Ensure replayed events return `Already processed`.
3. **Payload Sanitization & Injection Defense:**
   - Test SQL characters (`'`, `"`, `--`, `;`) in `payment_id` and `status`.
   - Test XSS script tags (`<script>alert(1)</script>`) in `status` and `event_id` fields.
4. **Secret Isolation:**
   - Ensure `WEBHOOK_SECRET` is never logged in server output or error traces.

---

## 5. Edge Cases

- **Very Large `payment_id`:** Submit 10KB string; verify no buffer overflow or high memory spike (returns 404).
- **Unicode & Special Characters in Status:** Submit status containing emojis or Cyrillic characters; verify safe handling.
- **Whitespace in Headers:** Webhook signature header with leading/trailing spaces.
- **Future Timestamps:** Payloads containing future `created_at` dates; verify server applies its own server-side timestamp `new Date()`.

---

## 6. Integration Tests

- **Webhook -> Payment Status Update -> Persistence:**
  Verify that when a valid webhook is accepted, `getPaymentById(id).status` reflects the updated status and `webhook_received_at` is set.
- **Webhook -> E-Invoice Flow:**
  Verify that `POST /api/webhooks/e-invoice` updates `invoice.einvoice_status = 'accepted'` and populates `tax_authority_id`.
- **Failed Webhook -> Safe Non-Mutation:**
  Verify that upon 400, 401, or 404 responses, no database records are partially mutated.

---

## 7. Risk Assessment

| Potential Production Failure | How to Detect | Mitigation & Prevention |
|---|---|---|
| **Spoofed Webhook Mark as Paid** | High priority alert on unauthenticated payment status changes; daily transaction reconciliation. | Strict HMAC-SHA256 signature verification over raw request body; rotate webhook secret via key management service. |
| **Duplicate Delivery (Double Credit)** | Monitor metrics for spike in repeated `event_id` requests. | Idempotency key tracking using durable persistent storage (e.g. Redis with atomic `SET NX EX`). |
| **Out-of-Order Webhooks (`completed` before `pending`)** | State machine assertion alerts in application log. | Implement explicit status progression rules (e.g. disallow transition from `completed` back to `pending`). |
| **Provider Webhook Retries Exhausted** | Dead-letter queue (DLQ) alerts on repeated 5xx responses. | Return 200 OK as soon as payload is safely queued/processed; implement asynchronous background worker. |
