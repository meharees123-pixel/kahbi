const test = require("node:test");
const assert = require("node:assert/strict");
const app = require("../src/app");
const {
  whatsappConfiguration,
  requireWhatsAppEnabled,
  graphRequest,
  getPhoneNumberSetup,
  registerPhoneNumber,
  buildTestMessagePayload,
  sendTestMessage
} = require("../src/whatsapp-cloud");

const configuredEnv = {
  WHATSAPP_ENABLED: "true",
  WHATSAPP_TEST_MODE: "true",
  WHATSAPP_TEST_POPUP_ENABLED: "true",
  WHATSAPP_GRAPH_API_VERSION: "v23.0",
  WHATSAPP_WABA_ID: "1053506627676876",
  WHATSAPP_BUSINESS_PHONE_NUMBER: "97431278062",
  WHATSAPP_PHONE_NUMBER_ID: "123456789012345",
  WHATSAPP_ACCESS_TOKEN: "test-token"
};

function mockFetch(handler) {
  const previous = global.fetch;
  global.fetch = handler;
  return () => { global.fetch = previous; };
}

test("Cloud API configuration requires backend credentials and enforces the test flag", () => {
  const configuration = whatsappConfiguration(configuredEnv);
  assert.equal(configuration.wabaId, "1053506627676876");
  assert.equal(configuration.phoneNumberId, "123456789012345");
  assert.doesNotThrow(() => requireWhatsAppEnabled(configuration, { testMessage: true }));
  assert.throws(
    () => requireWhatsAppEnabled(whatsappConfiguration({ ...configuredEnv, WHATSAPP_TEST_MODE: "false" }), { testMessage: true }),
    (error) => error.status === 403
  );
  assert.throws(
    () => requireWhatsAppEnabled(whatsappConfiguration({ ...configuredEnv, WHATSAPP_ACCESS_TOKEN: "" })),
    (error) => error.status === 503 && /WHATSAPP_ACCESS_TOKEN/.test(error.message)
  );
});

test("test message payload validates international recipients and text content", () => {
  assert.equal(buildTestMessagePayload({ recipient: "+974 5555 1212", message: " Hello " }).payload.text.body, "Hello");
  assert.equal(
    buildTestMessagePayload({ recipient: "55551212", messageType: "template" }).payload.template.name,
    "hello_world"
  );
  assert.throws(() => buildTestMessagePayload({ recipient: "bad", message: "hello" }), (error) => error.status === 400);
  assert.throws(() => buildTestMessagePayload({ recipient: "+97455551212", message: " " }), (error) => error.status === 400);
  assert.throws(() => buildTestMessagePayload({ recipient: "+97455551212", message: "hello", messageType: "unknown" }), (error) => error.status === 400);
});

test("setup finds the configured business number and reads its current registration status", async () => {
  const restore = mockFetch(async (url, options) => {
    if (url.endsWith("/1053506627676876/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,platform_type,status")) {
      return Response.json({ data: [{ id: "123456789012345", display_phone_number: "+974 3127 8062", status: "CONNECTED", platform_type: "CLOUD_API" }] });
    }
    assert.match(url, /\/123456789012345\?fields=/);
    assert.equal(options.headers.Authorization, "Bearer test-token");
    return Response.json({ id: "123456789012345", display_phone_number: "+974 3127 8062", status: "CONNECTED", platform_type: "CLOUD_API" });
  });
  try {
    const setup = await getPhoneNumberSetup(whatsappConfiguration(configuredEnv));
    assert.equal(setup.phoneNumberId, "123456789012345");
    assert.equal(setup.status, "CONNECTED");
    assert.equal(setup.platformType, "CLOUD_API");
    assert.equal(setup.registrationComplete, true);
  } finally {
    restore();
  }
});

test("registration sends only an administrator-provided PIN and avoids a repeated connected registration", async () => {
  const configuration = whatsappConfiguration(configuredEnv);
  let requests = 0;
  const restore = mockFetch(async (url, options) => {
    requests += 1;
    if (url.endsWith("/123456789012345/register")) {
      assert.equal(JSON.parse(options.body).pin, "183902");
      return Response.json({ success: true });
    }
    assert.match(url, /\/123456789012345\?fields=/);
    return Response.json({ id: "123456789012345", status: "CONNECTED", platform_type: "CLOUD_API" });
  });
  try {
    const setup = { phoneNumberId: "123456789012345", status: "PENDING", registrationComplete: false };
    const result = await registerPhoneNumber(configuration, setup, "183902");
    assert.deepEqual(result.registrationResponse, { success: true });
    assert.equal(result.setup.status, "CONNECTED");
    const existing = await registerPhoneNumber(configuration, { ...setup, status: "CONNECTED", registrationComplete: true }, "183902");
    assert.equal(existing.alreadyConnected, true);
    assert.equal(requests, 2);
  } finally {
    restore();
  }
});

test("registration provider errors never echo the two-step PIN", async () => {
  const configuration = whatsappConfiguration(configuredEnv);
  const restore = mockFetch(async () => Response.json({
    error: { message: "PIN 183902 is invalid.", type: "OAuthException", code: 100 }
  }, { status: 400 }));
  try {
    await assert.rejects(
      () => registerPhoneNumber(configuration, {
        phoneNumberId: "123456789012345",
        status: "PENDING",
        registrationComplete: false
      }, "183902"),
      (error) => !error.message.includes("183902") &&
        !JSON.stringify(error.providerResponse).includes("183902")
    );
  } finally {
    restore();
  }
});

test("send returns Meta message ID and does not expose the access token in provider errors", async () => {
  const configuration = whatsappConfiguration(configuredEnv);
  const restore = mockFetch(async (url, options) => {
    assert.match(url, /\/123456789012345\/messages$/);
    assert.equal(JSON.parse(options.body).to, "97455551212");
    return Response.json({ messages: [{ id: "wamid.test-123" }] });
  });
  try {
    const result = await sendTestMessage(configuration, configuration.phoneNumberId, {
      recipient: "+97455551212",
      message: "Manual test"
    });
    assert.equal(result.messageId, "wamid.test-123");
    assert.equal(result.recipient, "+97455551212");
  } finally {
    restore();
  }

  const restoreError = mockFetch(async () => Response.json({
    error: { message: "Invalid OAuth access token.", type: "OAuthException", code: 190, fbtrace_id: "trace-safe" }
  }, { status: 401 }));
  try {
    await assert.rejects(
      () => graphRequest("123456789012345/messages", { configuration, method: "POST", body: {} }),
      (error) => error.providerResponse.error.code === 190 &&
        error.providerResponse.error.fbtraceId === "trace-safe" &&
        !JSON.stringify(error.providerResponse).includes("test-token")
    );
  } finally {
    restoreError();
  }

  const restorePermissionError = mockFetch(async () => Response.json({
    error: { message: "Permission denied.", type: "OAuthException", code: 10, error_subcode: 200 }
  }, { status: 403 }));
  try {
    await assert.rejects(
      () => graphRequest("123456789012345/messages", { configuration, method: "POST", body: {} }),
      (error) => error.providerResponse.httpStatus === 403 &&
        error.providerResponse.error.code === 10 &&
        error.providerResponse.error.errorSubcode === 200
    );
  } finally {
    restorePermissionError();
  }
});

test("WhatsApp setup, registration, popup configuration, and send routes reject unauthenticated requests", async (t) => {
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  t.after(() => new Promise((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  }));
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/whatsapp`;
  const requests = [
    fetch(`${baseUrl}/test-popup-config`),
    fetch(`${baseUrl}/setup`, { method: "POST" }),
    fetch(`${baseUrl}/register`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ pin: "123456" }) }),
    fetch(`${baseUrl}/send-test-message`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ recipient: "+97455551212", message: "test" }) })
  ];
  for (const response of await Promise.all(requests)) {
    assert.equal(response.status, 401);
    assert.equal((await response.json()).error, "Sign in to continue.");
  }
});
