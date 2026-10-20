function normalizeOptionalStar(value, fieldName) {
  if (value === undefined || value === null || value === '') return null;
  const normalisedValue = Number(value);
  if (!Number.isInteger(normalisedValue) || normalisedValue < 1 || normalisedValue > 5) {
    throw new Error(`${fieldName} must be a whole number between 1 and 5 when provided.`);
  }
  return normalisedValue;
}

function validateFeedbackSubmission(payload = {}) {
  const overallRating = Number(payload.overallRating);
  if (!Number.isInteger(overallRating) || overallRating < 1 || overallRating > 5) {
    throw new Error('overallRating is required and must be between 1 and 5.');
  }
  const foodRating = normalizeOptionalStar(payload.foodRating, 'foodRating');
  const deliveryRating = normalizeOptionalStar(payload.deliveryRating, 'deliveryRating');
  const comment = typeof payload.comment === 'string' ? payload.comment.trim() : '';
  if (comment.length > 500) {
    throw new Error('comment must be 500 characters or fewer.');
  }
  return {
    overallRating,
    foodRating,
    deliveryRating,
    comment
  };
}

function posixDateBucket(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString().slice(0, 10);
}

function attachFeedbackToOrders(orders = [], entries = []) {
  const feedbackByRestaurantAndOrder = new Map();
  for (const entry of entries) {
    if (!entry?.orderId || !entry?.restaurantId) continue;
    const key = `${String(entry.restaurantId)}:${String(entry.orderId)}`;
    if (!feedbackByRestaurantAndOrder.has(key)) feedbackByRestaurantAndOrder.set(key, entry);
  }
  return orders.map((order) => ({
    ...order,
    feedback: feedbackByRestaurantAndOrder.get(`${String(order.restaurantId)}:${String(order._id)}`) || null
  }));
}

function buildFeedbackSummary(entries = []) {
  const validEntries = Array.isArray(entries) ? entries.filter(Boolean) : [];
  if (!validEntries.length) {
    return {
      totalFeedback: 0,
      averageOverallRating: 0,
      averageFoodRating: 0,
      averageDeliveryRating: 0,
      trend: []
    };
  }

  const overall = validEntries.map((entry) => Number(entry.overallRating || 0)).filter((value) => Number.isFinite(value));
  const food = validEntries.map((entry) => Number(entry.foodRating || 0)).filter((value) => Number.isFinite(value) && value > 0);
  const delivery = validEntries.map((entry) => Number(entry.deliveryRating || 0)).filter((value) => Number.isFinite(value) && value > 0);

  const grouped = new Map();
  for (const entry of validEntries) {
    const bucket = posixDateBucket(entry.submittedAt || entry.createdAt || new Date());
    if (!bucket) continue;
    const current = grouped.get(bucket) || { totalOverall: 0, count: 0 };
    current.totalOverall += Number(entry.overallRating || 0);
    current.count += 1;
    grouped.set(bucket, current);
  }

  const trend = [...grouped.entries()].sort(([left], [right]) => left.localeCompare(right)).map(([bucket, value]) => ({
    bucket,
    averageOverallRating: Number((value.totalOverall / value.count).toFixed(2)),
    count: value.count
  }));

  return {
    totalFeedback: validEntries.length,
    averageOverallRating: overall.length ? Number((overall.reduce((sum, value) => sum + value, 0) / overall.length).toFixed(2)) : 0,
    averageFoodRating: food.length ? Number((food.reduce((sum, value) => sum + value, 0) / food.length).toFixed(2)) : 0,
    averageDeliveryRating: delivery.length ? Number((delivery.reduce((sum, value) => sum + value, 0) / delivery.length).toFixed(2)) : 0,
    trend
  };
}

module.exports = {
  validateFeedbackSubmission,
  posixDateBucket,
  buildFeedbackSummary,
  attachFeedbackToOrders
};
