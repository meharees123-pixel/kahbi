const { normalizeWhatsappPhone } = require("./whatsapp");

const DEFAULT_GRAPH_API_VERSION = "v23.0";
const DEFAULT_BUSINESS_PHONE_NUMBER = "97431278062";
const DEFAULT_WABA_ID = "1053506627676876";

function whatsappConfiguration(env = process.env, phoneNumberId = env.WHATSAPP_PHONE_NUMBER_ID) {
  const graphVersion = env.WHATSAPP_GRAPH_API_VERSION || DEFAULT_GRAPH_API_VERSION;
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw configurationError("WHATSAPP_GRAPH_API_VERSION must use the format vNN.0.");
  }
  return {
    enabled: env.WHATSAPP_ENABLED === "true",
    testMode: env.WHATSAPP_TEST_MODE === "true",
    popupEnabled: env.WHATSAPP_TEST_POPUP_ENABLED === "true",
    graphVersion,
    wabaId: env.WHATSAPP_WABA_ID || DEFAULT_WABA_ID,
    phoneNumberId,
    businessPhoneNumber: normalizeWhatsappPhone(env.WHATSAPP_BUSINESS_PHONE_NUMBER || DEFAULT_BUSINESS_PHONE_NUMBER),
    accessToken: env.WHATSAPP_ACCESS_TOKEN || ""
  };
}

function configurationError(message, status = 503) {
  const error = new Error(message);
  error.status = status;
  error.expose = true;
  return error;
}

function requireWhatsAppEnabled(configuration, { testMessage = false } = {}) {
  if (!configuration.enabled) {
    throw configurationError("WhatsApp Cloud API is disabled. Set WHATSAPP_ENABLED=true on the backend.");
  }
  if (testMessage && !configuration.testMode) {
    throw configurationError("WhatsApp test messaging is disabled. Set WHATSAPP_TEST_MODE=true on the backend.", 403);
  }
  if (!configuration.accessToken) {
    throw configurationError("WhatsApp Cloud API is not configured. Set WHATSAPP_ACCESS_TOKEN on the backend.");
  }
  if (!configuration.wabaId) {
    throw configurationError("WhatsApp Cloud API is not configured. Set WHATSAPP_WABA_ID on the backend.");
  }
  if (!configuration.businessPhoneNumber) {
    throw configurationError("WHATSAPP_BUSINESS_PHONE_NUMBER must be a valid international phone number.");
  }
}

function providerError(response, body, accessToken) {
  const details = body?.error && typeof body.error === "object" ? body.error : {};
  const providerMessage = typeof details.message === "string" && details.message
    ? details.message
    : `Meta Graph API request failed (HTTP ${response.status}).`;
  const message = accessToken ? providerMessage.split(accessToken).join("[redacted]") : providerMessage;
  const error = configurationError(message, 502);
  error.providerResponse = {
    httpStatus: response.status,
    error: {
      message,
      type: typeof details.type === "string" ? details.type : undefined,
      code: Number.isFinite(details.code) ? details.code : undefined,
      errorSubcode: Number.isFinite(details.error_subcode) ? details.error_subcode : undefined,
      fbtraceId: typeof details.fbtrace_id === "string" ? details.fbtrace_id : undefined,
      userTitle: typeof details.error_user_title === "string" ? details.error_user_title : undefined,
      userMessage: typeof details.error_user_msg === "string" ? details.error_user_msg : undefined,
      transient: typeof details.is_transient === "boolean" ? details.is_transient : undefined
    }
  };
  return error;
}

async function graphRequest(path, { configuration, method = "GET", body } = {}) {
  let response;
  try {
    response = await fetch(`https://graph.facebook.com/${configuration.graphVersion}/${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Content-Type": "application/json"
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
  } catch (cause) {
    const error = configurationError(
      cause?.name === "TimeoutError"
        ? "Meta Graph API request timed out. Try again."
        : "Could not connect to Meta Graph API. Check the backend network and try again.",
      502
    );
    error.cause = cause;
    throw error;
  }

  let result;
  try {
    result = await response.json();
  } catch {
    result = {};
  }
  if (!response.ok) throw providerError(response, result, configuration.accessToken);
  return result;
}

async function getPhoneNumberSetup(configuration) {
  requireWhatsAppEnabled(configuration);
  const list = await graphRequest(
    `${encodeURIComponent(configuration.wabaId)}/phone_numbers?fields=id,display_phone_number,verified_name,code_verification_status,platform_type,status`,
    { configuration }
  );
  const phones = Array.isArray(list.data) ? list.data : [];
  const match = phones.find((phone) =>
    normalizeWhatsappPhone(phone.display_phone_number) === configuration.businessPhoneNumber
  );
  if (!match?.id) {
    return {
      phoneNumberId: null,
      phoneNumber: null,
      status: "NOT_FOUND",
      platformType: null,
      registrationComplete: false,
      phoneNumbers: phones.map(({ id, display_phone_number, verified_name, status, platform_type }) => ({
        id,
        displayPhoneNumber: display_phone_number,
        verifiedName: verified_name,
        status: status || "UNKNOWN",
        platformType: platform_type || null
      }))
    };
  }

  const details = await graphRequest(
    `${encodeURIComponent(match.id)}?fields=id,display_phone_number,verified_name,code_verification_status,platform_type,status`,
    { configuration }
  );
  const status = details.status || match.status || "UNKNOWN";
  return {
    phoneNumberId: String(details.id || match.id),
    phoneNumber: details.display_phone_number || match.display_phone_number || configuration.businessPhoneNumber,
    verifiedName: details.verified_name || match.verified_name || "",
    status,
    platformType: details.platform_type || match.platform_type || null,
    codeVerificationStatus: details.code_verification_status || match.code_verification_status || null,
    registrationComplete: status === "CONNECTED",
    phoneNumbers: []
  };
}

async function registerPhoneNumber(configuration, setup, pin) {
  if (setup.registrationComplete) {
    return {
      alreadyConnected: true,
      registrationResponse: null,
      setup
    };
  }
  if (typeof pin !== "string" || !/^\d{6}$/.test(pin)) {
    throw configurationError("Enter the six-digit WhatsApp two-step verification PIN.", 400);
  }
  let registrationResponse;
  try {
    registrationResponse = await graphRequest(
      `${encodeURIComponent(setup.phoneNumberId)}/register`,
      {
        configuration,
        method: "POST",
        body: { messaging_product: "whatsapp", pin }
      }
    );
  } catch (error) {
    error.message = error.message.split(pin).join("[redacted]");
    if (error.providerResponse?.error?.message) {
      error.providerResponse.error.message = error.providerResponse.error.message.split(pin).join("[redacted]");
    }
    throw error;
  }
  const verification = await getPhoneNumberDetails(configuration, setup.phoneNumberId);
  return {
    alreadyConnected: false,
    registrationResponse,
    setup: {
      ...setup,
      ...verification,
      registrationComplete: verification.status === "CONNECTED"
    }
  };
}

async function getPhoneNumberDetails(configuration, phoneNumberId) {
  const details = await graphRequest(
    `${encodeURIComponent(phoneNumberId)}?fields=id,display_phone_number,verified_name,code_verification_status,platform_type,status`,
    { configuration }
  );
  return {
    phoneNumberId: String(details.id || phoneNumberId),
    phoneNumber: details.display_phone_number || configuration.businessPhoneNumber,
    verifiedName: details.verified_name || "",
    status: details.status || "UNKNOWN",
    platformType: details.platform_type || null,
    codeVerificationStatus: details.code_verification_status || null
  };
}

function buildTestMessagePayload({ recipient, message, messageType = "text" }) {
  const phone = normalizeWhatsappPhone(recipient);
  if (!phone) throw configurationError("Enter a valid recipient WhatsApp number in international format.", 400);
  const to = phone.slice(1);
  if (messageType === "template") {
    return {
      to,
      templateName: "hello_world",
      payload: {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to,
        type: "template",
        template: { name: "hello_world", language: { code: "en_US" } }
      }
    };
  }
  if (messageType !== "text") {
    throw configurationError("Choose either a free-form text message or the approved hello_world template.", 400);
  }
  if (typeof message !== "string" || !message.trim() || message.length > 4096) {
    throw configurationError("Enter a message containing 1 to 4096 characters.", 400);
  }
  return {
    to,
    templateName: "MANUAL_TEST_TEXT",
    payload: {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to,
      type: "text",
      text: { preview_url: false, body: message.trim() }
    }
  };
}

async function sendTestMessage(configuration, phoneNumberId, request) {
  requireWhatsAppEnabled(configuration, { testMessage: true });
  if (!phoneNumberId || !/^\d+$/.test(String(phoneNumberId))) {
    throw configurationError("WhatsApp Phone Number ID is missing. Verify the Cloud API setup first.");
  }
  const message = buildTestMessagePayload(request);
  const providerResponse = await graphRequest(
    `${encodeURIComponent(phoneNumberId)}/messages`,
    { configuration: { ...configuration, phoneNumberId }, method: "POST", body: message.payload }
  );
  return {
    recipient: `+${message.to}`,
    templateName: message.templateName,
    messageId: providerResponse?.messages?.[0]?.id || null,
    providerResponse
  };
}

module.exports = {
  DEFAULT_GRAPH_API_VERSION,
  DEFAULT_BUSINESS_PHONE_NUMBER,
  DEFAULT_WABA_ID,
  whatsappConfiguration,
  requireWhatsAppEnabled,
  graphRequest,
  getPhoneNumberSetup,
  registerPhoneNumber,
  buildTestMessagePayload,
  sendTestMessage
};
