import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import crypto from 'crypto';
import request from 'supertest';
import app from '../../server.js';
import { db, resetDatabase } from '../../db/database.js';

const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'test-webhook-secret-key';

function generateSignature(payload) {
  return crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(JSON.stringify(payload))
    .digest('hex');
}

describe('Webhook Routes, Security & Idempotency Tests', () => {
  beforeEach(() => {
    resetDatabase();
  });

  // --- Bug D: Webhook Signature Verification ---
  describe('Bug D: Webhook Signature Verification (HMAC-SHA256)', () => {
    test('Bug D Fix: should reject webhook when x-webhook-signature header is missing', async () => {
      const payload = {
        payment_id: '2',
        status: 'completed',
        event_id: 'evt_no_sig'
      };

      const response = await request(app)
        .post('/api/webhooks/payment-status')
        .send(payload);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Webhook signature required');

      // Verify payment was NOT mutated
      const payment = db.payments.find(p => p.id === '2');
      assert.strictEqual(payment.status, 'pending');
    });

    test('Bug D Fix: should reject webhook with forged / invalid signature', async () => {
      const payload = {
        payment_id: '2',
        status: 'completed',
        event_id: 'evt_spoof_sig'
      };

      const response = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', 'forged_fake_signature_hash_1234567890abcdef')
        .send(payload);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Invalid signature');

      // Verify payment was NOT mutated
      const payment = db.payments.find(p => p.id === '2');
      assert.strictEqual(payment.status, 'pending');
    });

    test('Bug D Fix: should accept webhook with valid HMAC-SHA256 signature', async () => {
      const payload = {
        payment_id: '2',
        status: 'completed',
        event_id: 'evt_valid_sig_101'
      };
      const validSignature = generateSignature(payload);

      const response = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', validSignature)
        .send(payload);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.message, 'Webhook processed');

      // Verify payment was mutated in database
      const payment = db.payments.find(p => p.id === '2');
      assert.strictEqual(payment.status, 'completed');
      assert.ok(payment.webhook_received_at);
    });
  });

  // --- Bug E: Webhook Idempotency ---
  describe('Bug E: Webhook Idempotency & Replay Protection', () => {
    test('Bug E Fix: repeated webhook with identical event_id should return Already processed', async () => {
      const payload = {
        payment_id: '2',
        status: 'completed',
        event_id: 'evt_duplicate_test_202'
      };
      const signature = generateSignature(payload);

      // First webhook delivery
      const firstResponse = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', signature)
        .send(payload);

      assert.strictEqual(firstResponse.status, 200);
      assert.strictEqual(firstResponse.body.message, 'Webhook processed');

      // Record first timestamp
      const payment = db.payments.find(p => p.id === '2');
      const firstTimestamp = payment.webhook_received_at;

      // Second duplicate delivery (same event_id)
      const secondResponse = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', signature)
        .send(payload);

      assert.strictEqual(secondResponse.status, 200);
      assert.strictEqual(secondResponse.body.message, 'Already processed');

      // Verify payment timestamp was NOT overwritten
      assert.strictEqual(payment.webhook_received_at, firstTimestamp);
      // Verify processed_webhooks tracking
      assert.ok(db.processed_webhooks.includes('evt_duplicate_test_202'));
    });
  });

  // --- Webhook Payload Validations ---
  describe('Webhook Payload Validation & Error Handling', () => {
    test('should reject webhook missing payment_id or status', async () => {
      const payload = { event_id: 'evt_missing_fields' };
      const signature = generateSignature(payload);

      const response = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', signature)
        .send(payload);

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'payment_id and status required');
    });

    test('should return 404 when payment_id does not exist', async () => {
      const payload = {
        payment_id: 'non_existent_9999',
        status: 'completed',
        event_id: 'evt_nonexistent'
      };
      const signature = generateSignature(payload);

      const response = await request(app)
        .post('/api/webhooks/payment-status')
        .set('x-webhook-signature', signature)
        .send(payload);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'Payment not found');
    });
  });

  // --- E-Invoice Webhook ---
  describe('POST /api/webhooks/e-invoice', () => {
    test('should update invoice status and tax authority info upon receiving e-invoice webhook', async () => {
      // Seed test invoice
      db.invoices.push({
        id: 'inv_tax_1',
        merchant_id: '1',
        invoice_number: 'INV-1001',
        amount: 150.00,
        currency: 'EUR',
        status: 'draft',
        einvoice_status: 'submitted'
      });

      const response = await request(app)
        .post('/api/webhooks/e-invoice')
        .send({
          invoice_id: 'inv_tax_1',
          status: 'accepted',
          submission_id: 'SUB-FR-7890',
          tax_authority_id: 'DGFIP-AUTH-9921'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.status, 'accepted');

      const invoice = db.invoices.find(inv => inv.id === 'inv_tax_1');
      assert.strictEqual(invoice.einvoice_status, 'accepted');
      assert.strictEqual(invoice.tax_authority_id, 'DGFIP-AUTH-9921');
      assert.strictEqual(invoice.einvoice_submission_id, 'SUB-FR-7890');
    });

    test('should return 404 for non-existent invoice in e-invoice webhook', async () => {
      const response = await request(app)
        .post('/api/webhooks/e-invoice')
        .send({
          invoice_id: 'ghost_inv',
          status: 'rejected'
        });

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'Invoice not found');
    });

    test('should reject e-invoice webhook missing required fields', async () => {
      const response = await request(app)
        .post('/api/webhooks/e-invoice')
        .send({
          invoice_id: 'inv_tax_1'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'invoice_id and status required');
    });
  });
});
