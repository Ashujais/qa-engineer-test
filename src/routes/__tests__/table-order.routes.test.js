import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app from '../../server.js';
import { db, resetDatabase } from '../../db/database.js';

describe('Table Order Routes & Concurrency Tests', () => {
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
        email: 'bistro@merchant.com',
        password: 'Password123!',
        business_name: 'Bistro Paris'
      });
    otherMerchantToken = regRes.body.token;
  });

  // --- Bug F: Duplicate Table Order Prevention ---
  describe('Bug F: Duplicate Table Order Prevention', () => {
    test('Bug F Fix: should reject duplicate order when table already has a pending order', async () => {
      const orderPayload = {
        merchant_id: '1',
        table_number: 12,
        customer_name: 'Pierre',
        items: [
          { name: 'Croissant', price: 3.5, quantity: 2 },
          { name: 'Cafe au Lait', price: 4.0, quantity: 1 }
        ]
      };

      // First order
      const firstResponse = await request(app)
        .post('/api/table-orders')
        .send(orderPayload);

      assert.strictEqual(firstResponse.status, 201);
      assert.strictEqual(firstResponse.body.success, true);
      assert.strictEqual(firstResponse.body.data.status, 'pending');
      assert.strictEqual(firstResponse.body.data.total, 11.0);

      // Attempt second order on table 12 while pending
      const secondResponse = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 12,
          customer_name: 'Marie',
          items: [{ name: 'Orange Juice', price: 5.0, quantity: 1 }]
        });

      assert.strictEqual(secondResponse.status, 409);
      assert.strictEqual(secondResponse.body.error, 'Table already has a pending order');
    });

    test('should allow new table order after previous order status changes from pending', async () => {
      // Create first order
      const orderResponse = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 7,
          items: [{ name: 'Soup', price: 8.0, quantity: 1 }]
        });
      assert.strictEqual(orderResponse.status, 201);
      const orderId = orderResponse.body.data.id;

      // Update status to 'confirmed'
      const updateResponse = await request(app)
        .patch(`/api/table-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ status: 'confirmed' });
      assert.strictEqual(updateResponse.status, 200);

      // Now table 7 can place another order
      const nextOrderResponse = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 7,
          items: [{ name: 'Dessert', price: 6.0, quantity: 1 }]
        });

      assert.strictEqual(nextOrderResponse.status, 201);
      assert.strictEqual(nextOrderResponse.body.data.status, 'pending');
    });
  });

  // --- Input Validation ---
  describe('POST /api/table-orders Validation', () => {
    test('should reject order missing required fields', async () => {
      const response = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 5
          // missing items
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(
        response.body.error,
        'merchant_id, table_number, and items array required'
      );
    });

    test('should reject order with empty items array', async () => {
      const response = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 5,
          items: []
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Order must have at least one item');
    });
  });

  // --- List & Status Update Routes ---
  describe('GET & PATCH /api/table-orders', () => {
    test('GET /api/table-orders should return merchant orders with authentication', async () => {
      // Place order for merchant 1
      await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 3,
          items: [{ name: 'Pasta', price: 15.0, quantity: 1 }]
        });

      const response = await request(app)
        .get('/api/table-orders')
        .set('Authorization', `Bearer ${merchantToken}`);

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.success, true);
      assert.strictEqual(response.body.count, 1);
      assert.strictEqual(response.body.data[0].table_number, 3);
    });

    test('PATCH /api/table-orders/:id/status should update valid status', async () => {
      const createRes = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 4,
          items: [{ name: 'Steak', price: 25.0, quantity: 1 }]
        });
      const orderId = createRes.body.data.id;

      const patchRes = await request(app)
        .patch(`/api/table-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ status: 'preparing' });

      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(patchRes.body.data.status, 'preparing');
    });

    test('PATCH /api/table-orders/:id/status should reject invalid status string', async () => {
      const createRes = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 9,
          items: [{ name: 'Salad', price: 9.0, quantity: 1 }]
        });
      const orderId = createRes.body.data.id;

      const patchRes = await request(app)
        .patch(`/api/table-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ status: 'invalid_status_xyz' });

      assert.strictEqual(patchRes.status, 400);
      assert.strictEqual(patchRes.body.error, 'Valid status required');
    });

    test('PATCH /api/table-orders/:id/status should prevent unauthorized merchant access', async () => {
      const createRes = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 1,
          items: [{ name: 'Bread', price: 2.0, quantity: 1 }]
        });
      const orderId = createRes.body.data.id;

      const patchRes = await request(app)
        .patch(`/api/table-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${otherMerchantToken}`)
        .send({ status: 'served' });

      assert.strictEqual(patchRes.status, 403);
      assert.strictEqual(patchRes.body.error, 'Access denied');
    });

    test('PATCH /api/table-orders/:id/status should return 404 for non-existent order', async () => {
      const patchRes = await request(app)
        .patch('/api/table-orders/00000000-0000-0000-0000-000000000000/status')
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ status: 'served' });

      assert.strictEqual(patchRes.status, 404);
      assert.strictEqual(patchRes.body.error, 'Order not found');
    });
  });
});
