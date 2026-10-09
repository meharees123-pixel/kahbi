const test = require("node:test");
const assert = require("node:assert/strict");
const { canTransition, haversineKm, isValidCoordinate } = require("../src/rules");

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
