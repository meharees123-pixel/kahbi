const test = require("node:test");
const assert = require("node:assert/strict");
const {
  recoveryOtpTtlMs,
  validNewPassword,
  restaurantRecoveryStatus
} = require("../src/restaurant-recovery");

test("restaurant recovery OTP lifetime defaults to five minutes and is configurable", () => {
  assert.equal(recoveryOtpTtlMs({}), 5 * 60 * 1000);
  assert.equal(recoveryOtpTtlMs({ RECOVERY_OTP_TTL_MINUTES: "2" }), 2 * 60 * 1000);
  assert.throws(
    () => recoveryOtpTtlMs({ RECOVERY_OTP_TTL_MINUTES: "16" }),
    (error) => error.status === 503 && error.expose === true
  );
  assert.throws(
    () => recoveryOtpTtlMs({ RECOVERY_OTP_TTL_MINUTES: "2.5" }),
    (error) => error.status === 503 && error.expose === true
  );
});

test("restaurant recovery password policy requires safe length, a letter, and a number", () => {
  assert.equal(validNewPassword("Restaurant2026"), true);
  assert.equal(validNewPassword("short1"), false);
  assert.equal(validNewPassword("onlyletters"), false);
  assert.equal(validNewPassword("1234567890"), false);
  assert.equal(validNewPassword("A".repeat(201) + "1"), false);
  assert.equal(validNewPassword(null), false);
});

test("restaurant recovery status allows only approved active accounts", () => {
  const active = {
    user: { status: "ACTIVE" },
    restaurant: { status: "APPROVED" },
    registration: { status: "APPROVED", activatedAt: new Date() }
  };
  assert.equal(restaurantRecoveryStatus(active), "ACTIVE");
  assert.equal(restaurantRecoveryStatus({
    ...active,
    registration: { status: "UNDER_REVIEW", activatedAt: null }
  }), "PENDING_APPROVAL");
  assert.equal(restaurantRecoveryStatus({
    ...active,
    restaurant: { status: "SUSPENDED" }
  }), "ADMIN_ASSISTANCE");
  assert.equal(restaurantRecoveryStatus({
    ...active,
    user: { status: "DEACTIVATED" }
  }), "ADMIN_ASSISTANCE");
});
