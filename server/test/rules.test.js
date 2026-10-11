const test = require("node:test");
const assert = require("node:assert/strict");
const { canTransition, haversineKm, isValidCoordinate, isValidServiceRadius, isWithinServiceArea } = require("../src/rules");

test("order state machine allows only forward operational transitions", () => {
  assert.equal(canTransition("RESTAURANT_PENDING", "ACCEPTED"), true);
  assert.equal(canTransition("READY", "OUT_FOR_DELIVERY"), true);
  assert.equal(canTransition("CLOSED", "PREPARING"), false);
  assert.equal(canTransition("REJECTED", "ACCEPTED"), false);
});

test("service-area distance is calculated in kilometres", () => {
  assert.ok(haversineKm(25.3212, 51.531, 25.3212, 51.531) < 0.001);
  assert.ok(haversineKm(25.3212, 51.531, 25.4, 51.531) > 8);
});

test("coordinate validation rejects out-of-range and non-numeric values", () => {
  assert.equal(isValidCoordinate(25.3, -90, 90), true);
  assert.equal(isValidCoordinate(91, -90, 90), false);
  assert.equal(isValidCoordinate(Number.NaN, -180, 180), false);
});

test("delivery radius accepts only the supported kilometre range", () => {
  assert.equal(isValidServiceRadius(0.5), true);
  assert.equal(isValidServiceRadius(100), true);
  assert.equal(isValidServiceRadius(0.49), false);
  assert.equal(isValidServiceRadius(100.01), false);
  assert.equal(isValidServiceRadius(Number.NaN), false);
});

test("delivery area includes its exact boundary and rejects locations outside it", () => {
  const boundaryDistance = haversineKm(25.2854, 51.531, 25.2854, 51.541);
  assert.equal(isWithinServiceArea(25.2854, 51.541, 25.2854, 51.531, boundaryDistance), true);
  assert.equal(isWithinServiceArea(25.2854, 51.541, 25.2854, 51.531, boundaryDistance - 0.001), false);
  assert.equal(isWithinServiceArea(91, 51.541, 25.2854, 51.531, 5), false);
});
