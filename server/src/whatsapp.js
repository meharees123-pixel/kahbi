const crypto = require("crypto");

function normalizeWhatsappPhone(value) {
  if (typeof value !== "string") return null;
  let phone = value.trim().replace(/[().\s-]/g, "");
  if (phone.startsWith("00")) phone = `+${phone.slice(2)}`;
  if (!phone.startsWith("+")) phone = `+${phone}`;
  return /^\+[1-9]\d{7,14}$/.test(phone) ? phone : null;
}

function customerPhoneQuery(phone) {
  const digits = phone.slice(1);
  return new RegExp(`^\\+?\\s*${digits.split("").join("[\\s().-]*")}$`);
}

function hashOtp(challengeId, code, secret) {
  return crypto.createHmac("sha256", secret).update(`${challengeId}:${code}`).digest();
}

function matchesOtp(challengeId, code, secret, expectedHash) {
  const suppliedHash = hashOtp(challengeId, code, secret);
  const storedHash = Buffer.from(expectedHash, "hex");
  return storedHash.length === suppliedHash.length && crypto.timingSafeEqual(storedHash, suppliedHash);
}

function encryptWhatsappConfiguration(configuration, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    const error = new Error("Set WHATSAPP_CONFIG_ENCRYPTION_KEY to a random value of at least 32 characters before saving WhatsApp settings.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = crypto.scryptSync(secret, salt, 32);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(configuration), "utf8"), cipher.final()]);
  return {
    salt: salt.toString("hex"),
    iv: iv.toString("hex"),
    authTag: cipher.getAuthTag().toString("hex"),
    ciphertext: ciphertext.toString("hex")
  };
}

function decryptWhatsappConfiguration(encrypted, secret) {
  if (typeof secret !== "string" || secret.length < 32) {
    const error = new Error("Set WHATSAPP_CONFIG_ENCRYPTION_KEY to the same random value used to save WhatsApp settings.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  try {
    const salt = Buffer.from(encrypted.salt, "hex");
    const iv = Buffer.from(encrypted.iv, "hex");
    const key = crypto.scryptSync(secret, salt, 32);
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(Buffer.from(encrypted.authTag, "hex"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(encrypted.ciphertext, "hex")),
      decipher.final()
    ]).toString("utf8");
    return JSON.parse(plaintext);
  } catch (_error) {
    const error = new Error("Saved WhatsApp settings could not be decrypted. Check that WHATSAPP_CONFIG_ENCRYPTION_KEY has not changed.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
}

function otpSigningSecret(env = process.env) {
  if (!env.OTP_SIGNING_SECRET || env.OTP_SIGNING_SECRET.length < 32) {
    const error = new Error("WhatsApp OTP is not configured. Set OTP_SIGNING_SECRET to a random value of at least 32 characters.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  return env.OTP_SIGNING_SECRET;
}

function resolveOtpSigningSecret(env = process.env, nodeEnv = process.env.NODE_ENV) {
  if (typeof env.OTP_SIGNING_SECRET === "string" && env.OTP_SIGNING_SECRET.length >= 32) {
    return env.OTP_SIGNING_SECRET;
  }
  return nodeEnv === "development" ? crypto.randomBytes(32).toString("hex") : env.OTP_SIGNING_SECRET || "";
}

function developmentOtpMode(deliveryEnabled, nodeEnv = process.env.NODE_ENV) {
  if (deliveryEnabled) return "WHATSAPP";
  if (nodeEnv !== "development") {
    const error = new Error("Development OTP display is only allowed when NODE_ENV=development. Enable WhatsApp delivery to send verification codes.");
    error.status = 403;
    error.expose = true;
    throw error;
  }
  return "DEVELOPMENT";
}

function whatsappOtpConfiguration(env = process.env) {
  const configuration = {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID,
    templateName: env.WHATSAPP_OTP_TEMPLATE,
    language: env.WHATSAPP_OTP_LANGUAGE || "en_US",
    graphVersion: env.WHATSAPP_GRAPH_API_VERSION || "v23.0"
  };
  if (!configuration.accessToken || !configuration.phoneNumberId || !configuration.templateName) {
    const error = new Error("WhatsApp OTP is not configured. Set WHATSAPP_ACCESS_TOKEN, WHATSAPP_PHONE_NUMBER_ID, and WHATSAPP_OTP_TEMPLATE.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  if (!/^v\d+\.\d+$/.test(configuration.graphVersion)) {
    const error = new Error("WHATSAPP_GRAPH_API_VERSION must use the format vNN.0.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  otpSigningSecret(env);
  return configuration;
}

function buildOtpTemplatePayload(phone, code, configuration) {
  return {
    messaging_product: "whatsapp",
    recipient_type: "individual",
    to: phone.slice(1),
    type: "template",
    template: {
      name: configuration.templateName,
      language: { code: configuration.language },
      components: [
        { type: "body", parameters: [{ type: "text", text: code }] },
        {
          type: "button",
          sub_type: "url",
          index: "0",
          parameters: [{ type: "text", text: code }]
        }
      ]
    }
  };
}

async function sendWhatsappOtp(phone, code, env = process.env) {
  const configuration = whatsappOtpConfiguration(env);
  const response = await fetch(
    `https://graph.facebook.com/${configuration.graphVersion}/${configuration.phoneNumberId}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${configuration.accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(buildOtpTemplatePayload(phone, code, configuration)),
      signal: AbortSignal.timeout(10000)
    }
  );
  if (!response.ok) {
    const error = new Error(`WhatsApp provider rejected the OTP message (HTTP ${response.status}).`);
    error.status = 502;
    error.expose = true;
    throw error;
  }
}

module.exports = {
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
  buildOtpTemplatePayload,
  sendWhatsappOtp
};
