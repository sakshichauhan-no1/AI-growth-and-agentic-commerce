'use strict';

const Razorpay = require('razorpay');

function parseMockMode(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

function createMockClient() {
  let orderNumber = 0;

  return {
    mode: 'mock',
    async createOrder({ amount, currency = 'INR', receipt, notes = {} }) {
      orderNumber += 1;
      return {
        id: `order_mock_${String(orderNumber).padStart(6, '0')}`,
        entity: 'order',
        amount,
        amount_paid: 0,
        amount_due: amount,
        currency,
        receipt,
        status: 'created',
        notes,
        created_at: Math.floor(Date.now() / 1000),
      };
    },
  };
}

/**
 * Returns the small payment boundary used by the agent.  MOCK_MODE=true
 * prevents external side effects; when MOCK_MODE is unset, missing credentials
 * also safely select the mock client for local development.
 */
function createRazorpayClient(options = {}) {
  const keyId = options.keyId ?? process.env.RAZORPAY_KEY_ID;
  const keySecret = options.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
  const configuredMockMode = parseMockMode(options.mockMode ?? process.env.MOCK_MODE);
  const mockMode = configuredMockMode ?? !(keyId && keySecret);

  if (mockMode) return createMockClient();

  if (!keyId || !keySecret) {
    throw new Error('RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are required when MOCK_MODE is false.');
  }

  const razorpay = new Razorpay({ key_id: keyId, key_secret: keySecret });
  return {
    mode: 'live',
    createOrder: (order) => razorpay.orders.create(order),
  };
}

module.exports = { createRazorpayClient, createMockClient, parseMockMode };
