const test = require('node:test');
const assert = require('node:assert/strict');

const { validateFeedbackSubmission, buildFeedbackSummary, posixDateBucket, attachFeedbackToOrders } = require('../src/feedback');

test('feedback validation enforces a required overall score and optional secondary fields', () => {
  assert.doesNotThrow(() => validateFeedbackSubmission({
    overallRating: 5,
    foodRating: 4,
    deliveryRating: 5,
    comment: 'Fast and tidy service.'
  }));

  assert.throws(() => validateFeedbackSubmission({ overallRating: 0 }), /overallRating/i);
  assert.throws(() => validateFeedbackSubmission({ overallRating: 5, foodRating: 6 }), /foodRating/i);
  assert.throws(() => validateFeedbackSubmission({ overallRating: 5, deliveryRating: 0 }), /deliveryRating/i);
});

test('feedback summary computes averages and trend buckets without mutating input', () => {
  const entries = [
    { overallRating: 5, foodRating: 5, deliveryRating: 4, comment: 'Amazing', submittedAt: '2026-10-01T12:00:00.000Z' },
    { overallRating: 4, foodRating: 3, deliveryRating: 5, comment: 'Good', submittedAt: '2026-10-02T12:00:00.000Z' },
    { overallRating: 3, foodRating: 4, deliveryRating: 3, comment: 'Fine', submittedAt: '2026-10-02T18:00:00.000Z' }
  ];

  const summary = buildFeedbackSummary(entries);
  assert.equal(summary.totalFeedback, 3);
  assert.equal(summary.averageOverallRating, 4);
  assert.equal(summary.averageFoodRating, 4);
  assert.equal(summary.averageDeliveryRating, 4);
  assert.equal(summary.trend.length, 2);
  assert.ok(summary.trend.every((point) => typeof point.bucket === 'string'));
  assert.equal(posixDateBucket(new Date('2026-10-02T18:00:00.000Z')), '2026-10-02');
});

test('feedback is attached only to the matching order and restaurant', () => {
  const orders = [
    { _id: 'order-1', restaurantId: 'restaurant-a' },
    { _id: 'order-2', restaurantId: 'restaurant-a' }
  ];
  const feedback = [
    { orderId: 'order-1', restaurantId: 'restaurant-a', overallRating: 5 },
    { orderId: 'order-2', restaurantId: 'restaurant-b', overallRating: 1 }
  ];

  const result = attachFeedbackToOrders(orders, feedback);
  assert.equal(result[0].feedback.overallRating, 5);
  assert.equal(result[1].feedback, null);
});
