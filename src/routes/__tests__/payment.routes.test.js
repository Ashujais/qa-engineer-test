import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';
import { resetDatabase } from '../../db/database.js';

describe('Payment Routes & Integrity Tests', () => {
  let merchantToken;
  let secondMerchantToken;

  beforeEach(async () => {
    resetDatabase();

    // Log in seeded merchant 1 (id: '1')
    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'merchant@test.com', password: 'Test123!' });
    merchantToken = loginRes.body.token;

    // Register merchant 2 (id: '2') for ownership testing
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: 'other@merchant.com',
        password: 'Password123!',
        business_name: 'Other Merchant Store'
      });
    secondMerchantToken = regRes.body.token;
  });

  // --- Bug A: Payment Amount Data Type Tests ---
  describe('Bug A: Payment Amount Data Type', () => {
    test('Bug A Fix: GET /api/payments should return amount as number, not string', async () => {
      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.ok(Array.isArray(response.body.data));
      assert.strictEqual(response.body.data.length, 2);

      const payment1 = response.body.data[0];
      assert.strictEqual(typeof payment1.amount, 'number', 'amount must be numeric');
      assert.strictEqual(payment1.amount, 25.5);

      const payment2 = response.body.data[1];
      assert.strictEqual(typeof payment2.amount, 'number', 'amount must be numeric');
      assert.strictEqual(payment2.amount, 100.0);
    });

    test('Bug A Fix: GET /api/payments/:id should return amount as number', async () => {
      const response = await request(app)
        .get('/api/payments/1')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(typeof response.body.data.amount, 'number', 'amount must be numeric');
      assert.strictEqual(response.body.data.amount, 25.5);
    });
  });

  // --- Bug B: Maximum Amount Validation Tests ---
  describe('Bug B: Maximum Amount Validation & Boundaries', () => {
    test('Bug B Fix: POST /api/payments should reject unrealistic amount over €50,000', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 999999999,
          currency: 'EUR',
          customer_email: 'buyer@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error, 'Should return error message');
      assert.ok(
        response.body.error.toLowerCase().includes('maximum'),
        'Error message must state maximum limit exceeded'
      );
    });

    test('POST /api/payments should accept exact boundary of €50,000', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 50000,
          currency: 'EUR',
          customer_email: 'buyer@example.com'
        });

      assert.strictEqual(response.status, 201);
      assert.strictEqual(response.body.data.amount, 50000);
    });

    test('POST /api/payments should reject just over boundary: €50,000.01', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 50000.01,
          currency: 'EUR',
          customer_email: 'buyer@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.ok(response.body.error.toLowerCase().includes('maximum'));
    });
  });

  // --- Payment Creation Validation & Edge Cases ---
  describe('POST /api/payments Validations', () => {
    test('should create valid payment with supported currencies (EUR, USD, GBP)', async () => {
      for (const currency of ['EUR', 'USD', 'GBP']) {
        const response = await request(app)
          .post('/api/payments')
          .set('Authorization', `Bearer ${merchantToken}`)
          .send({
            amount: 75.50,
            currency,
            customer_email: `customer_${currency.toLowerCase()}@example.com`
          });

        assert.strictEqual(response.status, 201);
        assert.strictEqual(response.body.data.currency, currency);
        assert.strictEqual(response.body.data.status, 'pending');
        assert.strictEqual(typeof response.body.data.amount, 'number');
      }
    });

    test('should reject negative amount', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: -50.00,
          currency: 'EUR',
          customer_email: 'customer@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Valid amount is required');
    });

    test('should reject zero amount', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 0,
          currency: 'EUR',
          customer_email: 'customer@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Valid amount is required');
    });

    test('should reject non-numeric amount string', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 'invalid_number',
          currency: 'EUR',
          customer_email: 'customer@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Valid amount is required');
    });

    test('should reject unsupported currency', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 100,
          currency: 'BTC',
          customer_email: 'crypto@example.com'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        'Valid currency is required (EUR, USD, GBP)'
      );
    });

    test('should reject missing customer email', async () => {
      const response = await request(app)
        .post('/api/payments')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({
          amount: 100,
          currency: 'EUR'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Valid customer email is required');
    });
  });

  // --- Authorization & Access Control ---
  describe('Payment Resource Authorization & Isolation', () => {
    test('should return 404 for non-existent payment ID', async () => {
      const response = await request(app)
        .get('/api/payments/999999')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 404);
      assert.strictEqual(response.body.error, 'Payment not found');
    });

    test('should deny access when merchant attempts to view another merchant payment', async () => {
      // Payment 1 belongs to merchant '1'
      // Second merchant has ID '2'
      const response = await request(app)
        .get('/api/payments/1')
        .set('Authorization', `Bearer ${secondMerchantToken}`);

      assert.strictEqual(response.status, 403);
      assert.strictEqual(response.body.error, 'Access denied');
    });

    test('GET /api/payments should isolate payments by merchant', async () => {
      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${secondMerchantToken}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.data.length, 0, 'New merchant should have 0 payments initially');
    });
  });
});
