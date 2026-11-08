const { customerPhoneQuery, normalizeWhatsappPhone } = require("./whatsapp");

const CUSTOMER_TEST_AUTH_METHOD = "customer_test_phone";
const TEST_ENVIRONMENTS = new Set(["development", "test", "staging"]);

function customerOtpConfiguration(env = process.env) {
  const rawValue = env.CUSTOMER_OTP_ENABLED;
  const normalizedValue = rawValue === undefined ? "true" : String(rawValue).trim().toLowerCase();
  if (!["true", "false"].includes(normalizedValue)) {
    throw new Error("CUSTOMER_OTP_ENABLED must be set to true or false.");
  }
  const otpEnabled = normalizedValue === "true";
  const nodeEnv = String(env.NODE_ENV || "").trim().toLowerCase();
  if (!otpEnabled && !TEST_ENVIRONMENTS.has(nodeEnv)) {
    throw new Error("Customer phone-only login is permitted only in development, test, or staging environments.");
  }
  return {
    otpEnabled,
    phoneOnlyLoginEnabled: !otpEnabled
  };
}

function assertCustomerOtpConfiguration(env = process.env) {
  try {
    return customerOtpConfiguration(env);
  } catch (error) {
    error.status = 500;
    error.expose = false;
    throw error;
  }
}

function customerAuthMethodAllowed(authMethod, env = process.env) {
  if (authMethod === "firebase_phone") return true;
  return authMethod === CUSTOMER_TEST_AUTH_METHOD &&
    customerOtpConfiguration(env).phoneOnlyLoginEnabled;
}

function createCustomerPhoneBypassService({
  UserModel,
  issueToken,
  writeAudit,
  env = process.env
}) {
  return async function loginWithPhoneOnly(phoneInput) {
    const configuration = customerOtpConfiguration(env);
    if (!configuration.phoneOnlyLoginEnabled) {
      const error = new Error("Phone-only customer login is disabled.");
      error.status = 403;
      error.expose = true;
      throw error;
    }

    const phone = normalizeWhatsappPhone(phoneInput);
    if (!phone) {
      const error = new Error("Enter a valid phone number in international format, including country code.");
      error.status = 400;
      error.expose = true;
      throw error;
    }

    const user = await UserModel.findOne({
      role: "CUSTOMER",
      phone: customerPhoneQuery(phone)
    });
    if (!user || user.status !== "ACTIVE") {
      const error = new Error("We couldn't sign you in with that number. Check the number or use phone verification.");
      error.status = 401;
      error.expose = true;
      throw error;
    }

    await writeAudit({
      user,
      action: "CUSTOMER_TEST_PHONE_LOGIN",
      entity: "User",
      entityId: user._id,
      details: { authMethod: CUSTOMER_TEST_AUTH_METHOD }
    });
    return {
      token: issueToken(user, CUSTOMER_TEST_AUTH_METHOD),
      user
    };
  };
}

module.exports = {
  CUSTOMER_TEST_AUTH_METHOD,
  assertCustomerOtpConfiguration,
  customerAuthMethodAllowed,
  createCustomerPhoneBypassService,
  customerOtpConfiguration
};
