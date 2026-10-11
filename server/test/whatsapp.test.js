const test = require("node:test");
const assert = require("node:assert/strict");
const {
  normalizeWhatsappPhone,
  customerPhoneQuery,
  hashOtp,
  matchesOtp,
  encryptWhatsappConfiguration,
  decryptWhatsappConfiguration,
  otpSigningSecret,
  resolveOtpSigningSecret,
  developmentOtpMode,
  whatsappOtpConfiguration,
  buildOtpTemplatePayload
} = require("../src/whatsapp");

test("WhatsApp phone numbers normalize to international E.164 format", () => {
  assert.equal(normalizeWhatsappPhone("+974 3086 7021"), "+97430867021");
  assert.equal(normalizeWhatsappPhone("0097430867021"), "+97430867021");
  assert.equal(normalizeWhatsappPhone("974-3086-7021"), "+97430867021");
  assert.equal(normalizeWhatsappPhone("phone"), null);
  assert.equal(normalizeWhatsappPhone("+01234567"), null);
  assert.equal(normalizeWhatsappPhone("+1234567"), null);
});

test("customer phone query matches stored international numbers with formatting", () => {
  const phonePattern = customerPhoneQuery("+97430867021");
  assert.equal(phonePattern.test("+974 3086 7021"), true);
  assert.equal(phonePattern.test("974-3086-7021"), true);
  assert.equal(phonePattern.test("+97430867022"), false);
});

test("OTP hashes are challenge-bound and compared without exposing the code", () => {
  const hash = hashOtp("challenge-a", "042915", "test-secret");
  assert.equal(matchesOtp("challenge-a", "042915", "test-secret", hash.toString("hex")), true);
  assert.equal(matchesOtp("challenge-b", "042915", "test-secret", hash.toString("hex")), false);
  assert.equal(matchesOtp("challenge-a", "042916", "test-secret", hash.toString("hex")), false);
});

test("admin WhatsApp credentials encrypt at rest and reject the wrong encryption key", () => {
  const secret = "test-encryption-secret-with-more-than-32-characters";
  const configuration = {
    WHATSAPP_ACCESS_TOKEN: "private-token",
    WHATSAPP_PHONE_NUMBER_ID: "123456789012345"
  };
  const encrypted = encryptWhatsappConfiguration(configuration, secret);
  assert.notEqual(encrypted.ciphertext, Buffer.from(JSON.stringify(configuration)).toString("hex"));
  assert.deepEqual(decryptWhatsappConfiguration(encrypted, secret), configuration);
  assert.throws(
    () => decryptWhatsappConfiguration(encrypted, `${secret}-wrong`),
    (error) => error.status === 503 && error.expose === true
  );
});

test("WhatsApp credential encryption rejects missing or weak encryption keys", () => {
  assert.throws(
    () => encryptWhatsappConfiguration({ WHATSAPP_ACCESS_TOKEN: "secret" }, "short"),
    (error) => error.status === 503 && error.expose === true && /WHATSAPP_CONFIG_ENCRYPTION_KEY/.test(error.message)
  );
});

test("OTP delivery can be disabled only in development and exposes the expected delivery mode", () => {
  assert.equal(developmentOtpMode(true, "production"), "WHATSAPP");
  assert.equal(developmentOtpMode(false, "development"), "DEVELOPMENT");
  assert.throws(
    () => developmentOtpMode(false, undefined),
    (error) => error.status === 403 && error.expose === true
  );
  assert.throws(
    () => developmentOtpMode(false, "production"),
    (error) => error.status === 403 && error.expose === true
  );
});

test("OTP signing secret is required and must be at least 32 characters", () => {
  assert.throws(
    () => otpSigningSecret({}),
    (error) => error.status === 503 && error.expose === true
  );
  assert.equal(otpSigningSecret({ OTP_SIGNING_SECRET: "a".repeat(32) }), "a".repeat(32));
});

test("local development can use an ephemeral OTP signing key when none is configured", () => {
  const first = resolveOtpSigningSecret({}, "development");
  const second = resolveOtpSigningSecret({}, "development");
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.notEqual(first, second);
  assert.equal(resolveOtpSigningSecret({ OTP_SIGNING_SECRET: "a".repeat(32) }, "development"), "a".repeat(32));
  assert.equal(resolveOtpSigningSecret({}, "production"), "");
});

test("WhatsApp Cloud OTP configuration rejects missing credentials and weak signing secrets", () => {
  assert.throws(
    () => whatsappOtpConfiguration({}),
    (error) => error.status === 503 && error.expose === true && /WHATSAPP_ACCESS_TOKEN/.test(error.message)
  );
  assert.throws(
    () => whatsappOtpConfiguration({
      WHATSAPP_ACCESS_TOKEN: "token",
      WHATSAPP_PHONE_NUMBER_ID: "phone-id",
      WHATSAPP_OTP_TEMPLATE: "kahbi_customer_otp",
      OTP_SIGNING_SECRET: "short"
    }),
    (error) => error.status === 503 && error.expose === true && /OTP_SIGNING_SECRET/.test(error.message)
  );
});

test("WhatsApp Cloud OTP payload uses the approved authentication template components", () => {
  const payload = buildOtpTemplatePayload("+97430867021", "042915", {
    templateName: "kahbi_customer_otp",
    language: "en_US"
  });
  assert.equal(payload.to, "97430867021");
  assert.equal(payload.template.name, "kahbi_customer_otp");
  assert.equal(payload.template.components[0].parameters[0].text, "042915");
  assert.equal(payload.template.components[1].parameters[0].text, "042915");
});
