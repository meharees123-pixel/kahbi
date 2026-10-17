function buildRestaurantRatingSummary(legacyRatings = [], feedbackEntries = []) {
  const ratingsByOrder = new Map();
  const addValidRatings = (entries, field, overwrite) => {
    for (const entry of entries) {
      const rating = entry?.[field];
      if (!entry?.orderId || typeof rating !== 'number' || !Number.isFinite(rating) || rating < 1 || rating > 5) continue;
      const orderId = String(entry.orderId);
      if (overwrite || !ratingsByOrder.has(orderId)) ratingsByOrder.set(orderId, rating);
    }
  };

  addValidRatings(legacyRatings, 'stars', false);
  addValidRatings(feedbackEntries, 'overallRating', true);

  const values = [...ratingsByOrder.values()];
  return {
    average: values.length ? Math.round((values.reduce((sum, rating) => sum + rating, 0) / values.length + Number.EPSILON) * 100) / 100 : 0,
    count: values.length
  };
}

module.exports = { buildRestaurantRatingSummary };