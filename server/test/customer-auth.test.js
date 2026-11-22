const test = require("node:test");
const assert = require("node:assert/strict");
const {
  CUSTOMER_TEST_AUTH_METHOD,
  customerAuthMethodAllowed,
  createCustomerPhoneBypassService,
  customerOtpConfiguration
} = require("../src/customer-auth");

test("customer OTP is enabled by default and phone-only login is limited to non-production environments", () => {
  assert.deepEqual(customerOtpConfiguration({}), {
    otpEnabled: true,
    phoneOnlyLoginEnabled: false
  });
  assert.deepEqual(customerOtpConfiguration({
    CUSTOMER_OTP_ENABLED: "false",
    NODE_ENV: "development"
  }), {
    otpEnabled: false,
    phoneOnlyLoginEnabled: true
  });
  assert.equal(customerOtpConfiguration({
    CUSTOMER_OTP_ENABLED: "false",
    NODE_ENV: "staging"
  }).phoneOnlyLoginEnabled, true);
  assert.throws(() => customerOtpConfiguration({
    CUSTOMER_OTP_ENABLED: "false",
    NODE_ENV: "production"
  }), /only in development, test, or staging/);
  assert.throws(() => customerOtpConfiguration({
    CUSTOMER_OTP_ENABLED: "false"
  }), /only in development, test, or staging/);
  assert.throws(() => customerOtpConfiguration({
    CUSTOMER_OTP_ENABLED: "sometimes",
    NODE_ENV: "development"
  }), /must be set to true or false/);
  assert.equal(customerAuthMethodAllowed("firebase_phone", {
    CUSTOMER_OTP_ENABLED: "true",
    NODE_ENV: "production"
  }), true);
  assert.equal(customerAuthMethodAllowed(CUSTOMER_TEST_AUTH_METHOD, {
    CUSTOMER_OTP_ENABLED: "false",
    NODE_ENV: "development"
  }), true);
  assert.equal(customerAuthMethodAllowed(CUSTOMER_TEST_AUTH_METHOD, {
    CUSTOMER_OTP_ENABLED: "true",
    NODE_ENV: "development"
  }), false);
});

test("phone-only login finds an existing customer, audits access, and uses a distinct JWT auth method", async () => {
  const calls = { queries: [], audits: [], tokens: [] };
  const user = {
    _id: "customer-1",
    role: "CUSTOMER",
    status: "ACTIVE",
    phone: "+97450000001"
  };
  const login = createCustomerPhoneBypassService({
    UserModel: {
      findOne: async (query) => {
        calls.queries.push(query);
        return user;
      }
    },
    issueToken: (selectedUser, method) => {
      calls.tokens.push({ selectedUser, method });
      return "signed-test-token";
    },
    writeAudit: async (entry) => calls.audits.push(entry),
    env: { CUSTOMER_OTP_ENABLED: "false", NODE_ENV: "development" }
  });

  const result = await login("+974 5000 0001");
  assert.equal(result.user, user);
  assert.equal(result.token, "signed-test-token");
  assert.equal(calls.queries.length, 1);
  assert.equal(calls.queries[0].role, "CUSTOMER");
  assert.ok(calls.queries[0].phone.test("+97450000001"));
  assert.equal(calls.tokens[0].method, CUSTOMER_TEST_AUTH_METHOD);
  assert.equal(calls.audits[0].action, "CUSTOMER_TEST_PHONE_LOGIN");
  assert.deepEqual(calls.audits[0].details, { authMethod: CUSTOMER_TEST_AUTH_METHOD });
});

test("phone-only login validates international numbers before lookup", async () => {
  let lookupCalled = false;
  const login = createCustomerPhoneBypassService({
    UserModel: { findOne: async () => { lookupCalled = true; return null; } },
    issueToken: () => "unused",
    writeAudit: async () => {},
    env: { CUSTOMER_OTP_ENABLED: "false", NODE_ENV: "development" }
  });

  await assert.rejects(login("not a phone"), (error) => error.status === 400);
  assert.equal(lookupCalled, false);
});

test("missing and unavailable accounts have the same generic phone-only login response", async () => {
  const createLogin = (user) => createCustomerPhoneBypassService({
    UserModel: { findOne: async () => user },
    issueToken: () => "unused",
    writeAudit: async () => {},
    env: { CUSTOMER_OTP_ENABLED: "false", NODE_ENV: "development" }
  });
  const errors = [];
  for (const user of [null, { _id: "customer-2", role: "CUSTOMER", status: "SUSPENDED" }]) {
    await assert.rejects(createLogin(user)("+97450000002"), (error) => {
      errors.push({ status: error.status, message: error.message });
      return error.status === 401;
    });
  }
  assert.deepEqual(errors[0], errors[1]);
});

test("phone-only login is rejected while OTP is enabled", async () => {
  let lookupCalled = false;
  const login = createCustomerPhoneBypassService({
    UserModel: { findOne: async () => { lookupCalled = true; return null; } },
    issueToken: () => "unused",
    writeAudit: async () => {},
    env: { CUSTOMER_OTP_ENABLED: "true", NODE_ENV: "development" }
  });
  await assert.rejects(login("+97450000003"), (error) => error.status === 403);
  assert.equal(lookupCalled, false);
});
