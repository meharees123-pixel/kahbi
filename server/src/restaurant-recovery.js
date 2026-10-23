function recoveryOtpTtlMs(env = process.env) {
  const configuredMinutes = env.RECOVERY_OTP_TTL_MINUTES === undefined
    ? 5
    : Number(env.RECOVERY_OTP_TTL_MINUTES);
  if (!Number.isInteger(configuredMinutes) || configuredMinutes < 1 || configuredMinutes > 15) {
    const error = new Error("RECOVERY_OTP_TTL_MINUTES must be a whole number from 1 to 15.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return configuredMinutes * 60 * 1000;
}

function validNewPassword(password) {
  return typeof password === "string" &&
    password.length >= 10 &&
    password.length <= 200 &&
    /[A-Za-z]/.test(password) &&
    /\d/.test(password);
}

function restaurantRecoveryStatus({ user, restaurant, registration, ambiguous }) {
  if (ambiguous) return "ADMIN_ASSISTANCE";
  if (registration?.status === "SUSPENDED" ||
      user?.status === "SUSPENDED" ||
      user?.status === "DEACTIVATED" ||
      restaurant?.status === "SUSPENDED" ||
      restaurant?.status === "REJECTED") {
    return "ADMIN_ASSISTANCE";
  }
  if (registration && ["PENDING_VERIFICATION", "UNDER_REVIEW"].includes(registration.status)) {
    return "PENDING_APPROVAL";
  }
  if (restaurant?.status === "PENDING_REVIEW") return "PENDING_APPROVAL";
  if (registration?.status === "APPROVED" && !registration.activatedAt) return "PENDING_APPROVAL";
  if (!user || user.status !== "ACTIVE" || !restaurant || restaurant.status !== "APPROVED") {
    return "ADMIN_ASSISTANCE";
  }
  if (registration && registration.status !== "APPROVED") return "ADMIN_ASSISTANCE";
  return "ACTIVE";
}

module.exports = { recoveryOtpTtlMs, validNewPassword, restaurantRecoveryStatus };
