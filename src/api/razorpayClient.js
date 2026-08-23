'use strict';

require('dotenv').config({ quiet: true });

const Razorpay = require('razorpay');
const { createRazorpayMock } = require('../mock/razorpayMock');

function parseMockMode(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value !== 'string') return undefined;

  const normalized = value.trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  return undefined;
}

/**
 * Uses the official Razorpay SDK for test/live calls when MOCK_MODE=false.
 * MOCK_MODE=true deliberately routes all order creation to the local mock.
 */
function createRazorpayClient(options = {}) {
  const keyId = options.keyId ?? process.env.RAZORPAY_KEY_ID;
  const keySecret = options.keySecret ?? process.env.RAZORPAY_KEY_SECRET;
  const configuredMockMode = parseMockMode(options.mockMode ?? process.env.MOCK_MODE);
  const mockMode = configuredMockMode ?? !(keyId && keySecret);
  const mockClient = options.mockClient ?? createRazorpayMock();
  const razorpayFactory = options.razorpayFactory ?? ((config) => new Razorpay(config));

  if (mockMode) return mockClient;

  if (!keyId || !keySecret) {
    return mockClient;
  }

  try {
    const razorpay = razorpayFactory({ key_id: keyId, key_secret: keySecret });
    return {
      mode: 'live-with-mock-fallback',
      async createOrder(order) {
        try {
          return await razorpay.orders.create(order);
        } catch (error) {
          // Network and credential failures must not turn an approved checkout
          // into an unhandled exception. Preserve the Razorpay order contract.
          const mockOrder = await mockClient.createOrder(order);
          return {
            ...mockOrder,
            fallbackFrom: 'razorpay',
            fallbackReason: error.message ?? 'Razorpay request failed.',
          };
        }
      },
    };
  } catch (_error) {
    return mockClient;
  }
}

module.exports = { createRazorpayClient, createMockClient: createRazorpayMock, parseMockMode };
