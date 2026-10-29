const nodemailer = require("nodemailer");
const { EmailNotification } = require("./models");
const { renderEmail } = require("./email-templates");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = [60_000, 5 * 60_000, 15 * 60_000, 60 * 60_000, 6 * 60 * 60_000];
const CLAIM_TIMEOUT_MS = 60_000;

function emailConfiguration(env) {
  const port = Number(env.SMTP_PORT || 587);
  const secure = String(env.SMTP_SECURE || (port === 465 ? "true" : "false")).toLowerCase() === "true";
  const from = String(env.EMAIL_FROM || env.SMTP_USER || env.ADMIN_NOTIFICATION_EMAIL || "").trim();
  const fromName = String(env.EMAIL_FROM_NAME || "KABHI").replace(/[\r\n\x00-\x1f\x7f]/g, " ").trim();
  let pass = String(env.SMTP_PASS || "").trim();
  if (/^[a-z0-9]{4}(\s+[a-z0-9]{4}){3}$/i.test(pass) || (env.SMTP_HOST && /gmail/i.test(env.SMTP_HOST))) {
    pass = pass.replace(/\s+/g, "");
  }
  if (!env.SMTP_HOST || !Number.isInteger(port) || port < 1 || port > 65535 ||
      !env.SMTP_USER || !pass || !EMAIL_PATTERN.test(from) || !fromName) {
    const error = new Error("SMTP email delivery is not fully configured.");
    error.code = "SMTP_NOT_CONFIGURED";
    throw error;
  }
  return {
    host: env.SMTP_HOST,
    port,
    secure,
    auth: { user: env.SMTP_USER, pass },
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
    from: { name: fromName, address: from }
  };
}

function createEmailNotificationService({
  model = EmailNotification,
  env = process.env,
  logger = console,
  now = () => new Date(),
  sendMail
} = {}) {
  let transport;
  let processing = false;

  function mailSender() {
    if (sendMail) return sendMail;
    const configuration = emailConfiguration(env);
    if (!transport) {
      transport = nodemailer.createTransport({
        host: configuration.host,
        port: configuration.port,
        secure: configuration.secure,
        auth: configuration.auth,
        connectionTimeout: configuration.connectionTimeout,
        greetingTimeout: configuration.greetingTimeout,
        socketTimeout: configuration.socketTimeout
      });
    }
    return (message) => transport.sendMail(message);
  }

  async function enqueue({ eventKey, eventType, restaurantId = null, recipient, data }) {
    if (!EMAIL_PATTERN.test(String(recipient || "").trim())) {
      logger.warn("Email notification skipped: no valid stored recipient.", {
        eventType,
        restaurantId: restaurantId ? String(restaurantId) : null
      });
      return false;
    }
    const { subject, text, html } = renderEmail(eventType, data);
    try {
      const result = await model.updateOne(
        { eventKey },
        {
          $setOnInsert: {
            eventKey,
            eventType,
            restaurantId,
            recipient: String(recipient).trim().toLowerCase(),
            subject,
            text,
            html,
            status: "QUEUED",
            attempts: 0,
            nextAttemptAt: now()
          }
        },
        { upsert: true, runValidators: true }
      );
      if (result.upsertedCount) setImmediate(() => processPending().catch((error) => {
        logger.error("Email notification worker failed.", { errorName: error.name, errorCode: error.code });
      }));
      return Boolean(result.upsertedCount);
    } catch (error) {
      logger.error("Could not enqueue email notification.", {
        eventType,
        restaurantId: restaurantId ? String(restaurantId) : null,
        errorName: error.name,
        errorCode: error.code
      });
      return false;
    }
  }

  async function processPending(limit = 10) {
    if (processing) return 0;
    processing = true;
    let processed = 0;
    try {
      if (!sendMail) {
        try {
          emailConfiguration(env);
        } catch (configError) {
          logger.warn("Email notification processing deferred: SMTP is not configured.", {
            errorCode: configError.code
          });
          return 0;
        }
      }
      for (let index = 0; index < limit; index += 1) {
        const currentTime = now();
        const notification = await model.findOneAndUpdate(
          {
            $or: [
              { status: "QUEUED", nextAttemptAt: { $lte: currentTime } },
              { status: "SENDING", lockUntil: { $lte: currentTime } }
            ]
          },
          {
            $set: { status: "SENDING", lockUntil: new Date(currentTime.getTime() + CLAIM_TIMEOUT_MS) },
            $inc: { attempts: 1 }
          },
          { new: true, sort: { createdAt: 1 } }
        );
        if (!notification) break;
        processed += 1;
        try {
          const configuration = emailConfiguration(env);
          const send = mailSender();
          const result = await send({
            from: configuration.from,
            to: notification.recipient,
            subject: notification.subject,
            text: notification.text,
            html: notification.html,
            messageId: `<${Buffer.from(notification.eventKey).toString("hex").slice(0, 32)}@kahbi.com>`
          });
          await model.updateOne(
            { _id: notification._id, status: "SENDING" },
            {
              $set: {
                status: "SENT",
                sentAt: now(),
                providerMessageId: String(result?.messageId || "").slice(0, 255),
                lastError: "",
                lockUntil: null
              }
            }
          );
        } catch (error) {
          const failedAt = now();
          const exhausted = notification.attempts >= MAX_ATTEMPTS;
          const delay = RETRY_DELAYS_MS[Math.min(notification.attempts - 1, RETRY_DELAYS_MS.length - 1)];
          await model.updateOne(
            { _id: notification._id, status: "SENDING" },
            {
              $set: {
                status: exhausted ? "FAILED" : "QUEUED",
                nextAttemptAt: new Date(failedAt.getTime() + delay),
                lastError: String(error.code || error.name || "EMAIL_DELIVERY_FAILED").slice(0, 120),
                lockUntil: null
              }
            }
          );
          logger.error("Email notification delivery failed.", {
            notificationId: String(notification._id),
            eventType: notification.eventType,
            attempt: notification.attempts,
            willRetry: !exhausted,
            errorCode: error.code || error.name || "EMAIL_DELIVERY_FAILED"
          });
        }
      }
      return processed;
    } finally {
      processing = false;
    }
  }

  function startWorker(intervalMs = 15_000) {
    const timer = setInterval(() => {
      processPending().catch((error) => {
        logger.error("Email notification worker failed.", { errorName: error.name, errorCode: error.code });
      });
    }, intervalMs);
    timer.unref();
    return timer;
  }

  return { enqueue, processPending, startWorker };
}

const emailNotifications = createEmailNotificationService();

module.exports = { createEmailNotificationService, emailConfiguration, emailNotifications, MAX_ATTEMPTS };
