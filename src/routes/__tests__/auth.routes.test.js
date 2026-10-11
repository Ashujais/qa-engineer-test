import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../server.js';
import { validateEmail } from '../auth.routes.js';
import { resetDatabase } from '../../db/database.js';

describe('Auth Routes & Security Tests', () => {
  beforeEach(() => {
    resetDatabase();
  });

  // --- Unit Tests for Bug C: validateEmail ---
  describe('Bug C: Email Validation Unit Tests', () => {
    test('Bug C Fix: validateEmail should reject email missing TLD (e.g. user@domain)', () => {
      assert.strictEqual(validateEmail('user@domain'), false);
      assert.strictEqual(validateEmail('merchant@company'), false);
      assert.strictEqual(validateEmail('admin@localhost'), false);
    });

    test('validateEmail should reject malformed emails', () => {
      assert.strictEqual(validateEmail(''), false);
      assert.strictEqual(validateEmail('invalid-email'), false);
      assert.strictEqual(validateEmail('@missinguser.com'), false);
      assert.strictEqual(validateEmail('spaces in@email.com'), false);
      assert.strictEqual(validateEmail('user@.com'), false);
    });

    test('validateEmail should accept valid standard emails', () => {
      assert.strictEqual(validateEmail('merchant@test.com'), true);
      assert.strictEqual(validateEmail('user.name@sub.domain.eu'), true);
      assert.strictEqual(validateEmail('qa-engineer@european-pay.eu'), true);
      assert.strictEqual(validateEmail('test_123@domain.org'), true);
    });
  });

  // --- Integration Tests: POST /api/auth/register ---
  describe('POST /api/auth/register', () => {
    test('should register a new merchant with valid credentials', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'newmerchant@example.com',
          password: 'SecurePassword123!',
          business_name: 'Alpha Payments Ltd'
        });

      assert.strictEqual(response.status, 201);
      assert.strictEqual(response.body.message, 'Registration successful');
      assert.ok(response.body.user);
      assert.strictEqual(response.body.user.email, 'newmerchant@example.com');
      assert.strictEqual(response.body.user.business_name, 'Alpha Payments Ltd');
      assert.ok(response.body.token);

      // Verify returned token is a valid JWT with merchant claims
      const decoded = jwt.decode(response.body.token);
      assert.strictEqual(decoded.email, 'newmerchant@example.com');
      assert.strictEqual(decoded.type, 'merchant');
    });

    test('Bug C Regression: should reject registration with email missing TLD', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'attacker@domain',
          password: 'SecurePassword123!',
          business_name: 'No TLD Business'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Invalid email format');
    });

    test('should reject registration when email is already registered', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'merchant@test.com',
          password: 'Password123!',
          business_name: 'Duplicate Inc'
        });

      assert.strictEqual(response.status, 409);
      assert.strictEqual(response.body.error, 'Email already registered');
    });

    test('should reject registration when password is under 8 characters', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'shortpass@example.com',
          password: 'short',
          business_name: 'Short Pass Store'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Password must be at least 8 characters');
    });

    test('should reject registration when business name is missing or too short', async () => {
      const response = await request(app)
        .post('/api/auth/register')
        .send({
          email: 'noname@example.com',
          password: 'ValidPassword123!',
          business_name: ' '
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Business name is required');
    });
  });

  // --- Integration Tests: POST /api/auth/login ---
  describe('POST /api/auth/login', () => {
    test('should successfully log in seeded test merchant', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'merchant@test.com',
          password: 'Test123!'
        });

      assert.strictEqual(response.status, 200);
      assert.strictEqual(response.body.message, 'Login successful');
      assert.strictEqual(response.body.user.email, 'merchant@test.com');
      assert.strictEqual(response.body.user.id, '1');
      assert.ok(response.body.token);
    });

    test('should reject login with wrong password', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'merchant@test.com',
          password: 'IncorrectPassword999!'
        });

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Invalid credentials');
    });

    test('should reject login with non-existent email', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'AnyPassword123!'
        });

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Invalid credentials');
    });

    test('should reject login when credentials fields are missing', async () => {
      const response = await request(app)
        .post('/api/auth/login')
        .send({
          email: 'merchant@test.com'
        });

      assert.strictEqual(response.status, 400);
      assert.strictEqual(response.body.error, 'Email and password required');
    });
  });

  // --- Security & JWT Middleware Tests ---
  describe('JWT Verification & Protected Access Control', () => {
    test('should reject protected route request without Authorization header', async () => {
      const response = await request(app).get('/api/payments');
      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Authentication required');
    });

    test('should reject Authorization header without Bearer prefix', async () => {
      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', 'Basic dXNlcjpwYXNz');

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Authentication required');
    });

    test('should reject forged or tampered token', async () => {
      const forgedToken = jwt.sign(
        { id: '1', email: 'merchant@test.com' },
        'wrong-secret-key'
      );

      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${forgedToken}`);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Invalid token');
    });

    test('should reject expired JWT token', async () => {
      const expiredToken = jwt.sign(
        { id: '1', email: 'merchant@test.com', type: 'merchant' },
        'test-secret-key-do-not-use-in-production',
        { expiresIn: '-1s' }
      );

      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${expiredToken}`);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'Token expired');
    });

    test('should reject token for non-existent user ID', async () => {
      const ghostToken = jwt.sign(
        { id: '999999', email: 'ghost@test.com', type: 'merchant' },
        'test-secret-key-do-not-use-in-production',
        { expiresIn: '1h' }
      );

      const response = await request(app)
        .get('/api/payments')
        .set('Authorization', `Bearer ${ghostToken}`);

      assert.strictEqual(response.status, 401);
      assert.strictEqual(response.body.error, 'User not found');
    });
  });
});
