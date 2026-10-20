const test = require('node:test');
const assert = require('node:assert/strict');

const { buildRestaurantRatingSummary } = require('../src/ratings');

test('restaurant rating averages valid unique order ratings and prefers feedback over legacy rating', () => {
  const summary = buildRestaurantRatingSummary(
    [
      { orderId: 'order-1', stars: 1 },
      { orderId: 'order-2', stars: 4 },
      { orderId: 'order-3', stars: 0 },
      { orderId: 'order-4', stars: 5 }
    ],
    [
      { orderId: 'order-1', overallRating: 5 },
      { orderId: 'order-4', overallRating: 4 }
    ]
  );

  assert.deepEqual(summary, { average: 4.33, count: 3 });
});

test('restaurant rating summary returns a neutral value when there are no valid ratings', () => {
  assert.deepEqual(buildRestaurantRatingSummary([], [{ orderId: 'order-1', overallRating: null }]), { average: 0, count: 0 });
});