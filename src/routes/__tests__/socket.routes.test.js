import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import app, { io } from '../../server.js';
import { db, resetDatabase } from '../../db/database.js';

describe('Socket.IO Events & Real-time Order Updates Tests', () => {
  let merchantToken;

  beforeEach(async () => {
    resetDatabase();

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'merchant@test.com', password: 'Test123!' });
    merchantToken = loginRes.body.token;
  });

  test('Socket.IO server instance should be initialized and accessible via app.get("io")', () => {
    const appIo = app.get('io');
    assert.ok(appIo, 'app.get("io") must be defined');
    assert.strictEqual(typeof appIo.to, 'function', 'io.to must be a function for room messaging');
    assert.strictEqual(typeof appIo.emit, 'function', 'io.emit must be a function');
  });

  test('POST /api/table-orders should emit new_order event to merchant room', async () => {
    const interceptedEvents = [];
    const originalTo = io.to.bind(io);

    // Mock io.to to intercept emitted events
    io.to = (room) => ({
      emit: (eventName, data) => {
        interceptedEvents.push({ room, eventName, data });
      }
    });

    try {
      const response = await request(app)
        .post('/api/table-orders')
        .send({
          merchant_id: '1',
          table_number: 15,
          customer_name: 'Socket Client',
          items: [{ name: 'Espresso', price: 2.5, quantity: 2 }]
        });

      assert.strictEqual(response.status, 201);
      assert.strictEqual(interceptedEvents.length, 1);
      assert.strictEqual(interceptedEvents[0].room, 'merchant_1');
      assert.strictEqual(interceptedEvents[0].eventName, 'new_order');
      assert.strictEqual(interceptedEvents[0].data.table_number, 15);
      assert.strictEqual(interceptedEvents[0].data.total, 5.0);
    } finally {
      io.to = originalTo;
    }
  });

  test('PATCH /api/table-orders/:id/status should emit order_status_changed event to table room', async () => {
    // Create an order first
    const createRes = await request(app)
      .post('/api/table-orders')
      .send({
        merchant_id: '1',
        table_number: 22,
        items: [{ name: 'Pizza', price: 14.0, quantity: 1 }]
      });
    const orderId = createRes.body.data.id;

    const interceptedEvents = [];
    const originalTo = io.to.bind(io);

    io.to = (room) => ({
      emit: (eventName, data) => {
        interceptedEvents.push({ room, eventName, data });
      }
    });

    try {
      const patchRes = await request(app)
        .patch(`/api/table-orders/${orderId}/status`)
        .set('Authorization', `Bearer ${merchantToken}`)
        .send({ status: 'ready' });

      assert.strictEqual(patchRes.status, 200);
      assert.strictEqual(interceptedEvents.length, 1);
      assert.strictEqual(interceptedEvents[0].room, 'table_22');
      assert.strictEqual(interceptedEvents[0].eventName, 'order_status_changed');
      assert.strictEqual(interceptedEvents[0].data.order_id, orderId);
      assert.strictEqual(interceptedEvents[0].data.status, 'ready');
      assert.strictEqual(interceptedEvents[0].data.table_number, 22);
    } finally {
      io.to = originalTo;
    }
  });
});
