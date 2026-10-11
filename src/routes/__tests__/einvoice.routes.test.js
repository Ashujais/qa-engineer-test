import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';
import { db, resetDatabase } from '../../db/database.js';

describe('E-Invoice Routes & Regulatory Compliance Tests', () => {
  let merchantToken;
  let otherMerchantToken;

  beforeEach(async () => {
    resetDatabase();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'merchant@test.com', password: 'Test123!' });
    merchantToken = loginRes.body.token;

    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'other_merchant@test.com',
        password: 'Password123!',
        business_name: 'Competitor Corp'
      });
    otherMerchantToken = regRes.body.token;
  });

  // --- Bug G: Duplicate Submission Prevention ---
  describe('Bug G: Duplicate E-Invoice Submission Prevention', () => {
    test('Bug G Fix: should reject duplicate submission for already submitted invoice', async () => {
      const invoicePayload = {
        invoice_id: 'inv_fr_2026_001',
        customer_siret: '12345678901234' // Valid 14 digits
      };

      // First submission
      const firstResponse = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send(invoicePayload);

      assert.strictEqual(firstResponse.status, 200);
      assert.strictEqual(firstResponse.body.success, true);
      assert.strictEqual(firstResponse.body.message, 'Invoice submitted to tax authority');
      assert.strictEqual(firstResponse.body.data.status, 'submitted');
      assert.ok(firstResponse.body.data.submission_id);

      // Attempt second duplicate submission
      const secondResponse = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send(invoicePayload);

      assert.strictEqual(secondResponse.status, 409);
      assert.strictEqual(
        secondResponse.body.error,
        'Invoice already submitted to tax authority'
      );
    });

    test('Bug G Fix: should reject submission when invoice has already been accepted', async () => {
      // Seed pre-accepted invoice
      db.invoices.push({
        id: 'inv_accepted_001',
        merchant_id: '1',
        invoice_number: 'INV-ACCEPTED',
        amount: 500.0,
        currency: 'EUR',
        customer_siret: '12345678901234',
        status: 'draft',
        einvoice_status: 'accepted'
      });

      const response = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          invoice_id: 'inv_accepted_001',
          customer_siret: '12345678901234'
        });

      assert.strictEqual(response.status, 409);
      assert.strictEqual(
        response.body.error,
        'Invoice already submitted to tax authority'
      );
    });
  });

  // --- SIRET & Field Validations ---
  describe('POST /api/einvoice/submit Validations', () => {
    test('should reject submission with invalid SIRET length (not 14 digits)', async () => {
      // 9 digits (SIREN, not SIRET)
      const response = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          invoice_id: 'inv_invalid_siret',
          customer_siret: '123456789'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        'Valid customer SIRET required for e-invoicing (14 digits)'
      );
    });

    test('should reject submission missing invoice_id', async () => {
      const response = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          customer_siret: '12345678901234'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'invoice_id required');
    });

    test('should require authentication to submit invoice', async () => {
      const response = await request(app)
        .post('/api/einvoice/submit')
        .send({
          invoice_id: 'inv_unauth',
          customer_siret: '12345678901234'
        });

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Authentication required');
    });

    test('should deny access when submitting an invoice belonging to another merchant', async () => {
      // Create invoice owned by merchant 1
      db.invoices.push({
        id: 'inv_m1_exclusive',
        merchant_id: '1',
        invoice_number: 'INV-M1',
        amount: 200,
        currency: 'EUR',
        status: 'draft'
      });

      // Merchant 2 attempts to submit merchant 1's invoice
      const response = await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .send({
          invoice_id: 'inv_m1_exclusive',
          customer_siret: '12345678901234'
        });

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, 'Access denied');
    });
  });

  // --- E-Invoice Status Retrieval ---
  describe('GET /api/einvoice/status/:invoice_id', () => {
    test('should return e-invoice submission status for authenticated merchant', async () => {
      // Submit invoice first
      await request(app)
        .post('/api/einvoice/submit')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          invoice_id: 'inv_status_query',
          customer_siret: '98765432109876'
        });

      const response = await request(app)
        .get('/api/einvoice/status/inv_status_query')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.data.invoice_id, 'inv_status_query');
      assert.strictEqual(response.body.data.einvoice_status, 'submitted');
      assert.ok(response.body.data.submission_id);
    });

    test('should return 404 for non-existent invoice status query', async () => {
      const response = await request(app)
        .get('/api/einvoice/status/non_existent_invoice_id')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'Invoice not found');
    });

    test('should prevent access to invoice status belonging to another merchant', async () => {
      db.invoices.push({
        id: 'inv_private_m1',
        merchant_id: '1',
        invoice_number: 'INV-PRIV',
        amount: 100,
        currency: 'EUR',
        status: 'draft'
      });

      const response = await request(app)
        .get('/api/einvoice/status/inv_private_m1')
        .set('Authorization', `Bearer ${otherMerchantToken}`);

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, 'Access denied');
    });
  });
});
