const transitions = {
  RESTAURANT_PENDING: ["ACCEPTED", "REJECTED", "AUTO_REJECTED", "CANCELLED"],
  ACCEPTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY"],
  READY: ["OUT_FOR_DELIVERY"],
  OUT_FOR_DELIVERY: ["DELIVERED"],
  DELIVERED: ["CLOSED"],
  REJECTED: [],
  AUTO_REJECTED: [],
  CANCELLED: [],
  CLOSED: []
};

function canTransition(from, to) {
  return (transitions[from] || []).includes(to);
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const radians = (degrees) => (degrees * Math.PI) / 180;
  const dLat = radians(lat2 - lat1);
  const dLon = radians(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(lat1)) * Math.cos(radians(lat2)) * Math.sin(dLon / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function isValidCoordinate(value, min, max) {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isValidServiceRadius(value) {
  return Number.isFinite(value) && value >= 0.5 && value <= 100;
}

function isWithinServiceArea(latitude, longitude, restaurantLatitude, restaurantLongitude, radiusKm) {
  if (!isValidCoordinate(latitude, -90, 90) ||
      !isValidCoordinate(longitude, -180, 180) ||
      !isValidCoordinate(restaurantLatitude, -90, 90) ||
      !isValidCoordinate(restaurantLongitude, -180, 180) ||
      !isValidServiceRadius(radiusKm)) return false;
  return haversineKm(latitude, longitude, restaurantLatitude, restaurantLongitude) <= radiusKm;
}

module.exports = { canTransition, haversineKm, isValidCoordinate, isValidServiceRadius, isWithinServiceArea };
