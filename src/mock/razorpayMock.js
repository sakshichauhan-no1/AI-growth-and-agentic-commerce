'use strict';

/** A deterministic, side-effect-free stand-in for Razorpay Orders. */
function createRazorpayMock() {
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

module.exports = { createRazorpayMock };
