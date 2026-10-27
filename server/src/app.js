const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");
const multer = require("multer");
const {
  User, Restaurant, MenuItem, CustomerCart, Order, Promotion, Rating, Feedback, AuditLog, MessageLog, BillingTransaction,
  Advertisement, AdvertisementEvent, PhoneAuthChallenge, RestaurantRegistration, PlatformSetting
} = require("./models");
const { canTransition, haversineKm, isValidCoordinate, isValidServiceRadius, isWithinServiceArea } = require("./rules");
const { validateImageDataUrl } = require("./images");
const { validateFeedbackSubmission, buildFeedbackSummary, attachFeedbackToOrders } = require("./feedback");
const { buildRestaurantRatingSummary } = require("./ratings");
const {
  readCustomerTerms,
  updateCustomerTerms,
  customerNeedsTermsAcceptance,
  validateOrderTermsAcknowledgement
} = require("./customer-terms");
const { writeAudit, logNotification, changeOrderStatus, restaurantAcceptanceSlaMs } = require("./services");
const { PAYMENT_METHODS, validatePartnerRegistration } = require("./partner-registration");
const {
  MENU_HEADERS, parseMenuFile, parseImageArchive, validateMenuRows,
  isMenuItemWithinAvailability, rowsToCsv
} = require("./bulk-menu");
const {
  normalizeWhatsappPhone,
  customerPhoneQuery
} = require("./whatsapp");
const { recoveryOtpTtlMs, validNewPassword, restaurantRecoveryStatus } = require("./restaurant-recovery");
const { verifyFirebasePhoneToken } = require("./firebase-auth");
const { createMenuExtractor } = require("./menu-extractor");

const app = express();
const secret = process.env.JWT_SECRET || "local-development-secret-change-before-deploy";
const currency = process.env.CURRENCY || "QAR";
const apiOrigin = process.env.CLIENT_ORIGIN || "http://localhost:4200";
const partnerTermsVersion = "2026-10-v1";

app.use(helmet());
app.use(cors({ origin: apiOrigin }));
app.use(express.json({ limit: "4mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
const customerPhoneAuthRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const restaurantRecoveryRequestRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false });
const restaurantRecoveryVerifyRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const partnerRegistrationRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
const orderQuoteRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });
const menuImportRateLimit = rateLimit({ windowMs: 60 * 60 * 1000, limit: 12, standardHeaders: true, legacyHeaders: false });
const menuFileUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 2 * 1024 * 1024, files: 1 } });
const menuExtractionUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const menuImageArchiveUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024, files: 1 } });
const extractMenu = createMenuExtractor();

async function currentCustomerTerms() {
  const setting = await PlatformSetting.findOne({ key: "customerTerms" }).select("value").lean();
  return readCustomerTerms(setting?.value || "");
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function auth(required = true) {
  return asyncRoute(async (req, res, next) => {
    const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    if (!token) {
      if (required) return res.status(401).json({ error: "Sign in to continue." });
      return next();
    }
    let decoded;
    try {
      decoded = jwt.verify(token, secret);
    } catch (_) {
      return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    }
    const user = await User.findById(decoded.sub);
    if (!user || user.status !== "ACTIVE") return res.status(401).json({ error: "This account is unavailable." });
    if (user.passwordChangedAt && decoded.pwd !== user.passwordChangedAt.getTime()) {
      return res.status(401).json({ error: "Your session is invalid or expired. Sign in again." });
    }
    if (user.role === "CUSTOMER" && decoded.amr !== "firebase_phone") {
      return res.status(401).json({ error: "Customer sessions must be verified with Firebase phone authentication. Sign in again." });
    }
    req.user = user;
    req.authMethod = decoded.amr || "password";
    if (user.role.startsWith("RESTAURANT_") && user.restaurantId) {
      const restaurant = await Restaurant.findById(user.restaurantId).select("status");
      if (!restaurant || restaurant.status === "SUSPENDED") {
        return res.status(403).json({ error: "This restaurant account is suspended or unavailable." });
      }
    }
    next();
  });
}

function roles(...allowed) {
  return (req, res, next) => {
    if (!req.user || !allowed.includes(req.user.role)) return res.status(403).json({ error: "You do not have permission to do that." });
    next();
  };
}

function publicUser(user) {
  return {
    id: user._id,
    name: user.role === "CUSTOMER" && user.name === "WhatsApp customer" ? user.phone : user.name,
    email: String(user.email || "").endsWith("@customer.kahbi.invalid") ? "" : user.email,
    phone: user.phone,
    role: user.role,
    demo: user.demo,
    primaryAddressId: user.primaryAddressId || null
  };
}

function normalizeCustomerAddressInput(raw = {}, existing = null) {
  const data = raw && typeof raw === "object" ? raw : {};
  const invalidAddress = (message) => {
    const error = new Error(message);
    error.status = 400;
    error.expose = true;
    return error;
  };
  const labelType = ["HOME", "OFFICE", "OTHER"].includes(String(data.labelType || "HOME").toUpperCase())
    ? String(data.labelType || "HOME").toUpperCase()
    : "HOME";
  const customLabel = String(data.customLabel || "").trim();
  if (labelType === "OTHER" && !customLabel) {
    throw invalidAddress("Please enter a custom label when the address type is Other.");
  }
  const latitude = data.latitude === undefined || data.latitude === null || data.latitude === "" ? null : Number(data.latitude);
  const longitude = data.longitude === undefined || data.longitude === null || data.longitude === "" ? null : Number(data.longitude);
  const hasLatitude = latitude !== null;
  const hasLongitude = longitude !== null;
  if (hasLatitude !== hasLongitude ||
      (hasLatitude && (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)))) {
    throw invalidAddress("Enter a valid latitude and longitude, or leave both location fields empty.");
  }
  const hasGps = isValidCoordinate(latitude, -90, 90) && isValidCoordinate(longitude, -180, 180);
  const hasBuildingOrStreet = !!String(data.buildingNumber || "").trim() || !!String(data.streetNumber || "").trim();
  const hasZoneOrArea = !!String(data.zone || "").trim() || !!String(data.area || "").trim();
  if (!hasGps && (!hasBuildingOrStreet || !hasZoneOrArea)) {
    throw invalidAddress("Without GPS, provide a building or street and a zone or area.");
  }
  const address = {
    labelType,
    customLabel: labelType === "OTHER" ? customLabel : "",
    floorNumber: String(data.floorNumber || "").trim(),
    roomNumber: String(data.roomNumber || "").trim(),
    buildingNumber: String(data.buildingNumber || "").trim(),
    streetNumber: String(data.streetNumber || "").trim(),
    zone: String(data.zone || "").trim(),
    area: String(data.area || "").trim(),
    latitude: hasGps ? latitude : null,
    longitude: hasGps ? longitude : null,
    isPrimary: Boolean(data.isPrimary || existing?.isPrimary)
  };
  address.updatedAt = new Date();
  return address;
}

function serializeCustomerAddress(address) {
  const raw = address && typeof address.toObject === "function" ? address.toObject() : address || {};
  return {
    id: String(raw._id || raw.id || ""),
    labelType: raw.labelType || "HOME",
    customLabel: raw.customLabel || "",
    floorNumber: raw.floorNumber || "",
    roomNumber: raw.roomNumber || "",
    buildingNumber: raw.buildingNumber || "",
    streetNumber: raw.streetNumber || "",
    zone: raw.zone || "",
    area: raw.area || "",
    latitude: raw.latitude ?? null,
    longitude: raw.longitude ?? null,
    isPrimary: !!raw.isPrimary,
    createdAt: raw.createdAt || new Date().toISOString(),
    updatedAt: raw.updatedAt || raw.createdAt || new Date().toISOString()
  };
}

function customerAddressSearchText(address) {
  return [
    address.labelType,
    address.customLabel,
    address.floorNumber,
    address.roomNumber,
    address.buildingNumber,
    address.streetNumber,
    address.zone,
    address.area
  ].filter(Boolean).join(" ").toLowerCase();
}

function maskPhone(phone) {
  const normalized = String(phone || "").trim();
  const digits = normalized.replace(/\D/g, "");
  if (!digits) return "";
  const countryCode = normalized.startsWith("+") ? `+${digits.slice(0, Math.min(3, digits.length - 2))}` : "";
  const nationalNumber = countryCode ? digits.slice(countryCode.length - 1) : digits;
  return `${countryCode}${countryCode ? " " : ""}${"•".repeat(Math.max(4, nationalNumber.length - 2))}${nationalNumber.slice(-2)}`;
}

async function ordersWithRestaurantDetails(orders) {
  if (!orders.length) return [];
  const restaurantIds = [...new Set(orders.map((order) => String(order.restaurantId)))];
  const [restaurants, registrations] = await Promise.all([
    Restaurant.find({ _id: { $in: restaurantIds } }).select("name address phone latitude longitude").lean(),
    RestaurantRegistration.find({ restaurantId: { $in: restaurantIds } }).select("restaurantId details").lean()
  ]);
  const restaurantById = new Map(restaurants.map((restaurant) => [String(restaurant._id), restaurant]));
  const registrationByRestaurantId = new Map(registrations.map((registration) => [String(registration.restaurantId), registration]));
  return orders.map((order) => {
    const restaurant = restaurantById.get(String(order.restaurantId));
    const registeredDetails = registrationByRestaurantId.get(String(order.restaurantId))?.details;
    const addressParts = restaurant ? [
      restaurant.address,
      registeredDetails?.streetBuilding,
      registeredDetails?.zoneNumber ? `Zone ${registeredDetails.zoneNumber}` : "",
      registeredDetails?.city,
      registeredDetails?.country
    ].filter(Boolean) : [];
    const completeAddress = [...new Map(addressParts.map((part) => [String(part).trim().toLowerCase(), String(part).trim()])).values()]
      .join(", ");
    return {
      ...(typeof order.toObject === "function" ? order.toObject() : order),
      restaurant: restaurant ? {
        name: restaurant.name,
        address: completeAddress,
        phone: restaurant.phone,
        latitude: restaurant.latitude,
        longitude: restaurant.longitude
      } : null
    };
  });
}

async function orderWithRestaurantDetails(order) {
  return (await ordersWithRestaurantDetails([order]))[0];
}

function issueToken(user, authMethod = "password") {
  const claims = { sub: String(user._id), role: user.role, amr: authMethod };
  if (user.passwordChangedAt) claims.pwd = user.passwordChangedAt.getTime();
  return jwt.sign(claims, secret, { expiresIn: "8h", issuer: "kahbi-api" });
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function effectiveMenuPrice(item) {
  return item.discountPrice !== null && item.discountPrice !== undefined
    ? Number(item.discountPrice)
    : Number(item.price);
}

function validatePhone(phone) {
  return typeof phone === "string" && /^\+?[0-9 ()-]{8,20}$/.test(phone.trim());
}

function hashSecret(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function secureTokenMatch(token, hash) {
  if (typeof token !== "string" || !hash) return false;
  const candidate = Buffer.from(hashSecret(token), "hex");
  const expected = Buffer.from(hash, "hex");
  return candidate.length === expected.length && crypto.timingSafeEqual(candidate, expected);
}

async function findRestaurantRecoveryAccount({ phone, identifier }) {
  let user = null;
  let restaurant = null;
  let registration = null;
  let ambiguous = false;
  if (phone) {
    const phonePattern = customerPhoneQuery(phone);
    const registrations = await RestaurantRegistration.find({ "details.whatsapp": phonePattern })
      .sort({ updatedAt: -1 })
      .limit(2);
    if (registrations.length > 1) {
      ambiguous = true;
    } else {
      registration = registrations[0] || null;
    }
    if (registration?.restaurantId) {
      restaurant = await Restaurant.findById(registration.restaurantId);
    } else if (!registration) {
      const restaurants = await Restaurant.find({ whatsapp: phonePattern }).limit(2);
      if (restaurants.length > 1) ambiguous = true;
      else restaurant = restaurants[0] || null;
      if (restaurant?.partnerRegistrationId) {
        registration = await RestaurantRegistration.findOne({ registrationId: restaurant.partnerRegistrationId });
      }
    }
    if (!user && restaurant) {
      user = await User.findOne({ restaurantId: restaurant._id, role: { $in: restaurantRoles } }).sort({ createdAt: 1 });
    }
    if (!user && !registration) {
      user = await User.findOne({ role: { $in: restaurantRoles }, phone: phonePattern }).sort({ createdAt: 1 });
      if (user?.restaurantId) restaurant = await Restaurant.findById(user.restaurantId);
    }
  } else {
    user = await User.findOne({ email: identifier.toLowerCase(), role: { $in: restaurantRoles } });
    if (user?.restaurantId) restaurant = await Restaurant.findById(user.restaurantId);
    if (restaurant?.partnerRegistrationId) {
      registration = await RestaurantRegistration.findOne({ registrationId: restaurant.partnerRegistrationId });
    }
    if (!registration && restaurant) {
      registration = await RestaurantRegistration.findOne({ restaurantId: restaurant._id }).sort({ updatedAt: -1 });
    }
  }
  const registeredPhone = registration?.details?.whatsapp || restaurant?.whatsapp || (ambiguous ? phone : "");
  return {
    user,
    restaurant,
    registration,
    ambiguous,
    phone: normalizeWhatsappPhone(registeredPhone)
  };
}

function publicRegistration(registration, includeDetails = false) {
  return {
    registrationId: registration.registrationId,
    status: registration.status,
    details: includeDetails ? registration.details : undefined,
    termsVersion: registration.termsVersion,
    termsAcceptedAt: registration.termsAcceptedAt,
    createdAt: registration.createdAt,
    updatedAt: registration.updatedAt,
    reviewedAt: registration.reviewedAt,
    reviewReason: registration.reviewReason,
    correctionAllowed: registration.correctionAllowed,
    restaurantId: registration.restaurantId,
    activatedAt: registration.activatedAt
  };
}

async function restaurantForUser(user) {
  if (!user.restaurantId) {
    const error = new Error("This account is not linked to a restaurant.");
    error.status = 403;
    throw error;
  }
  const restaurant = await Restaurant.findById(user.restaurantId);
  if (!restaurant) {
    const error = new Error("The restaurant account was not found.");
    error.status = 404;
    throw error;
  }
  return restaurant;
}

async function ordersWithFeedback(orders, restaurantId) {
  if (!orders.length) return attachFeedbackToOrders(orders, []);
  const orderIds = orders.map((order) => order._id);
  const [feedbackEntries, legacyRatings] = await Promise.all([
    Feedback.find({ restaurantId, orderId: { $in: orderIds } })
      .select("orderId restaurantId overallRating foodRating deliveryRating comment submittedAt").lean(),
    Rating.find({ restaurantId, orderId: { $in: orderIds } })
      .select("orderId restaurantId stars comment createdAt").lean()
  ]);
  const legacyFeedback = legacyRatings.map((rating) => ({
    orderId: rating.orderId,
    restaurantId: rating.restaurantId,
    overallRating: rating.stars,
    foodRating: null,
    deliveryRating: null,
    comment: rating.comment,
    submittedAt: rating.createdAt
  }));
  return attachFeedbackToOrders(orders, [...feedbackEntries, ...legacyFeedback]);
}

async function refreshRestaurantRating(restaurantId) {
  const summaries = await restaurantRatingSummaries([restaurantId]);
  const summary = summaries.get(String(restaurantId)) || { average: 0, count: 0 };
  await Restaurant.findByIdAndUpdate(restaurantId, {
    ratingAverage: summary.average,
    ratingCount: summary.count
  });
}

async function restaurantRatingSummaries(restaurantIds) {
  if (!restaurantIds.length) return new Map();
  const validRating = { restaurantId: { $in: restaurantIds }, orderId: { $ne: null } };
  const entries = await Feedback.aggregate([
    { $match: { ...validRating, overallRating: { $type: "number", $gte: 1, $lte: 5 } } },
    { $lookup: { from: Order.collection.name, localField: "orderId", foreignField: "_id", as: "order" } },
    { $unwind: "$order" },
    { $match: { $expr: { $eq: ["$restaurantId", "$order.restaurantId"] } } },
    { $project: { restaurantId: 1, orderId: 1, rating: "$overallRating", source: { $literal: 1 } } },
    {
      $unionWith: {
        coll: Rating.collection.name,
        pipeline: [
          { $match: { ...validRating, stars: { $type: "number", $gte: 1, $lte: 5 } } },
          { $lookup: { from: Order.collection.name, localField: "orderId", foreignField: "_id", as: "order" } },
          { $unwind: "$order" },
          { $match: { $expr: { $eq: ["$restaurantId", "$order.restaurantId"] } } },
          { $project: { restaurantId: 1, orderId: 1, rating: "$stars", source: { $literal: 0 } } }
        ]
      }
    },
    { $sort: { source: -1 } },
    { $group: { _id: { restaurantId: "$restaurantId", orderId: "$orderId" }, rating: { $first: "$rating" } } },
    { $project: { _id: 0, restaurantId: "$_id.restaurantId", orderId: "$_id.orderId", overallRating: "$rating" } }
  ]);
  const entriesByRestaurant = new Map();
  for (const entry of entries) {
    const key = String(entry.restaurantId);
    const restaurantEntries = entriesByRestaurant.get(key) || [];
    restaurantEntries.push(entry);
    entriesByRestaurant.set(key, restaurantEntries);
  }
  return new Map(restaurantIds.map((restaurantId) => {
    const key = String(restaurantId);
    return [key, buildRestaurantRatingSummary([], entriesByRestaurant.get(key) || [])];
  }));
}

function requestedPage(value) {
  const page = Number.parseInt(String(value || "1"), 10);
  return Number.isInteger(page) && page > 0 ? page : 1;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "kahbi-api", currency }));

app.get("/api/customer-terms", auth(false), asyncRoute(async (req, res) => {
  const terms = await currentCustomerTerms();
  res.json({
    ...terms,
    acceptanceRequired: req.user?.role === "CUSTOMER" && customerNeedsTermsAcceptance(req.user, terms)
  });
}));

app.get("/api/brand", asyncRoute(async (_req, res) => {
  const setting = await PlatformSetting.findOne({ key: "brandLogo" }).select("value").lean();
  res.json({ logoData: setting?.value || "" });
}));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  res.status(410).json({ error: "Customer accounts are created after Firebase phone verification. Sign in or verify your phone to continue." });
}));

app.post("/api/auth/register-restaurant", asyncRoute(async (req, res) => {
  res.status(410).json({ error: "Restaurant accounts are created after Admin approval. Submit a restaurant partner application instead." });
}));

app.post("/api/partner-registrations", partnerRegistrationRateLimit, asyncRoute(async (req, res) => {
  const requestId = String(req.get("Idempotency-Key") || "").trim();
  const accessToken = String(req.get("X-Registration-Token") || "");
  if (!/^[0-9a-f-]{36}$/i.test(requestId) || accessToken.length < 32 || accessToken.length > 100) {
    return res.status(400).json({ error: "A valid application request key is required." });
  }
  const previous = await RestaurantRegistration.findOne({ requestId }).select("+accessTokenHash");
  if (previous) {
    if (!secureTokenMatch(accessToken, previous.accessTokenHash)) return res.status(409).json({ error: "This application request key has already been used." });
    return res.status(200).json({ registration: publicRegistration(previous), duplicate: true });
  }
  const { details, errors } = validatePartnerRegistration(req.body);
  if (req.body.termsVersion !== partnerTermsVersion) errors.termsVersion = "Please review and accept the current partner terms.";
  for (const field of ["logoImageData", "coverImageData"]) {
    const image = validateImageDataUrl(details[field]);
    if (image?.error) errors[field] = image.error;
    else details[field] = image?.imageData || "";
  }
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
  const year = new Date().getFullYear();
  let registrationId = "";
  for (let attempt = 0; attempt < 5; attempt += 1) {
    registrationId = `KBR-${year}-${crypto.randomBytes(4).toString("hex").toUpperCase()}`;
    if (!await RestaurantRegistration.exists({ registrationId })) break;
    registrationId = "";
  }
  if (!registrationId) return res.status(503).json({ error: "Could not issue a registration ID. Please try again." });
  let registration;
  try {
    registration = await RestaurantRegistration.create({
      registrationId,
      requestId,
      details,
      termsVersion: partnerTermsVersion,
      termsAcceptedAt: new Date(),
      accessTokenHash: hashSecret(accessToken),
      status: "PENDING_VERIFICATION"
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const duplicate = await RestaurantRegistration.findOne({ requestId }).select("+accessTokenHash");
    if (!duplicate || !secureTokenMatch(accessToken, duplicate.accessTokenHash)) {
      return res.status(409).json({ error: "This application request key has already been used." });
    }
    return res.status(200).json({ registration: publicRegistration(duplicate), duplicate: true });
  }
  await writeAudit({
    action: "PARTNER_REGISTRATION_SUBMITTED",
    entity: "RestaurantRegistration",
    entityId: registration.registrationId,
    details: { status: registration.status, termsVersion: registration.termsVersion, termsAcceptedAt: registration.termsAcceptedAt }
  });
  res.status(201).json({ registration: publicRegistration(registration) });
}));

app.get("/api/partner-registrations/:registrationId", asyncRoute(async (req, res) => {
  const registration = await RestaurantRegistration.findOne({ registrationId: String(req.params.registrationId).toUpperCase() }).select("+accessTokenHash");
  if (!registration || !secureTokenMatch(req.get("X-Registration-Token"), registration.accessTokenHash)) {
    return res.status(404).json({ error: "Registration not found. Check the Registration ID and access link." });
  }
  res.json({ registration: publicRegistration(registration, true) });
}));

app.patch("/api/partner-registrations/:registrationId", asyncRoute(async (req, res) => {
  const registration = await RestaurantRegistration.findOne({ registrationId: String(req.params.registrationId).toUpperCase() }).select("+accessTokenHash");
  if (!registration || !secureTokenMatch(req.get("X-Registration-Token"), registration.accessTokenHash)) {
    return res.status(404).json({ error: "Registration not found. Check the Registration ID and access link." });
  }
  if (registration.status !== "PENDING_VERIFICATION" || !registration.correctionAllowed) {
    return res.status(409).json({ error: "This application is not currently authorized for corrections." });
  }
  const { details, errors } = validatePartnerRegistration(req.body);
  if (req.body.termsVersion !== partnerTermsVersion) errors.termsVersion = "Please review and accept the current partner terms.";
  for (const field of ["logoImageData", "coverImageData"]) {
    const image = validateImageDataUrl(details[field]);
    if (image?.error) errors[field] = image.error;
    else details[field] = image?.imageData || "";
  }
  if (Object.keys(errors).length) return res.status(400).json({ error: "Please correct the highlighted fields.", fields: errors });
  const changedFields = Object.keys(details).filter((field) =>
    JSON.stringify(details[field]) !== JSON.stringify(registration.details?.[field])
  );
  registration.details = details;
  registration.termsVersion = partnerTermsVersion;
  registration.termsAcceptedAt = new Date();
  registration.status = "PENDING_VERIFICATION";
  registration.correctionAllowed = false;
  registration.reviewReason = "";
  await registration.save();
  await writeAudit({
    action: "PARTNER_REGISTRATION_RESUBMITTED",
    entity: "RestaurantRegistration",
    entityId: registration.registrationId,
    details: { status: registration.status, termsVersion: registration.termsVersion, changedFields }
  });
  res.json({ registration: publicRegistration(registration) });
}));

app.post("/api/auth/activate-restaurant", asyncRoute(async (req, res) => {
  const token = String(req.body.token || "");
  const password = req.body.password;
  const email = String(req.body.email || "").trim().toLowerCase();
  if (token.length < 32 || typeof password !== "string" || password.length < 10 || password.length > 200 ||
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ error: "Enter a valid email address, activation link, and password of at least 10 characters." });
  }
  const registration = await RestaurantRegistration.findOne({
    activationTokenHash: hashSecret(token),
    activationExpiresAt: { $gt: new Date() },
    activatedAt: null
  }).select("+activationTokenHash");
  if (!registration || registration.status !== "APPROVED" || !secureTokenMatch(token, registration.activationTokenHash)) {
    return res.status(400).json({ error: "This activation link is invalid, expired, or already used." });
  }
  if (await User.exists({ email })) return res.status(409).json({ error: "An account already uses this email address. Contact KABHI support." });
  const user = new User({
    name: registration.details.ownerName,
    email,
    phone: registration.details.phone,
    role: "RESTAURANT_OWNER",
    restaurantId: registration.restaurantId
  });
  await user.setPassword(password);
  await user.save();
  registration.activatedAt = new Date();
  registration.activationTokenHash = "";
  registration.activationExpiresAt = null;
  await registration.save();
  const restaurant = await Restaurant.findById(registration.restaurantId);
  if (restaurant) {
    restaurant.paymentMethods = Array.isArray(registration.details.paymentMethods) && registration.details.paymentMethods.length
      ? registration.details.paymentMethods
      : ["CASH_TO_RESTAURANT"];
    await restaurant.save();
  }
  await writeAudit({ user, action: "PARTNER_ACCOUNT_ACTIVATED", entity: "RestaurantRegistration", entityId: registration.registrationId });
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
}));

app.post("/api/auth/customer-phone/verify", customerPhoneAuthRateLimit, asyncRoute(async (req, res) => {
  const firebaseIdentity = await verifyFirebasePhoneToken(req.body.idToken);
  const phone = normalizeWhatsappPhone(firebaseIdentity.phone);
  const purpose = String(req.body.purpose || "LOGIN").toUpperCase();
  if (!phone) return res.status(401).json({ error: "Firebase did not return a valid verified phone number." });
  if (firebaseIdentity.authTime * 1000 < Date.now() - 5 * 60 * 1000) {
    return res.status(401).json({ error: "Your Firebase phone verification has expired. Request a new SMS code." });
  }
  if (!["LOGIN", "ORDER"].includes(purpose)) return res.status(400).json({ error: "Choose a valid phone verification purpose." });
  let user = await User.findOne({ role: "CUSTOMER", phone: customerPhoneQuery(phone) });
  if (user && user.status !== "ACTIVE") return res.status(403).json({ error: "This customer account is unavailable." });
  if (!user) {
    const phoneDigits = phone.slice(1);
    user = new User({
      name: phone,
      email: `phone.${phoneDigits}@customer.kahbi.invalid`,
      phone,
      phoneVerifiedAt: new Date(),
      role: "CUSTOMER"
    });
    await user.setPassword(crypto.randomBytes(32).toString("hex"));
    try {
      await user.save();
    } catch (error) {
      if (error.code !== 11000) throw error;
      user = await User.findOne({ role: "CUSTOMER", phone: customerPhoneQuery(phone) });
      if (!user) throw error;
    }
    await writeAudit({ user, action: "CUSTOMER_REGISTERED_WITH_FIREBASE_PHONE", entity: "User", entityId: user._id });
  } else {
    if (user.name === "WhatsApp customer") user.name = phone;
    user.phone = phone;
    user.phoneVerifiedAt = new Date();
    await user.save();
  }
  await writeAudit({ user, action: "CUSTOMER_FIREBASE_PHONE_LOGIN", entity: "User", entityId: user._id, details: { purpose } });
  res.json({ token: issueToken(user, "firebase_phone"), user: publicUser(user), purpose });
}));

async function requestRestaurantRecovery(req, res, purpose, submittedPhone) {
  const phone = normalizeWhatsappPhone(submittedPhone);
  if (!phone) return res.status(400).json({ error: "Enter the registered phone number in international format, including country code." });
  const expiresInMs = recoveryOtpTtlMs();
  const now = Date.now();
  const [latest, requestsThisHour] = await Promise.all([
    PhoneAuthChallenge.findOne({
      phone,
      purpose: { $in: ["RESTAURANT_LOGIN_ID_RECOVERY", "RESTAURANT_PASSWORD_RECOVERY"] }
    }).sort({ createdAt: -1 }).lean(),
    PhoneAuthChallenge.countDocuments({
      phone,
      purpose: { $in: ["RESTAURANT_LOGIN_ID_RECOVERY", "RESTAURANT_PASSWORD_RECOVERY"] },
      createdAt: { $gte: new Date(now - 60 * 60 * 1000) }
    })
  ]);
  if (latest && now - latest.createdAt.getTime() < 60 * 1000) {
    return res.status(429).json({ error: "Please wait one minute before requesting another verification SMS." });
  }
  if (requestsThisHour >= 5) {
    return res.status(429).json({ error: "Too many verification SMS requests for this number. Try again in an hour." });
  }
  const challenge = new PhoneAuthChallenge({
    phone,
    purpose,
    expiresAt: new Date(now + expiresInMs),
    deleteAt: new Date(now + 24 * 60 * 60 * 1000)
  });
  await challenge.save();
  await writeAudit({
    action: "RESTAURANT_RECOVERY_PHONE_VERIFICATION_REQUESTED",
    entity: "RestaurantAccountRecovery",
    entityId: challenge._id,
    details: { purpose }
  });
  res.json({
    challengeId: String(challenge._id),
    message: "Enter the Firebase verification code sent to your registered phone number.",
    expiresInMinutes: expiresInMs / (60 * 1000)
  });
}

app.post("/api/auth/restaurant-recovery/login-id/request", restaurantRecoveryRequestRateLimit, asyncRoute(async (req, res) => {
  const phone = normalizeWhatsappPhone(req.body.phone);
  if (!phone) return res.status(400).json({ error: "Enter a valid registered phone number in international format." });
  return requestRestaurantRecovery(req, res, "RESTAURANT_LOGIN_ID_RECOVERY", phone);
}));

app.post("/api/auth/restaurant-recovery/password/request", restaurantRecoveryRequestRateLimit, asyncRoute(async (req, res) => {
  const phone = String(req.body.phone || "").trim().slice(0, 30);
  if (!phone) return res.status(400).json({ error: "Enter your registered phone number." });
  return requestRestaurantRecovery(req, res, "RESTAURANT_PASSWORD_RECOVERY", phone);
}));

app.post("/api/auth/restaurant-recovery/verify", restaurantRecoveryVerifyRateLimit, asyncRoute(async (req, res) => {
  const challengeId = String(req.body.challengeId || "");
  const purpose = String(req.body.purpose || "");
  if (!mongoose.isValidObjectId(challengeId) ||
      !["RESTAURANT_LOGIN_ID_RECOVERY", "RESTAURANT_PASSWORD_RECOVERY"].includes(purpose)) {
    return res.status(400).json({ error: "That verification code is invalid or expired. Request a new code or contact KABHI Support." });
  }
  const firebaseIdentity = await verifyFirebasePhoneToken(req.body.idToken);
  const verifiedPhone = normalizeWhatsappPhone(firebaseIdentity.phone);
  const genericOtpError = "That verification code is invalid or expired. Request a new code or contact KABHI Support.";
  const pendingChallenge = await PhoneAuthChallenge.findOne(
    {
      _id: challengeId,
      purpose,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { $gt: new Date() }
    }
  );
  if (!pendingChallenge ||
      !verifiedPhone ||
      pendingChallenge.phone !== verifiedPhone ||
      firebaseIdentity.authTime * 1000 + 1000 < pendingChallenge.createdAt.getTime()) {
    await writeAudit({
      action: "RESTAURANT_RECOVERY_PHONE_VERIFICATION_FAILED",
      entity: "RestaurantAccountRecovery",
      entityId: challengeId
    });
    return res.status(400).json({ error: genericOtpError });
  }
  const challenge = await PhoneAuthChallenge.findOneAndUpdate(
    {
      _id: pendingChallenge._id,
      purpose,
      phone: verifiedPhone,
      consumedAt: null,
      verifiedAt: null,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: 5 }
    },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!challenge) return res.status(400).json({ error: genericOtpError });

  const account = await findRestaurantRecoveryAccount({ phone: challenge.phone });
  const status = restaurantRecoveryStatus(account);
  const now = new Date();
  if (status !== "ACTIVE") {
    await PhoneAuthChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, verifiedAt: null },
      { $set: { consumedAt: now } }
    );
    await writeAudit({
      user: account.user,
      action: "RESTAURANT_RECOVERY_STATUS_BLOCKED",
      entity: "RestaurantAccountRecovery",
      entityId: challenge._id,
      details: { status }
    });
    return res.json({
      status,
      message: status === "PENDING_APPROVAL"
        ? "Your restaurant account is pending approval or activation. Please contact KABHI Support if you need help."
        : "This restaurant account needs KABHI Admin assistance. Please contact KABHI Support."
    });
  }
  if (purpose === "RESTAURANT_LOGIN_ID_RECOVERY") {
    const consumedChallenge = await PhoneAuthChallenge.findOneAndUpdate(
      { _id: challenge._id, consumedAt: null, verifiedAt: null },
      { $set: { consumedAt: now } },
      { new: true }
    );
    if (!consumedChallenge) return res.status(400).json({ error: genericOtpError });
    await writeAudit({
      user: account.user,
      action: "RESTAURANT_LOGIN_ID_RECOVERED",
      entity: "User",
      entityId: account.user._id
    });
    return res.json({ status: "ACTIVE", loginId: account.user.email });
  }

  const recoveryToken = crypto.randomBytes(32).toString("base64url");
  const verifiedChallenge = await PhoneAuthChallenge.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null, verifiedAt: null },
    { $set: { verifiedAt: now, recoveryTokenHash: hashSecret(recoveryToken) } },
    { new: true }
  );
  if (!verifiedChallenge) return res.status(400).json({ error: genericOtpError });
  await writeAudit({
    user: account.user,
    action: "RESTAURANT_RECOVERY_PHONE_VERIFIED",
    entity: "RestaurantAccountRecovery",
    entityId: challenge._id
  });
  return res.json({
    status: "ACTIVE",
    challengeId: String(challenge._id),
    recoveryToken
  });
}));

app.post("/api/auth/restaurant-recovery/password/reset", restaurantRecoveryVerifyRateLimit, asyncRoute(async (req, res) => {
  const challengeId = String(req.body.challengeId || "");
  const recoveryToken = String(req.body.recoveryToken || "");
  const newPassword = req.body.newPassword;
  const confirmPassword = req.body.confirmPassword;
  if (typeof newPassword !== "string" || typeof confirmPassword !== "string" || newPassword !== confirmPassword) {
    return res.status(400).json({ error: "The new password and confirmation must match." });
  }
  if (!validNewPassword(newPassword)) {
    return res.status(400).json({ error: "Choose a password of 10–200 characters containing at least one letter and one number." });
  }
  if (!mongoose.isValidObjectId(challengeId) || !recoveryToken) {
    return res.status(400).json({ error: "Your password reset authorization is invalid or expired. Start recovery again." });
  }
  const challenge = await PhoneAuthChallenge.findOne({
    _id: challengeId,
    purpose: "RESTAURANT_PASSWORD_RECOVERY",
    consumedAt: null,
    verifiedAt: { $ne: null },
    expiresAt: { $gt: new Date() }
  }).select("+recoveryTokenHash");
  if (!challenge || !secureTokenMatch(recoveryToken, challenge.recoveryTokenHash)) {
    return res.status(400).json({ error: "Your password reset authorization is invalid or expired. Start recovery again." });
  }
  const account = await findRestaurantRecoveryAccount({ phone: challenge.phone });
  if (restaurantRecoveryStatus(account) !== "ACTIVE") {
    return res.status(403).json({ error: "This restaurant account needs KABHI Admin assistance. Please contact KABHI Support." });
  }
  const consumedChallenge = await PhoneAuthChallenge.findOneAndUpdate(
    {
      _id: challenge._id,
      consumedAt: null,
      verifiedAt: challenge.verifiedAt,
      expiresAt: { $gt: new Date() },
      recoveryTokenHash: challenge.recoveryTokenHash
    },
    { $set: { consumedAt: new Date(), recoveryTokenHash: "" } },
    { new: true }
  );
  if (!consumedChallenge) {
    return res.status(400).json({ error: "Your password reset authorization is invalid or expired. Start recovery again." });
  }
  await account.user.setPassword(newPassword);
  account.user.passwordChangedAt = new Date();
  await account.user.save();
  await writeAudit({
    user: account.user,
    action: "RESTAURANT_PASSWORD_RESET",
    entity: "User",
    entityId: account.user._id
  });
  res.json({ message: "Your password has been reset successfully. Please log in with your new password." });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const identifier = String(req.body.identifier || req.body.email || "").trim();
  const portal = String(req.body.portal || "").toUpperCase();
  let user = await User.findOne({ email: identifier.toLowerCase() }).select("+passwordHash");
  if (!user && portal === "RESTAURANT") {
    const phone = normalizeWhatsappPhone(identifier);
    if (phone) {
      const account = await findRestaurantRecoveryAccount({ phone });
      if (account.user) user = await User.findById(account.user._id).select("+passwordHash");
    }
  }
  if (!user || !(await user.verifyPassword(String(req.body.password || "")))) {
    return res.status(401).json({ error: "Login ID, phone number, or password is incorrect." });
  }
  if (user.role === "CUSTOMER") {
    return res.status(403).json({ error: "Customer accounts sign in with Firebase phone authentication." });
  }
  if (user.role.startsWith("RESTAURANT_")) {
    const restaurant = user.restaurantId ? await Restaurant.findById(user.restaurantId).select("status") : null;
    if (!restaurant || restaurant.status === "SUSPENDED") {
      return res.status(403).json({ error: "This restaurant account is suspended or unavailable." });
    }
  }
  if (portal && !["CUSTOMER", "RESTAURANT", "ADMIN"].includes(portal)) {
    return res.status(400).json({ error: "Choose a valid sign-in portal." });
  }
  const roleMatchesPortal = !portal ||
    (portal === "CUSTOMER" && user.role === "CUSTOMER") ||
    (portal === "RESTAURANT" && user.role.startsWith("RESTAURANT_")) ||
    (portal === "ADMIN" && ["ADMIN", "SUPER_ADMIN"].includes(user.role));
  if (!roleMatchesPortal) return res.status(403).json({ error: "This account cannot sign in through the selected portal." });
  if (user.status !== "ACTIVE") return res.status(403).json({ error: "This account has been suspended or deactivated." });
  await writeAudit({ user, action: "LOGIN", entity: "User", entityId: user._id });
  res.json({ token: issueToken(user), user: publicUser(user) });
}));

app.get("/api/auth/me", auth(), (req, res) => res.json({ user: publicUser(req.user) }));

app.get("/api/restaurants", auth(false), asyncRoute(async (req, res) => {
  const query = { status: "APPROVED" };
  if (req.query.search) {
    const search = String(req.query.search).slice(0, 80);
    query.$or = [
      { name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } },
      { cuisine: { $elemMatch: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" } } }
    ];
    const matchingItems = await MenuItem.find({
      name: { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), $options: "i" },
      active: true,
      availability: "AVAILABLE",
      $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
    }).select("restaurantId availabilityStart availabilityEnd").lean();
    const matchingRestaurantIds = [...new Set(matchingItems
      .filter(isMenuItemWithinAvailability)
      .map((item) => String(item.restaurantId)))];
    if (matchingRestaurantIds.length) query.$or.push({ _id: { $in: matchingRestaurantIds } });
  }
  if (req.query.open === "true") query.availability = "OPEN";
  const restaurants = await Restaurant.find(query)
    .select("name imageData hotelName cuisine description address phone latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder paymentMethods status availability category ratingAverage ratingCount demo partnerRegistrationId")
    .sort({ demo: -1, name: 1 })
    .limit(50)
    .lean();
  const partnerRestaurantIds = restaurants
    .filter((restaurant) => restaurant.partnerRegistrationId && restaurant.availability === "OPEN")
    .map((restaurant) => restaurant._id);
  const partnerMenuItems = partnerRestaurantIds.length
    ? await MenuItem.find({
      restaurantId: { $in: partnerRestaurantIds },
      active: true,
      availability: "AVAILABLE",
      $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
    }).select("restaurantId availabilityStart availabilityEnd").lean()
    : [];
  const partnerRestaurantsWithMenus = new Set(partnerMenuItems
    .filter(isMenuItemWithinAvailability)
    .map((item) => String(item.restaurantId)));
  const activatedPartnerRegistrations = partnerRestaurantIds.length
    ? await RestaurantRegistration.find({
      restaurantId: { $in: partnerRestaurantIds },
      status: "APPROVED",
      activatedAt: { $ne: null }
    }).select("restaurantId details.paymentMethods").sort({ updatedAt: -1 }).lean()
    : [];
  const activatedPartnerRestaurantIds = new Set(activatedPartnerRegistrations.map((registration) => String(registration.restaurantId)));
  const paymentMethodsByRestaurantId = new Map();
  for (const restaurant of restaurants) {
    const methods = restaurant.paymentMethods;
    paymentMethodsByRestaurantId.set(String(restaurant._id), Array.isArray(methods) && methods.length
      ? methods.filter((method) => PAYMENT_METHODS.includes(method))
      : ["CASH_TO_RESTAURANT"]);
  }
  for (const registration of activatedPartnerRegistrations) {
    const id = String(registration.restaurantId);
    const methods = registration.details?.paymentMethods;
    const registeredMethods = Array.isArray(methods)
      ? methods.filter((method) => PAYMENT_METHODS.includes(method))
      : [];
    if (registeredMethods.length) paymentMethodsByRestaurantId.set(id, registeredMethods);
  }
  const customerRestaurants = restaurants.filter((restaurant) =>
    !restaurant.partnerRegistrationId ||
    (restaurant.availability === "OPEN" &&
      partnerRestaurantsWithMenus.has(String(restaurant._id)) &&
      activatedPartnerRestaurantIds.has(String(restaurant._id)))
  );
  const ratingSummaries = await restaurantRatingSummaries(customerRestaurants.map((restaurant) => restaurant._id));
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const locationProvided = req.query.lat !== undefined || req.query.lng !== undefined;
  if (locationProvided && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lng, -180, 180))) {
    return res.status(400).json({ error: "Provide valid latitude and longitude." });
  }
  const result = customerRestaurants.map((restaurant) => {
    let distanceKm = null;
    let eligible = true;
    if (locationProvided && restaurant.latitude !== null && restaurant.latitude !== undefined &&
        restaurant.longitude !== null && restaurant.longitude !== undefined &&
        isValidServiceRadius(restaurant.serviceRadiusKm)) {
      distanceKm = roundMoney(haversineKm(lat, lng, restaurant.latitude, restaurant.longitude));
      eligible = isWithinServiceArea(lat, lng, restaurant.latitude, restaurant.longitude, restaurant.serviceRadiusKm);
    } else if (locationProvided) {
      eligible = false;
    }
    const ratingSummary = ratingSummaries.get(String(restaurant._id)) || { average: 0, count: 0 };
    const { partnerRegistrationId, ...publicRestaurant } = restaurant;
    return {
      ...publicRestaurant,
      paymentMethods: paymentMethodsByRestaurantId.get(String(restaurant._id)) || ["CASH_TO_RESTAURANT"],
      phone: req.user ? restaurant.phone : maskPhone(restaurant.phone),
      ratingAverage: ratingSummary.average,
      ratingCount: ratingSummary.count,
      distanceKm,
      eligible
    };
  });
  const eligibleOnly = req.query.eligible === "true" || locationProvided;
  const now = new Date();
  const [promotions, advertisements] = await Promise.all([
    Promotion.find({ active: true, startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gte: now } }] })
      .select("code title description discountType discountValue minimumOrder maximumDiscount")
      .limit(10)
      .lean(),
    Advertisement.find({ active: true, placement: "HOME_BANNER", startsAt: { $lte: now }, $or: [{ endsAt: null }, { endsAt: { $gte: now } }] }).sort({ priority: -1 }).limit(3).lean()
  ]);
  if (advertisements.length) {
    await AdvertisementEvent.insertMany(advertisements.map((advertisement) => ({ advertisementId: advertisement._id, eventType: "IMPRESSION" })));
  }
  const visibleRestaurants = eligibleOnly ? result.filter((item) => item.eligible) : result;
  if (locationProvided) visibleRestaurants.sort((left, right) => left.distanceKm - right.distanceKm);
  res.json({ restaurants: visibleRestaurants, promotions, advertisements });
}));

app.get("/api/restaurants/:id/menu", asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findOne({ _id: req.params.id, status: "APPROVED" })
    .select("name imageData hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder paymentMethods status availability category ratingAverage ratingCount demo")
    .lean();
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const registration = await RestaurantRegistration.findOne({
    restaurantId: restaurant._id,
    status: "APPROVED",
    activatedAt: { $ne: null }
  }).select("details.paymentMethods").sort({ updatedAt: -1 }).lean();
  restaurant.paymentMethods = Array.isArray(registration?.details?.paymentMethods) && registration.details.paymentMethods.length
    ? registration.details.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
    : Array.isArray(restaurant.paymentMethods) && restaurant.paymentMethods.length
      ? restaurant.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
      : ["CASH_TO_RESTAURANT"];
  const items = await MenuItem.find({
    restaurantId: restaurant._id,
    active: true,
    $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
  }).sort({ category: 1, name: 1 }).lean();
  const promotion = await Promotion.findOne({ active: true, restaurantId: restaurant._id, startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }] }).lean();
  res.json({
    restaurant,
    items: items.map((item) => ({
      ...item,
      availability: isMenuItemWithinAvailability(item) ? item.availability : "UNAVAILABLE"
    })),
    promotion
  });
}));

app.get("/api/customer/cart", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const cart = await CustomerCart.findOne({ customerId: req.user._id }).lean();
  if (!cart) return res.json({ cart: null });

  const restaurant = await Restaurant.findOne({ _id: cart.restaurantId, status: "APPROVED" })
    .select("name imageData hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder paymentMethods status availability category ratingAverage ratingCount demo")
    .lean();
  if (!restaurant) {
    await CustomerCart.deleteOne({ _id: cart._id });
    return res.json({ cart: null, removedItems: true });
  }
  const registration = await RestaurantRegistration.findOne({
    restaurantId: restaurant._id,
    status: "APPROVED",
    activatedAt: { $ne: null }
  }).select("details.paymentMethods").sort({ updatedAt: -1 }).lean();
  restaurant.paymentMethods = Array.isArray(registration?.details?.paymentMethods) && registration.details.paymentMethods.length
    ? registration.details.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
    : Array.isArray(restaurant.paymentMethods) && restaurant.paymentMethods.length
      ? restaurant.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
      : ["CASH_TO_RESTAURANT"];

  const availableItems = await MenuItem.find({
    _id: { $in: cart.items.map((entry) => entry.menuItemId) },
    restaurantId: restaurant._id,
    active: true,
    availability: "AVAILABLE",
    $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
  }).lean();
  const availableById = new Map(
    availableItems.filter(isMenuItemWithinAvailability).map((item) => [String(item._id), item])
  );
  const items = cart.items
    .filter((entry) => availableById.has(String(entry.menuItemId)))
    .map((entry) => ({ ...availableById.get(String(entry.menuItemId)), quantity: entry.quantity }));
  if (items.length !== cart.items.length) {
    if (items.length) {
      await CustomerCart.updateOne(
        { _id: cart._id },
        { $set: { items: items.map(({ _id, quantity }) => ({ menuItemId: _id, quantity })) } }
      );
    } else {
      await CustomerCart.deleteOne({ _id: cart._id });
    }
  }
  res.json({ cart: items.length ? { restaurant, items } : null, removedItems: items.length !== cart.items.length });
}));

app.put("/api/customer/cart", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const items = req.body.items;
  if (!Array.isArray(items) || items.length > 50) {
    return res.status(400).json({ error: "A cart must contain no more than 50 menu items." });
  }
  if (!items.length) {
    await CustomerCart.deleteOne({ customerId: req.user._id });
    return res.json({ cart: null });
  }
  const restaurantId = String(req.body.restaurantId || "");
  if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: "Choose a valid restaurant for your cart." });
  const quantities = new Map();
  for (const entry of items) {
    const menuItemId = String(entry.menuItemId || "");
    const quantity = Number(entry.quantity);
    if (!mongoose.isValidObjectId(menuItemId) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "Each cart item must have a valid menu item and quantity from 1 to 20." });
    }
    if (quantities.has(menuItemId)) return res.status(400).json({ error: "Each menu item may appear only once in the cart." });
    quantities.set(menuItemId, quantity);
  }
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "APPROVED" }).select("_id").lean();
  if (!restaurant) return res.status(409).json({ error: "This restaurant is no longer available." });
  const menuItems = await MenuItem.find({
    _id: { $in: [...quantities.keys()] },
    restaurantId,
    active: true,
    availability: "AVAILABLE",
    $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
  }).lean();
  if (menuItems.length !== quantities.size || menuItems.some((item) => !isMenuItemWithinAvailability(item))) {
    return res.status(409).json({ error: "One or more items are no longer available. Refresh the menu and try again." });
  }
  await CustomerCart.findOneAndUpdate(
    { customerId: req.user._id },
    {
      $set: {
        restaurantId: restaurant._id,
        items: [...quantities].map(([menuItemId, quantity]) => ({ menuItemId, quantity }))
      }
    },
    { upsert: true, new: true, runValidators: true }
  );
  res.json({ success: true });
}));

app.get("/api/orders/mine", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const orders = await Order.find({ customerId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  const feedbackOrderIds = await Feedback.find({ customerId: req.user._id }, { orderId: 1 }).lean();
  const feedbackSet = new Set(feedbackOrderIds.map((entry) => String(entry.orderId)));
  const responses = (await ordersWithRestaurantDetails(orders))
    .map((order) => ({ ...order, feedbackSubmitted: feedbackSet.has(String(order._id)) }));
  res.json({ orders: responses });
}));

app.post("/api/orders/track", asyncRoute(async (req, res) => {
  const reference = String(req.body.reference || "").trim().toUpperCase();
  const phone = String(req.body.phone || "").replace(/[^\d+]/g, "");
  if (!reference || !phone) return res.status(400).json({ error: "Order reference and checkout phone are required." });
  const order = await Order.findOne({ reference, customerId: null, "guest.phone": { $in: [phone, String(req.body.phone || "").trim()] } }).lean();
  if (!order) return res.status(404).json({ error: "We couldn't find an order matching that reference and phone number." });
  res.json({ order: await orderWithRestaurantDetails(order) });
}));

async function customerAddressList(userId) {
  const user = await User.findById(userId).lean();
  const addresses = Array.isArray(user?.addresses) ? user.addresses : [];
  return addresses
    .map((entry) => serializeCustomerAddress(entry))
    .sort((a, b) => {
      if (a.isPrimary !== b.isPrimary) return a.isPrimary ? -1 : 1;
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
}

function customerAddressRouteHandlers() {
  return {
    list: async (req, res) => {
      const addresses = await customerAddressList(req.user._id);
      const primaryAddress = addresses.find((entry) => entry.isPrimary) || addresses[0] || null;
      res.json({ addresses, primaryAddress });
    },
    create: async (req, res) => {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: "Your customer profile could not be found." });
      const address = normalizeCustomerAddressInput(req.body);
      const saved = { ...address, createdAt: new Date(), updatedAt: new Date() };
      if (user.addresses.length === 0) saved.isPrimary = true;
      if (req.body.isPrimary === true || req.body.primary === true) saved.isPrimary = true;
      if (saved.isPrimary) {
        user.addresses.forEach((entry) => { entry.isPrimary = false; });
      }
      user.addresses.push(saved);
      user.primaryAddressId = saved.isPrimary ? user.addresses[user.addresses.length - 1]._id : user.primaryAddressId;
      await user.save();
      const created = serializeCustomerAddress(user.addresses[user.addresses.length - 1]);
      res.status(201).json({ address: created, primaryAddress: created.isPrimary ? created : null });
    },
    update: async (req, res) => {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: "Your customer profile could not be found." });
      const entry = user.addresses.id(req.params.id);
      if (!entry) return res.status(404).json({ error: "This saved address was not found." });
      const nextAddress = normalizeCustomerAddressInput({ ...entry.toObject(), ...req.body }, entry);
      Object.assign(entry, nextAddress);
      entry.updatedAt = new Date();
      if (nextAddress.isPrimary) {
        user.addresses.forEach((item) => { item.isPrimary = item._id.equals(entry._id); });
      }
      if (!user.addresses.some((item) => item.isPrimary)) {
        user.addresses[0].isPrimary = true;
      }
      user.primaryAddressId = user.addresses.find((item) => item.isPrimary)?._id || null;
      await user.save();
      res.json({ address: serializeCustomerAddress(entry), primaryAddress: serializeCustomerAddress(user.addresses.find((item) => item.isPrimary) || user.addresses[0] || null) });
    },
    remove: async (req, res) => {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: "Your customer profile could not be found." });
      const index = user.addresses.findIndex((entry) => String(entry._id) === String(req.params.id));
      if (index === -1) return res.status(404).json({ error: "This saved address was not found." });
      const [removed] = user.addresses.splice(index, 1);
      const remaining = user.addresses;
      if (removed.isPrimary || String(user.primaryAddressId) === String(req.params.id)) {
        user.primaryAddressId = remaining.length ? remaining[0]._id : null;
        if (remaining.length) remaining[0].isPrimary = true;
      }
      if (remaining.length && !remaining.some((entry) => entry.isPrimary)) {
        remaining[0].isPrimary = true;
        user.primaryAddressId = remaining[0]._id;
      }
      if (!remaining.length) user.primaryAddressId = null;
      await user.save();
      res.json({ removedId: String(req.params.id), primaryAddressId: user.primaryAddressId ? String(user.primaryAddressId) : null });
    },
    setPrimary: async (req, res) => {
      const user = await User.findById(req.user._id);
      if (!user) return res.status(404).json({ error: "Your customer profile could not be found." });
      const target = user.addresses.find((entry) => String(entry._id) === String(req.params.id));
      if (!target) return res.status(404).json({ error: "This saved address was not found." });
      user.addresses.forEach((entry) => { entry.isPrimary = String(entry._id) === String(req.params.id); });
      user.primaryAddressId = target._id;
      await user.save();
      const primary = serializeCustomerAddress(target);
      res.json({ address: primary, primaryAddress: primary });
    }
  };
}

app.get(["/api/customer/addresses", "/api/customers/me/addresses", "/api/customers/addresses"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const addresses = await customerAddressList(req.user._id);
  const primaryAddress = addresses.find((entry) => entry.isPrimary) || addresses[0] || null;
  res.json({ addresses, primaryAddress });
}));

app.post(["/api/customer/addresses", "/api/customers/me/addresses", "/api/customers/addresses"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const handlers = customerAddressRouteHandlers();
  await handlers.create(req, res);
}));

app.put(["/api/customer/addresses/:id", "/api/customers/me/addresses/:id", "/api/customers/addresses/:id"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const handlers = customerAddressRouteHandlers();
  await handlers.update(req, res);
}));

app.patch(["/api/customer/addresses/:id", "/api/customers/me/addresses/:id", "/api/customers/addresses/:id"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const handlers = customerAddressRouteHandlers();
  await handlers.update(req, res);
}));

app.post(["/api/customer/addresses/:id/primary", "/api/customers/me/addresses/:id/primary", "/api/customers/addresses/:id/primary"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const handlers = customerAddressRouteHandlers();
  await handlers.setPrimary(req, res);
}));

app.delete(["/api/customer/addresses/:id", "/api/customers/me/addresses/:id", "/api/customers/addresses/:id"], auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const handlers = customerAddressRouteHandlers();
  await handlers.remove(req, res);
}));

app.post("/api/orders/quote", orderQuoteRateLimit, auth(false), asyncRoute(async (req, res) => {
  if (req.user && req.user.role !== "CUSTOMER") return res.status(403).json({ error: "Only customers can request an order total." });
  const { restaurantId, items, latitude, longitude } = req.body;
  const promotionCode = String(req.body.promotionCode || "").trim().toUpperCase();
  if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: "Choose a valid restaurant." });
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return res.status(400).json({ error: "Add between 1 and 50 items to your order." });
  }
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "APPROVED", availability: "OPEN" });
  if (!restaurant) return res.status(409).json({ error: "This restaurant is not currently accepting orders." });
  if (!isValidCoordinate(Number(latitude), -90, 90) || !isValidCoordinate(Number(longitude), -180, 180) ||
      !isValidCoordinate(restaurant.latitude, -90, 90) || !isValidCoordinate(restaurant.longitude, -180, 180) ||
      !isValidServiceRadius(restaurant.serviceRadiusKm)) {
    return res.status(400).json({ error: "Choose a valid delivery location to see the order total." });
  }
  if (!isWithinServiceArea(Number(latitude), Number(longitude), restaurant.latitude, restaurant.longitude, restaurant.serviceRadiusKm)) {
    return res.status(400).json({ error: "This delivery location is outside the restaurant's delivery area." });
  }
  const quantities = new Map();
  for (const item of items) {
    const id = String(item.menuItemId || "");
    const quantity = Number(item.quantity);
    if (!mongoose.isValidObjectId(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "Each item must have a valid menu item and quantity from 1 to 20." });
    }
    const totalQuantity = (quantities.get(id) || 0) + quantity;
    if (totalQuantity > 20) return res.status(400).json({ error: "The maximum quantity for one menu item is 20." });
    quantities.set(id, totalQuantity);
  }
  const menuItems = await MenuItem.find({
    _id: { $in: [...quantities.keys()] },
    restaurantId,
    active: true,
    availability: "AVAILABLE",
    $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
  });
  if (menuItems.length !== quantities.size) return res.status(409).json({ error: "One or more items are unavailable. Refresh the menu and try again." });
  if (menuItems.some((item) => !isMenuItemWithinAvailability(item))) {
    return res.status(409).json({ error: "One or more items are outside their available hours. Refresh the menu and try again." });
  }
  const subtotal = roundMoney(menuItems.reduce((sum, item) => sum + effectiveMenuPrice(item) * quantities.get(String(item._id)), 0));
  if (subtotal < restaurant.minOrder) return res.status(400).json({ error: `The minimum order for this restaurant is ${currency} ${restaurant.minOrder.toFixed(2)}.` });
  if (subtotal > restaurant.maxOrder) return res.status(400).json({ error: "This order is above the restaurant's maximum order value." });
  let discount = 0;
  if (promotionCode) {
    const promotion = await Promotion.findOne({
      code: promotionCode,
      active: true,
      startsAt: { $lte: new Date() },
      $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }],
      $and: [{ $or: [{ restaurantId: null }, { restaurantId }] }]
    });
    if (!promotion || subtotal < promotion.minimumOrder || (promotion.usageLimit > 0 && promotion.usageCount >= promotion.usageLimit)) {
      return res.status(400).json({ error: "That promotion is not valid for this order." });
    }
    discount = promotion.discountType === "PERCENTAGE"
      ? roundMoney(Math.min(subtotal * promotion.discountValue / 100, promotion.maximumDiscount))
      : roundMoney(Math.min(promotion.discountValue, subtotal));
  }
  const deliveryFee = 0;
  const serviceFee = Math.max(0, Number(process.env.CUSTOMER_ADMIN_FEE || 0));
  res.json({
    quote: {
      subtotal,
      discount,
      deliveryFee,
      serviceFee,
      total: roundMoney(Math.max(0, subtotal - discount) + deliveryFee + serviceFee),
      currency,
      promotionCode
    }
  });
}));

app.post("/api/orders", auth(false), asyncRoute(async (req, res) => {
  const { restaurantId, items, address, latitude, longitude, promotionCode } = req.body;
  if (req.user && req.user.role !== "CUSTOMER") return res.status(403).json({ error: "Only customer accounts can place orders." });
  if (!req.user) return res.status(401).json({ error: "Verify your phone number with Firebase before placing an order." });
  let orderAddress = typeof address === "string" ? address.trim() : "";
  let orderLatitude = latitude;
  let orderLongitude = longitude;
  const savedAddressId = String(req.body.savedAddressId || req.body.addressId || "").trim();
  if (savedAddressId) {
    const user = await User.findById(req.user._id).select("addresses primaryAddressId");
    if (!user) return res.status(404).json({ error: "Your customer profile could not be found." });
    const savedAddress = user.addresses.find((entry) => String(entry._id) === savedAddressId);
    if (!savedAddress) return res.status(404).json({ error: "The selected saved address could not be found." });
    if (savedAddress.latitude !== null && savedAddress.longitude !== null && isValidCoordinate(Number(savedAddress.latitude), -90, 90) && isValidCoordinate(Number(savedAddress.longitude), -180, 180)) {
      orderLatitude = Number(savedAddress.latitude);
      orderLongitude = Number(savedAddress.longitude);
    }
    const addressParts = [
      savedAddress.buildingNumber,
      savedAddress.streetNumber,
      savedAddress.roomNumber ? `Room ${savedAddress.roomNumber}` : "",
      savedAddress.floorNumber ? `Floor ${savedAddress.floorNumber}` : "",
      savedAddress.zone,
      savedAddress.area,
      savedAddress.customLabel && savedAddress.labelType === "OTHER" ? savedAddress.customLabel : ""
    ].filter(Boolean);
    orderAddress = addressParts.join(", ") || orderAddress;
  }
  const idempotencyKey = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 100) return res.status(400).json({ error: "A valid order request key is required." });
  const previous = await Order.findOne({ idempotencyKey });
  if (previous) {
    const signedOwner = req.user && previous.customerId && String(previous.customerId) === String(req.user._id);
    if (!signedOwner) return res.status(409).json({ error: "This order request key has already been used." });
    return res.status(200).json({ order: await orderWithRestaurantDetails(previous), duplicate: true });
  }
  const signedCustomer = req.user && req.user.role === "CUSTOMER" ? req.user : null;
  let customerTerms;
  let customerTermsAcceptanceRequired;
  let customerTermsAcceptedAt;
  if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: "Choose a valid restaurant." });
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return res.status(400).json({ error: "Add between 1 and 50 items to your order." });
  }
  if (typeof orderAddress !== "string" || orderAddress.trim().length < 5) {
    return res.status(400).json({ error: "Enter a delivery address with at least 5 characters." });
  }
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "APPROVED" });
  if (!restaurant) return res.status(404).json({ error: "This restaurant is not available for ordering." });
  if (restaurant.availability !== "OPEN") return res.status(409).json({ error: "This restaurant is not accepting orders right now." });
  const registration = await RestaurantRegistration.findOne({
    restaurantId: restaurant._id,
    status: "APPROVED",
    activatedAt: { $ne: null }
  }).select("details.paymentMethods").sort({ updatedAt: -1 }).lean();
  const availablePaymentMethods = Array.isArray(registration?.details?.paymentMethods) && registration.details.paymentMethods.length
    ? registration.details.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
    : Array.isArray(restaurant.paymentMethods) && restaurant.paymentMethods.length
      ? restaurant.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
      : ["CASH_TO_RESTAURANT"];
  const paymentMethod = req.body.paymentMethod === undefined ? "CASH_TO_RESTAURANT" : req.body.paymentMethod;
  if (!PAYMENT_METHODS.includes(paymentMethod) || !availablePaymentMethods.includes(paymentMethod)) {
    return res.status(400).json({ error: "Choose a payment method offered by this restaurant." });
  }
  const hasLatitude = orderLatitude !== undefined && orderLatitude !== null && orderLatitude !== "";
  const hasLongitude = orderLongitude !== undefined && orderLongitude !== null && orderLongitude !== "";
  if (hasLatitude !== hasLongitude || !hasLatitude ||
      !isValidCoordinate(Number(orderLatitude), -90, 90) || !isValidCoordinate(Number(orderLongitude), -180, 180)) {
    return res.status(400).json({ error: "Choose your delivery location on the map before placing your order." });
  }
  if (!isValidCoordinate(restaurant.latitude, -90, 90) ||
      !isValidCoordinate(restaurant.longitude, -180, 180) ||
      !isValidServiceRadius(restaurant.serviceRadiusKm)) {
    return res.status(409).json({ error: "This restaurant has not configured its free-delivery area yet." });
  }
  if (!isWithinServiceArea(Number(orderLatitude), Number(orderLongitude), restaurant.latitude, restaurant.longitude, restaurant.serviceRadiusKm)) {
    return res.status(400).json({ error: "This delivery location is outside the restaurant's free-delivery area." });
  }
  const quantities = new Map();
  for (const item of items) {
    const id = String(item.menuItemId || "");
    const quantity = Number(item.quantity);
    if (!mongoose.isValidObjectId(id) || !Number.isInteger(quantity) || quantity < 1 || quantity > 20) {
      return res.status(400).json({ error: "Each item must have a valid menu item and quantity from 1 to 20." });
    }
    const totalQuantity = (quantities.get(id) || 0) + quantity;
    if (totalQuantity > 20) return res.status(400).json({ error: "The maximum quantity for one menu item is 20." });
    quantities.set(id, totalQuantity);
  }
  const menuItems = await MenuItem.find({
    _id: { $in: [...quantities.keys()] },
    restaurantId,
    active: true,
    availability: "AVAILABLE",
    $or: [{ approvalStatus: "APPROVED" }, { approvalStatus: { $exists: false } }]
  });
  if (menuItems.length !== quantities.size) return res.status(409).json({ error: "One or more items are unavailable. Refresh the menu and try again." });
  if (menuItems.some((item) => !isMenuItemWithinAvailability(item))) {
    return res.status(409).json({ error: "One or more items are outside their available hours. Refresh the menu and try again." });
  }
  const orderItems = menuItems.map((menuItem) => ({
    menuItemId: menuItem._id,
    name: menuItem.name,
    unitPrice: effectiveMenuPrice(menuItem),
    quantity: quantities.get(String(menuItem._id)),
    lineTotal: roundMoney(effectiveMenuPrice(menuItem) * quantities.get(String(menuItem._id))),
    instructions: String((items.find((entry) => String(entry.menuItemId) === String(menuItem._id)) || {}).instructions || "").slice(0, 250)
  }));
  const subtotal = roundMoney(orderItems.reduce((sum, item) => sum + item.lineTotal, 0));
  if (subtotal < restaurant.minOrder) return res.status(400).json({ error: `The minimum order for this restaurant is ${currency} ${restaurant.minOrder.toFixed(2)}.` });
  if (subtotal > restaurant.maxOrder) return res.status(400).json({ error: "This order is above the restaurant's maximum order value." });
  let discount = 0;
  let promotion = null;
  if (promotionCode) {
    promotion = await Promotion.findOne({
      code: String(promotionCode).trim().toUpperCase(),
      active: true,
      startsAt: { $lte: new Date() },
      $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }],
      $and: [{ $or: [{ restaurantId: null }, { restaurantId }] }]
    });
    if (!promotion || subtotal < promotion.minimumOrder || (promotion.usageLimit > 0 && promotion.usageCount >= promotion.usageLimit)) {
      return res.status(400).json({ error: "That promotion is not valid for this order." });
    }
    discount = promotion.discountType === "PERCENTAGE"
      ? roundMoney(Math.min(subtotal * promotion.discountValue / 100, promotion.maximumDiscount))
      : roundMoney(Math.min(promotion.discountValue, subtotal));
  }
  const deliveryFee = 0;
  const adminFee = Math.max(0, Number(process.env.CUSTOMER_ADMIN_FEE || 0));
  const total = roundMoney(Math.max(0, subtotal - discount) + deliveryFee + adminFee);
  customerTerms = await currentCustomerTerms();
  customerTermsAcceptanceRequired = customerNeedsTermsAcceptance(signedCustomer, customerTerms);
  try {
    customerTermsAcceptedAt = validateOrderTermsAcknowledgement(signedCustomer, req.body, customerTerms);
  } catch (error) {
    return res.status(error.status || 409).json({ error: error.message, termsVersion: error.termsVersion || customerTerms.version });
  }
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const reference = `KAB-${today}-${require("crypto").randomBytes(4).toString("hex").toUpperCase()}`;
  const order = await Order.create({
    reference,
    idempotencyKey,
    customerId: signedCustomer ? signedCustomer._id : null,
    guest: { name: signedCustomer.name, phone: String(signedCustomer.phone).replace(/[^\d+]/g, "") },
    restaurantId: restaurant._id,
    restaurantName: restaurant.name,
    items: orderItems,
    address: orderAddress.trim(),
    latitude: Number(orderLatitude),
    longitude: Number(orderLongitude),
    subtotal,
    discount,
    deliveryFee,
    adminFee,
    tax: 0,
    total,
    currency,
    promotionCode: promotion ? promotion.code : "",
    paymentMethod,
    estimatedPreparationMinutes: restaurant.preparationMinutes,
    customerTermsVersion: customerTerms.version,
    customerTermsAcceptedAt,
    statusHistory: [{ previousStatus: "", status: "RESTAURANT_PENDING", changedBy: "SYSTEM", role: "SYSTEM" }]
  });
  await CustomerCart.deleteOne({ customerId: signedCustomer._id });
  if (customerTermsAcceptanceRequired) {
    await User.findByIdAndUpdate(signedCustomer._id, {
      $set: {
        customerTermsVersion: customerTerms.version,
        customerTermsAcceptedAt
      }
    });
  }
  if (promotion) {
    promotion.usageCount += 1;
    await promotion.save();
  }
  await writeAudit({ user: signedCustomer, action: "ORDER_CREATED", entity: "Order", entityId: order._id, details: { reference, restaurantId: restaurant._id, total } });
  await logNotification(order, "NEW_ORDER_RESTAURANT", restaurant.whatsapp || restaurant.phone);
  await logNotification(order, "ORDER_CREATED_CUSTOMER", signedCustomer.phone);
  res.status(201).json({ order: await orderWithRestaurantDetails(order) });
}));

app.post("/api/orders/:id/cancel", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
  if (!order) return res.status(404).json({ error: "Order not found." });
  const windowMs = Math.max(0, Number(process.env.CUSTOMER_CANCELLATION_WINDOW_MINUTES || 5)) * 60 * 1000;
  if (Date.now() - order.createdAt.getTime() > windowMs || !canTransition(order.status, "CANCELLED")) {
    return res.status(409).json({ error: "This order can no longer be cancelled in the app. Please contact support." });
  }
  const updated = await changeOrderStatus(order, "CANCELLED", req.user, String(req.body.reason || "Customer requested cancellation").slice(0, 250));
  res.json({ order: await orderWithRestaurantDetails(updated) });
}));

app.post("/api/orders/guest/cancel", asyncRoute(async (req, res) => {
  const reference = String(req.body.reference || "").trim().toUpperCase();
  const submittedPhone = String(req.body.phone || "").trim();
  const phone = submittedPhone.replace(/[^\d+]/g, "");
  const order = await Order.findOne({ reference, customerId: null, "guest.phone": { $in: [phone, submittedPhone] } });
  if (!order) return res.status(404).json({ error: "We couldn't find an order matching that reference and phone number." });
  const windowMs = Math.max(0, Number(process.env.CUSTOMER_CANCELLATION_WINDOW_MINUTES || 5)) * 60 * 1000;
  if (Date.now() - order.createdAt.getTime() > windowMs || !canTransition(order.status, "CANCELLED")) {
    return res.status(409).json({ error: "This order can no longer be cancelled in the app. Please contact support." });
  }
  const updated = await changeOrderStatus(order, "CANCELLED", null, String(req.body.reason || "Guest requested cancellation").slice(0, 250));
  res.json({ order: await orderWithRestaurantDetails(updated) });
}));

app.post("/api/orders/:id/rating", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: "Choose a rating from 1 to 5 stars." });
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, status: "CLOSED" });
  if (!order) return res.status(400).json({ error: "Only your completed orders can be rated." });
  const rating = await Rating.create({ orderId: order._id, customerId: req.user._id, restaurantId: order.restaurantId, stars, comment: String(req.body.comment || "").slice(0, 1000) });
  await refreshRestaurantRating(order.restaurantId);
  res.status(201).json({ rating });
}));

app.get("/api/orders/:id/feedback", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, status: "CLOSED" }).lean();
  if (!order) return res.status(404).json({ error: "That completed order was not found for this customer." });
  const feedback = await Feedback.findOne({ orderId: order._id }).lean();
  res.json({ feedbackExists: Boolean(feedback), feedback: feedback || null });
}));

app.post("/api/orders/:id/feedback", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, status: "CLOSED" });
  if (!order) return res.status(404).json({ error: "Only your completed orders may receive feedback." });
  if (await Feedback.exists({ orderId: order._id })) {
    return res.status(409).json({ error: "Feedback has already been submitted for this order. It cannot be edited after submission." });
  }
  const feedbackPayload = validateFeedbackSubmission(req.body);
  const feedback = await Feedback.create({
    orderId: order._id,
    customerId: req.user._id,
    customerContact: req.user.phone || "",
    restaurantId: order.restaurantId,
    overallRating: feedbackPayload.overallRating,
    foodRating: feedbackPayload.foodRating,
    deliveryRating: feedbackPayload.deliveryRating,
    comment: feedbackPayload.comment,
    submittedAt: new Date()
  });
  await refreshRestaurantRating(order.restaurantId);
  await writeAudit({
    user: req.user,
    action: "ORDER_FEEDBACK_SUBMITTED",
    entity: "Feedback",
    entityId: feedback._id,
    details: { orderId: order._id, restaurantId: order.restaurantId, overallRating: feedback.overallRating }
  });
  res.status(201).json({ feedback });
}));

const restaurantRoles = ["RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF"];
app.get("/api/restaurant/me", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const registration = await RestaurantRegistration.findOne({
    restaurantId: restaurant._id,
    status: "APPROVED",
    activatedAt: { $ne: null }
  }).select("details.paymentMethods").sort({ updatedAt: -1 }).lean();
  const paymentMethods = Array.isArray(registration?.details?.paymentMethods) && registration.details.paymentMethods.length
    ? registration.details.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method))
    : restaurant.paymentMethods?.filter((method) => PAYMENT_METHODS.includes(method)) || ["CASH_TO_RESTAURANT"];
  res.json({ restaurant: { ...restaurant.toObject(), paymentMethods } });
}));

app.patch("/api/restaurant/me", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const fields = ["name", "hotelName", "cuisine", "description", "address", "latitude", "longitude", "serviceRadiusKm", "phone", "whatsapp", "email", "preparationMinutes", "minOrder", "maxOrder", "category"];
  const updates = {};
  for (const field of fields) {
    if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
  }
  if (Object.hasOwn(req.body, "paymentMethods")) {
    if (!Array.isArray(req.body.paymentMethods) || !req.body.paymentMethods.length ||
        req.body.paymentMethods.some((method) => !PAYMENT_METHODS.includes(method)) ||
        new Set(req.body.paymentMethods).size !== req.body.paymentMethods.length) {
      return res.status(400).json({ error: "Select at least one valid payment method." });
    }
    updates.paymentMethods = req.body.paymentMethods;
  }
  if (typeof updates.name !== "undefined" && (!String(updates.name).trim() || String(updates.name).length > 120)) {
    return res.status(400).json({ error: "Restaurant name is required and must be 120 characters or fewer." });
  }
  if (typeof updates.address !== "undefined" && (!String(updates.address).trim() || String(updates.address).length > 300)) {
    return res.status(400).json({ error: "A valid restaurant address is required." });
  }
  if (typeof updates.cuisine !== "undefined") {
    updates.cuisine = (Array.isArray(updates.cuisine) ? updates.cuisine : String(updates.cuisine).split(","))
      .map((value) => String(value).trim()).filter(Boolean).slice(0, 12);
  }
  for (const field of ["latitude", "longitude", "serviceRadiusKm", "preparationMinutes", "minOrder", "maxOrder"]) {
    if (typeof updates[field] !== "undefined" && updates[field] !== null) {
      updates[field] = Number(updates[field]);
      if (!Number.isFinite(updates[field])) return res.status(400).json({ error: `${field} must be a valid number.` });
    }
  }
  const latitude = Object.hasOwn(updates, "latitude") ? updates.latitude : restaurant.latitude;
  const longitude = Object.hasOwn(updates, "longitude") ? updates.longitude : restaurant.longitude;
  if ((latitude === null) !== (longitude === null)
    || (latitude !== null && (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180)))) {
    return res.status(400).json({ error: "Provide both valid map coordinates, or leave both blank." });
  }
  if (typeof updates.serviceRadiusKm !== "undefined" && (updates.serviceRadiusKm < 1 || updates.serviceRadiusKm > 250)) {
    return res.status(400).json({ error: "Service radius must be between 1 and 250 km." });
  }
  if (typeof updates.preparationMinutes !== "undefined" && (updates.preparationMinutes < 1 || updates.preparationMinutes > 600)) {
    return res.status(400).json({ error: "Preparation time must be between 1 and 600 minutes." });
  }
  if (typeof updates.minOrder !== "undefined" && updates.minOrder < 0) return res.status(400).json({ error: "Minimum order cannot be negative." });
  if (typeof updates.maxOrder !== "undefined" && updates.maxOrder < 1) return res.status(400).json({ error: "Maximum order must be greater than zero." });
  if ((updates.minOrder ?? restaurant.minOrder) > (updates.maxOrder ?? restaurant.maxOrder)) {
    return res.status(400).json({ error: "Maximum order must be at least the minimum order." });
  }
  if (typeof updates.phone !== "undefined" && updates.phone && !validatePhone(String(updates.phone))) return res.status(400).json({ error: "Enter a valid restaurant phone number." });
  if (typeof updates.whatsapp !== "undefined" && updates.whatsapp && !validatePhone(String(updates.whatsapp))) return res.status(400).json({ error: "Enter a valid WhatsApp number." });
  if (typeof updates.email !== "undefined" && updates.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(updates.email))) return res.status(400).json({ error: "Enter a valid restaurant email." });
  Object.assign(restaurant, updates);
  let registration;
  if (Object.hasOwn(updates, "paymentMethods")) {
    registration = await RestaurantRegistration.findOne({
      restaurantId: restaurant._id,
      status: "APPROVED",
      activatedAt: { $ne: null }
    }).sort({ updatedAt: -1 });
    if (registration) {
      registration.details = {
        ...(registration.details || {}),
        paymentMethods: updates.paymentMethods
      };
      await registration.save();
    }
  }
  await restaurant.save();
  await writeAudit({
    user: req.user,
    action: "RESTAURANT_PROFILE_UPDATED",
    entity: "Restaurant",
    entityId: restaurant._id,
    details: Object.hasOwn(updates, "paymentMethods") ? { paymentMethods: updates.paymentMethods } : {}
  });
  res.json({ restaurant });
}));

app.get("/api/restaurant/orders", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const orders = await Order.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).limit(100).lean();
  const acceptanceSlaMs = restaurantAcceptanceSlaMs();
  res.json({
    orders: orders.map((order) => ({
      ...order,
      acceptanceDeadlineAt: order.status === "RESTAURANT_PENDING"
        ? new Date(new Date(order.createdAt).getTime() + acceptanceSlaMs).toISOString()
        : null
    }))
  });
}));

app.get("/api/restaurant/completed-orders", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const page = requestedPage(req.query.page);
  const pageSize = 25;
  const filter = { restaurantId: restaurant._id, status: "CLOSED" };
  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter).sort({ completedAt: -1, createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean()
  ]);
  res.json({
    orders: await ordersWithFeedback(orders, restaurant._id),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  });
}));

app.get("/api/restaurant/menu", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const items = await MenuItem.find({ restaurantId: restaurant._id, active: true }).sort({ category: 1, name: 1 }).lean();
  res.json({ items });
}));

app.get("/api/restaurant/billing", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const transactions = await BillingTransaction.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ transactions });
}));

app.patch("/api/restaurant/orders/:id/status", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const order = await Order.findOne({ _id: req.params.id, restaurantId: restaurant._id });
  if (!order) return res.status(404).json({ error: "Order not found." });
  const nextStatus = String(req.body.status || "");
  if (order.status === "RESTAURANT_PENDING" && nextStatus === "ACCEPTED" &&
      Date.now() >= new Date(order.createdAt).getTime() + restaurantAcceptanceSlaMs()) {
    await changeOrderStatus(order, "AUTO_REJECTED", null, "RESTAURANT_TIMEOUT");
    return res.status(409).json({ error: "The time to accept this order has expired. It was automatically rejected." });
  }
  if (!canTransition(order.status, nextStatus)) return res.status(409).json({ error: `This order cannot move from ${order.status} to ${nextStatus}.` });
  const updated = await changeOrderStatus(order, nextStatus, req.user, String(req.body.reason || "").slice(0, 250));
  res.json({ order: updated });
}));

app.patch("/api/restaurant/availability", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const availability = String(req.body.availability || "");
  if (!["OPEN", "CLOSED", "TEMPORARILY_UNAVAILABLE", "PAUSED"].includes(availability)) return res.status(400).json({ error: "Choose a valid restaurant availability." });
  restaurant.availability = availability;
  await restaurant.save();
  await writeAudit({ user: req.user, action: "RESTAURANT_AVAILABILITY_CHANGED", entity: "Restaurant", entityId: restaurant._id, details: { availability } });
  res.json({ restaurant });
}));

app.patch("/api/restaurant/profile/image", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  if (!Object.hasOwn(req.body, "imageData")) return res.status(400).json({ error: "Provide an image or an empty value to remove the current image." });
  const image = validateImageDataUrl(req.body.imageData);
  if (image?.error) return res.status(400).json({ error: image.error });
  restaurant.imageData = image?.imageData || "";
  await restaurant.save();
  await writeAudit({ user: req.user, action: "RESTAURANT_IMAGE_UPDATED", entity: "Restaurant", entityId: restaurant._id });
  res.json({ restaurant });
}));

app.patch("/api/restaurant/menu/:id", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const hasAvailability = Object.hasOwn(req.body, "availability");
  const hasImage = Object.hasOwn(req.body, "imageData");
  if (!hasAvailability && !hasImage) return res.status(400).json({ error: "Provide an availability or image update." });
  const availability = String(req.body.availability || "");
  if (hasAvailability && !["AVAILABLE", "UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"].includes(availability)) return res.status(400).json({ error: "Choose a valid menu item availability." });
  const image = hasImage ? validateImageDataUrl(req.body.imageData) : null;
  if (image?.error) return res.status(400).json({ error: image.error });
  const item = await MenuItem.findOne({ _id: req.params.id, restaurantId: restaurant._id });
  if (!item) return res.status(404).json({ error: "Menu item not found." });
  if (hasAvailability) item.availability = availability;
  if (hasImage) {
    item.imageData = image?.imageData || "";
    if (await RestaurantRegistration.exists({ restaurantId: restaurant._id, status: "APPROVED" })) {
      item.approvalStatus = "PENDING_REVIEW";
    }
  }
  await item.save();
  await writeAudit({
    user: req.user,
    action: hasImage ? "MENU_ITEM_UPDATED" : "MENU_AVAILABILITY_CHANGED",
    entity: "MenuItem",
    entityId: item._id,
    details: hasAvailability ? { availability } : {}
  });
  res.json({ item });
}));

app.post("/api/restaurant/menu", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const { name, category, price, description } = req.body;
  if (!name || !category || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: "Item name, category and a positive price are required." });
  const customizationOptions = String(req.body.customizationOptions || "").trim();
  if (customizationOptions.length > 1000) return res.status(400).json({ error: "Customization Options must be 1,000 characters or fewer." });
  const image = Object.hasOwn(req.body, "imageData") ? validateImageDataUrl(req.body.imageData) : null;
  if (image?.error) return res.status(400).json({ error: image.error });
  const partnerRegistration = await RestaurantRegistration.exists({ restaurantId: restaurant._id, status: "APPROVED" });
  const item = await MenuItem.create({
    restaurantId: restaurant._id,
    name: String(name).trim(),
    category: String(category).trim(),
    description: String(description || ""),
    customizationOptions,
    price: roundMoney(Number(price)),
    currency,
    imageData: image?.imageData || "",
    approvalStatus: partnerRegistration ? "PENDING_REVIEW" : "APPROVED"
  });
  await writeAudit({ user: req.user, action: "MENU_ITEM_CREATED", entity: "MenuItem", entityId: item._id, details: { name: item.name, price: item.price } });
  res.status(201).json({ item });
}));

function findBulkMenuMatch(items, row) {
  if (row.itemId) {
    const identifier = row.itemId.toLowerCase();
    const identified = items.find((item) =>
      String(item._id) === row.itemId || String(item.itemCode || "").toLowerCase() === identifier
    );
    if (identified) return identified;
  }
  const category = row.category.toLowerCase();
  const name = row.name.toLowerCase();
  return items.find((item) => item.category.trim().toLowerCase() === category && item.name.trim().toLowerCase() === name);
}

function bulkMenuItemCode(row, existingItem) {
  if (row.itemId) return row.itemId;
  if (existingItem?.itemCode) return existingItem.itemCode;
  if (existingItem) return String(existingItem._id);
  const digest = crypto.createHash("sha256").update(`${row.category.toLowerCase()}\0${row.name.toLowerCase()}`).digest("hex").slice(0, 32);
  return `BULK-${digest}`;
}

app.get("/api/restaurant/menu/bulk/template", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  await restaurantForUser(req.user);
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="kahbi-menu-template.csv"');
  res.send(`\uFEFF${rowsToCsv([], MENU_HEADERS)}`);
}));

app.post(
  "/api/restaurant/menu/extract",
  auth(),
  roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"),
  menuImportRateLimit,
  menuExtractionUpload.single("file"),
  asyncRoute(async (req, res) => {
    await restaurantForUser(req.user);
    if (!req.file) return res.status(400).json({ error: "Choose a menu file to extract." });
    res.json(await extractMenu(req.file));
  })
);

app.post(
  "/api/restaurant/menu/bulk/preview",
  auth(),
  roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"),
  menuImportRateLimit,
  menuFileUpload.single("file"),
  asyncRoute(async (req, res) => {
    const restaurant = await restaurantForUser(req.user);
    if (!req.file) return res.status(400).json({ error: "Choose a CSV or .xlsx menu file." });
    const parsed = await parseMenuFile(req.file);
    if (parsed.error) return res.status(400).json({ error: parsed.error });
    const checked = validateMenuRows(parsed.rows.map(({ rowNumber, values }) => ({ ...values, rowNumber })), restaurant._id);
    if (checked.error) return res.status(400).json({ error: checked.error });
    const existingItems = await MenuItem.find({ restaurantId: restaurant._id }).select("_id itemCode name category approvalStatus").lean();
    const rows = checked.rows.map((row) => {
      const match = row.errors.length ? null : findBulkMenuMatch(existingItems, row);
      return { ...row, existingItemId: match ? String(match._id) : "", existingItemName: match?.name || "" };
    });
    res.json({
      rows,
      totalRows: rows.length,
      validCount: rows.filter((row) => !row.errors.length).length,
      invalidCount: rows.filter((row) => row.errors.length).length,
      existingMatches: rows.filter((row) => row.existingItemId).length
    });
  })
);

app.post("/api/restaurant/menu/bulk/import", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), menuImportRateLimit, asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const mode = String(req.body.mode || "").toUpperCase();
  if (!["ADD_NEW", "UPDATE_EXISTING", "REPLACE"].includes(mode)) {
    return res.status(400).json({ error: "Choose Add New Items, Update Existing Items, or Replace Entire Menu." });
  }
  if (mode === "REPLACE" && req.body.confirmReplace !== true) {
    return res.status(400).json({ error: "Confirm that you want to replace the entire menu." });
  }
  const checked = validateMenuRows(req.body.rows, restaurant._id);
  if (checked.error) return res.status(400).json({ error: checked.error });
  if (mode === "REPLACE" && checked.invalidCount) {
    return res.status(400).json({
      error: "Correct every invalid row before replacing the entire menu. No menu items were changed.",
      rows: checked.rows,
      totalRows: checked.rows.length,
      validCount: checked.validCount,
      invalidCount: checked.invalidCount
    });
  }

  const existingItems = await MenuItem.find({ restaurantId: restaurant._id }).select("_id itemCode name category approvalStatus").lean();
  const rows = checked.rows.map((row) => ({ ...row, existingItemId: "" }));
  let imported = 0;
  let updated = 0;
  let failed = 0;
  const importedIds = [];
  const partnerRegistration = await RestaurantRegistration.exists({ restaurantId: restaurant._id, status: "APPROVED" });

  for (const row of rows) {
    if (row.errors.length) {
      failed += 1;
      continue;
    }
    const match = findBulkMenuMatch(existingItems, row);
    if (match && mode === "ADD_NEW") {
      row.errors.push(`This item already exists (menu item ${match.itemCode || match._id}). Choose Update Existing Items to update it.`);
      row.existingItemId = String(match._id);
      failed += 1;
      continue;
    }
    const itemCode = bulkMenuItemCode(row, match);
    const values = {
      restaurantId: restaurant._id,
      itemCode,
      category: row.category,
      name: row.name,
      description: row.description,
      price: roundMoney(row.price),
      discountPrice: row.discountPrice === null ? null : roundMoney(row.discountPrice),
      foodType: row.foodType,
      preparationMinutes: row.preparationMinutes || 15,
      availability: row.availability,
      availabilityStart: row.availabilityStart,
      availabilityEnd: row.availabilityEnd,
      imageUrl: row.imageUrl,
      customizationOptions: row.customizationOptions,
      currency: "QAR",
      approvalStatus: partnerRegistration ? "PENDING_REVIEW" : (match?.approvalStatus || "APPROVED"),
      active: true
    };
    const item = match
      ? await MenuItem.findOneAndUpdate(
        { _id: match._id, restaurantId: restaurant._id },
        { $set: values },
        { new: true, runValidators: true }
      )
      : await MenuItem.create(values);
    if (!item) {
      row.errors.push("The matching menu item could not be found. Refresh the menu and try again.");
      failed += 1;
      continue;
    }
    importedIds.push(item._id);
    if (match) updated += 1;
    else imported += 1;
    row.existingItemId = String(item._id);
  }

  if (mode === "REPLACE" && importedIds.length) {
    await MenuItem.updateMany(
      { restaurantId: restaurant._id, active: true, _id: { $nin: importedIds } },
      { $set: { active: false } }
    );
  }

  const totalRows = rows.length;
  const errorRows = rows.filter((row) => row.errors.length);
  const summary = { totalRows, imported, updated, failed, mode };
  await writeAudit({
    user: req.user,
    action: "MENU_BULK_IMPORT",
    entity: "Restaurant",
    entityId: restaurant._id,
    details: summary
  });
  res.json({
    summary,
    rows,
    errorReportCsv: errorRows.length
      ? rowsToCsv(errorRows.map((row) => [
        row.rowNumber, row.itemId, row.category, row.name, row.price, row.errors.join("; ")
      ]), ["Row", "Item ID", "Category", "Item Name", "Price (QAR)", "Errors"])
      : ""
  });
}));

app.post(
  "/api/restaurant/menu/bulk/images",
  auth(),
  roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"),
  menuImportRateLimit,
  menuImageArchiveUpload.single("file"),
  asyncRoute(async (req, res) => {
    const restaurant = await restaurantForUser(req.user);
    if (!req.file) return res.status(400).json({ error: "Choose a ZIP file containing menu item photos." });
    if (!/\.zip$/i.test(req.file.originalname)) return res.status(400).json({ error: "Choose a ZIP archive." });
    const archive = await parseImageArchive(req.file.buffer);
    if (archive.error) return res.status(400).json({ error: archive.error });
    if (!archive.images.length) return res.status(400).json({ error: "The ZIP does not contain supported JPEG, PNG, or WebP images." });
    const items = await MenuItem.find({ restaurantId: restaurant._id, active: true }).select("_id itemCode name category imageData approvalStatus").lean();
    const partnerRegistration = await RestaurantRegistration.exists({ restaurantId: restaurant._id, status: "APPROVED" });
    const keyFor = (value) => String(value || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    const lookup = new Map();
    for (const item of items) {
      for (const key of new Set([item.itemCode, item._id, item.name].map((value) => keyFor(value)))) {
        if (key) {
          const candidates = lookup.get(key) || [];
          candidates.push(item);
          lookup.set(key, candidates);
        }
      }
    }
    const failedFiles = [];
    const uploadedItemIds = new Set();
    let uploaded = 0;
    for (const image of archive.images) {
      const filenameKey = keyFor(image.fileName.replace(/\.[^.]+$/, ""));
      const matches = lookup.get(filenameKey) || [];
      if (matches.length !== 1) {
        failedFiles.push({ fileName: image.fileName, error: matches.length ? "Filename matches more than one menu item." : "No menu item matches this filename." });
        continue;
      }
      const matchedItemId = String(matches[0]._id);
      if (uploadedItemIds.has(matchedItemId)) {
        failedFiles.push({ fileName: image.fileName, error: "More than one ZIP image matches this menu item." });
        continue;
      }
      const imageData = `data:${image.mimeType};base64,${image.buffer.toString("base64")}`;
      const validation = validateImageDataUrl(imageData);
      if (validation?.error) {
        failedFiles.push({ fileName: image.fileName, error: validation.error });
        continue;
      }
      const updated = await MenuItem.updateOne(
        { _id: matches[0]._id, restaurantId: restaurant._id, active: true },
        { $set: { imageData: validation.imageData, imageUrl: "", ...(partnerRegistration ? { approvalStatus: "PENDING_REVIEW" } : {}) } }
      );
      if (!updated.matchedCount) {
        failedFiles.push({ fileName: image.fileName, error: "The matching menu item is no longer available. Refresh and try again." });
        continue;
      }
      uploadedItemIds.add(matchedItemId);
      uploaded += 1;
    }
    await writeAudit({
      user: req.user,
      action: "MENU_BULK_IMAGES_UPLOADED",
      entity: "Restaurant",
      entityId: restaurant._id,
      details: { uploaded, failed: failedFiles.length }
    });
    res.json({ uploaded, failed: failedFiles.length, failedFiles });
  })
);

app.get("/api/admin/summary", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const [customers, approvedRestaurants, pendingRestaurants, ordersToday, totalOrders, completedOrders, cancelledOrders, rejectedOrders, gross, commission, activePromotions, activeAdvertisements, advertisementImpressions, orders, pendingReview, recentAudit, whatsappFailures] = await Promise.all([
    User.countDocuments({ role: "CUSTOMER" }),
    Restaurant.countDocuments({ status: "APPROVED" }),
    Restaurant.countDocuments({ status: "PENDING_REVIEW" }),
    Order.countDocuments({ createdAt: { $gte: today } }),
    Order.countDocuments(),
    Order.countDocuments({ status: "CLOSED" }),
    Order.countDocuments({ status: "CANCELLED" }),
    Order.countDocuments({ status: { $in: ["REJECTED", "AUTO_REJECTED"] } }),
    Order.aggregate([{ $group: { _id: null, amount: { $sum: "$total" } } }]),
    BillingTransaction.aggregate([{ $group: { _id: null, amount: { $sum: "$commissionAmount" } } }]),
    Promotion.countDocuments({ active: true, startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }] }),
    Advertisement.countDocuments({ active: true, startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }] }),
    AdvertisementEvent.countDocuments({ eventType: "IMPRESSION" }),
    Order.find().sort({ createdAt: -1 }).limit(100).lean(),
    Restaurant.find({ status: "PENDING_REVIEW" }).sort({ createdAt: 1 }).limit(50).lean(),
    AuditLog.find().sort({ createdAt: -1 }).limit(20).lean(),
    MessageLog.countDocuments({ status: "FAILED" })
  ]);
  const metrics = {
    customers,
    approvedRestaurants,
    pendingRestaurants,
    ordersToday,
    totalOrders,
    completedOrders,
    cancelledOrders,
    rejectedOrders,
    activePromotions,
    activeAdvertisements,
    advertisementImpressions,
    grossOrderValue: roundMoney(gross[0] ? gross[0].amount : 0),
    commission: roundMoney(commission[0] ? commission[0].amount : 0),
    whatsappFailures
  };
  res.json({ metrics, orders, pendingReview, recentAudit, currency });
}));

app.get("/api/admin/restaurants", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const query = req.query.status ? { status: String(req.query.status) } : {};
  const restaurants = await Restaurant.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ restaurants });
}));

app.get("/api/admin/restaurants/:id/orders-feedback", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findById(req.params.id).select("_id").lean();
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const page = requestedPage(req.query.page);
  const pageSize = 25;
  const filter = { restaurantId: restaurant._id };
  const [total, orders] = await Promise.all([
    Order.countDocuments(filter),
    Order.find(filter).sort({ createdAt: -1 }).skip((page - 1) * pageSize).limit(pageSize).lean()
  ]);
  res.json({
    orders: await ordersWithFeedback(orders, restaurant._id),
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize)
  });
}));

app.post("/api/admin/restaurants", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const name = String(req.body.name || "").trim();
  const address = String(req.body.address || "").trim();
  const latitude = Number(req.body.latitude);
  const longitude = Number(req.body.longitude);
  const serviceRadiusKm = Number(req.body.serviceRadiusKm);
  const cuisine = Array.isArray(req.body.cuisine)
    ? req.body.cuisine.map((entry) => String(entry).trim()).filter(Boolean)
    : String(req.body.cuisine || "").split(",").map((entry) => entry.trim()).filter(Boolean);
  if (!name || !address || !cuisine.length) {
    return res.status(400).json({ error: "Restaurant name, cuisine and address are required." });
  }
  if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180) || !isValidServiceRadius(serviceRadiusKm)) {
    return res.status(400).json({ error: "Choose the restaurant location on the map and set a delivery radius between 0.5 and 100 km." });
  }
  const image = Object.hasOwn(req.body, "imageData") ? validateImageDataUrl(req.body.imageData) : null;
  if (image?.error) return res.status(400).json({ error: image.error });
  const restaurant = await Restaurant.create({
    name,
    cuisine,
    address,
    latitude,
    longitude,
    serviceRadiusKm,
    description: String(req.body.description || "").trim(),
    phone: String(req.body.phone || "").trim(),
    email: String(req.body.email || "").trim().toLowerCase(),
    imageData: image?.imageData || "",
    status: "APPROVED",
    availability: "CLOSED"
  });
  await writeAudit({ user: req.user, action: "ADMIN_RESTAURANT_CREATED", entity: "Restaurant", entityId: restaurant._id });
  res.status(201).json({ restaurant });
}));

app.patch("/api/admin/restaurants/:id", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findById(req.params.id);
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const updates = {};
  for (const field of ["name", "description", "address", "phone", "email", "category"]) {
    if (Object.hasOwn(req.body, field)) updates[field] = String(req.body[field] || "").trim();
  }
  if (Object.hasOwn(updates, "name") && !updates.name) return res.status(400).json({ error: "Restaurant name cannot be empty." });
  if (Object.hasOwn(updates, "address") && !updates.address) return res.status(400).json({ error: "Restaurant address cannot be empty." });
  if (Object.hasOwn(updates, "email")) updates.email = updates.email.toLowerCase();
  if (Object.hasOwn(req.body, "cuisine")) {
    const cuisine = Array.isArray(req.body.cuisine)
      ? req.body.cuisine.map((entry) => String(entry).trim()).filter(Boolean)
      : String(req.body.cuisine || "").split(",").map((entry) => entry.trim()).filter(Boolean);
    if (!cuisine.length) return res.status(400).json({ error: "Provide at least one cuisine." });
    updates.cuisine = cuisine;
  }
  if (Object.hasOwn(req.body, "availability")) {
    if (!["OPEN", "CLOSED", "TEMPORARILY_UNAVAILABLE", "PAUSED"].includes(req.body.availability)) {
      return res.status(400).json({ error: "Choose a valid restaurant availability." });
    }
    updates.availability = req.body.availability;
  }
  if (Object.hasOwn(req.body, "status")) {
    if (!["APPROVED", "REJECTED", "SUSPENDED"].includes(req.body.status)) {
      return res.status(400).json({ error: "Choose APPROVED, REJECTED or SUSPENDED." });
    }
    updates.status = req.body.status;
    if (req.body.status !== "APPROVED") updates.availability = "CLOSED";
  }
  if (Object.hasOwn(req.body, "imageData")) {
    const image = validateImageDataUrl(req.body.imageData);
    if (image?.error) return res.status(400).json({ error: image.error });
    updates.imageData = image?.imageData || "";
  }
  if (Object.hasOwn(req.body, "preparationMinutes")) {
    const minutes = Number(req.body.preparationMinutes);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > 240) return res.status(400).json({ error: "Preparation time must be from 1 to 240 minutes." });
    updates.preparationMinutes = minutes;
  }
  if (Object.hasOwn(req.body, "minOrder")) {
    const amount = Number(req.body.minOrder);
    if (!Number.isFinite(amount) || amount < 0 || amount > 100000) return res.status(400).json({ error: "Enter a valid minimum order amount." });
    updates.minOrder = roundMoney(amount);
  }
  const hasLatitude = Object.hasOwn(req.body, "latitude");
  const hasLongitude = Object.hasOwn(req.body, "longitude");
  const hasRadius = Object.hasOwn(req.body, "serviceRadiusKm");
  if (hasLatitude || hasLongitude || hasRadius) {
    const latitude = hasLatitude ? Number(req.body.latitude) : restaurant.latitude;
    const longitude = hasLongitude ? Number(req.body.longitude) : restaurant.longitude;
    const serviceRadiusKm = hasRadius ? Number(req.body.serviceRadiusKm) : restaurant.serviceRadiusKm;
    if (!isValidCoordinate(latitude, -90, 90) || !isValidCoordinate(longitude, -180, 180) || !isValidServiceRadius(serviceRadiusKm)) {
      return res.status(400).json({ error: "Choose a valid restaurant map location and set a delivery radius between 0.5 and 100 km." });
    }
    updates.latitude = latitude;
    updates.longitude = longitude;
    updates.serviceRadiusKm = serviceRadiusKm;
  }
  Object.assign(restaurant, updates);
  await restaurant.save();
  await writeAudit({ user: req.user, action: "ADMIN_RESTAURANT_UPDATED", entity: "Restaurant", entityId: restaurant._id, details: { fields: Object.keys(updates) } });
  res.json({ restaurant });
}));

app.get("/api/admin/restaurants/:id/menu", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findById(req.params.id).select("_id").lean();
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const items = await MenuItem.find({ restaurantId: restaurant._id }).sort({ active: -1, category: 1, name: 1 }).lean();
  res.json({ items });
}));

app.post("/api/admin/restaurants/:id/menu", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findById(req.params.id).select("_id").lean();
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const name = String(req.body.name || "").trim();
  const category = String(req.body.category || "").trim();
  const price = Number(req.body.price);
  if (!name || !category || !Number.isFinite(price) || price <= 0) {
    return res.status(400).json({ error: "Item name, category and a positive price are required." });
  }
  const image = Object.hasOwn(req.body, "imageData") ? validateImageDataUrl(req.body.imageData) : null;
  if (image?.error) return res.status(400).json({ error: image.error });
  const item = await MenuItem.create({
    restaurantId: restaurant._id,
    name,
    category,
    description: String(req.body.description || "").trim(),
    price: roundMoney(price),
    currency,
    imageData: image?.imageData || ""
  });
  await writeAudit({ user: req.user, action: "ADMIN_MENU_ITEM_CREATED", entity: "MenuItem", entityId: item._id, details: { restaurantId: restaurant._id, name } });
  res.status(201).json({ item });
}));

app.patch("/api/admin/menu/:id", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Menu item not found." });
  const item = await MenuItem.findById(req.params.id);
  if (!item) return res.status(404).json({ error: "Menu item not found." });
  const updates = {};
  for (const field of ["name", "category", "description"]) {
    if (Object.hasOwn(req.body, field)) updates[field] = String(req.body[field] || "").trim();
  }
  if ((Object.hasOwn(updates, "name") && !updates.name) || (Object.hasOwn(updates, "category") && !updates.category)) {
    return res.status(400).json({ error: "Menu item name and category cannot be empty." });
  }
  if (Object.hasOwn(req.body, "price")) {
    const price = Number(req.body.price);
    if (!Number.isFinite(price) || price <= 0) return res.status(400).json({ error: "Enter a positive menu item price." });
    updates.price = roundMoney(price);
  }
  if (Object.hasOwn(req.body, "availability")) {
    if (!["AVAILABLE", "UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"].includes(req.body.availability)) {
      return res.status(400).json({ error: "Choose a valid menu item availability." });
    }
    updates.availability = req.body.availability;
  }
  if (Object.hasOwn(req.body, "active")) {
    if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "An active true/false value is required." });
    updates.active = req.body.active;
  }
  if (Object.hasOwn(req.body, "approvalStatus")) {
    if (!["APPROVED", "REJECTED"].includes(req.body.approvalStatus)) {
      return res.status(400).json({ error: "Choose APPROVED or REJECTED for menu review." });
    }
    updates.approvalStatus = req.body.approvalStatus;
  }
  if (Object.hasOwn(req.body, "imageData")) {
    const image = validateImageDataUrl(req.body.imageData);
    if (image?.error) return res.status(400).json({ error: image.error });
    updates.imageData = image?.imageData || "";
  }
  if (!Object.keys(updates).length) return res.status(400).json({ error: "Provide at least one menu item update." });
  Object.assign(item, updates);
  await item.save();
  await writeAudit({ user: req.user, action: "ADMIN_MENU_ITEM_UPDATED", entity: "MenuItem", entityId: item._id, details: { fields: Object.keys(updates) } });
  res.json({ item });
}));

app.delete("/api/admin/menu/:id", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Menu item not found." });
  const item = await MenuItem.findOneAndUpdate({ _id: req.params.id, active: true }, { $set: { active: false } }, { new: true });
  if (!item) return res.status(404).json({ error: "Menu item not found." });
  await writeAudit({ user: req.user, action: "ADMIN_MENU_ITEM_DEACTIVATED", entity: "MenuItem", entityId: item._id, details: { restaurantId: item.restaurantId } });
  res.json({ item });
}));

app.get("/api/admin/customers", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const customers = await User.find({ role: "CUSTOMER" }).select("name email phone status createdAt").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ customers });
}));

app.patch("/api/admin/customers/:id/status", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const status = String(req.body.status || "");
  if (!["ACTIVE", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "Choose ACTIVE or SUSPENDED." });
  const customer = await User.findOne({ _id: req.params.id, role: "CUSTOMER" });
  if (!customer) return res.status(404).json({ error: "Customer not found." });
  const previousStatus = customer.status;
  customer.status = status;
  await customer.save();
  await writeAudit({ user: req.user, action: "CUSTOMER_STATUS_CHANGED", entity: "User", entityId: customer._id, details: { previousStatus, status } });
  res.json({ customer: { id: customer._id, name: customer.name, email: customer.email, status: customer.status } });
}));

app.patch("/api/admin/restaurants/:id/status", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const status = String(req.body.status || "");
  if (!["APPROVED", "REJECTED", "SUSPENDED"].includes(status)) return res.status(400).json({ error: "Choose APPROVED, REJECTED or SUSPENDED." });
  const restaurant = await Restaurant.findById(req.params.id);
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const partnerRegistration = await RestaurantRegistration.findOne({ restaurantId: restaurant._id, status: "APPROVED" });
  if (req.body.status === "APPROVED" && partnerRegistration) {
    const approvedMenuItems = await MenuItem.countDocuments({
      restaurantId: restaurant._id,
      active: true,
      approvalStatus: "APPROVED"
    });
    if (!approvedMenuItems) return res.status(409).json({ error: "Approve at least one menu item before making this partner restaurant customer-visible." });
  }
  const previousStatus = restaurant.status;
  restaurant.status = status;
  if (status !== "APPROVED") restaurant.availability = "CLOSED";
  await restaurant.save();
  await writeAudit({ user: req.user, action: "RESTAURANT_REVIEWED", entity: "Restaurant", entityId: restaurant._id, details: { previousStatus, status } });
  res.json({ restaurant });
}));

app.patch("/api/admin/restaurants/:id/availability", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const availability = String(req.body.availability || "");
  if (!["OPEN", "CLOSED", "TEMPORARILY_UNAVAILABLE", "PAUSED"].includes(availability)) {
    return res.status(400).json({ error: "Choose a valid restaurant availability." });
  }
  const restaurant = await Restaurant.findById(req.params.id);
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  if (availability === "OPEN" && restaurant.status !== "APPROVED") {
    return res.status(409).json({ error: "Approve the restaurant before setting it open." });
  }
  const previous = restaurant.availability;
  restaurant.availability = availability;
  await restaurant.save();
  await writeAudit({ user: req.user, action: "ADMIN_RESTAURANT_AVAILABILITY_CHANGED", entity: "Restaurant", entityId: restaurant._id, details: { previous, availability } });
  res.json({ restaurant });
}));

app.get("/api/admin/orders", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const orders = await Order.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ orders });
}));

app.patch("/api/admin/orders/:id/status", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Order not found." });
  const order = await Order.findById(req.params.id);
  if (!order) return res.status(404).json({ error: "Order not found." });
  const nextStatus = String(req.body.status || "");
  if (!canTransition(order.status, nextStatus)) return res.status(409).json({ error: `This order cannot move from ${order.status} to ${nextStatus}.` });
  const updated = await changeOrderStatus(order, nextStatus, req.user, String(req.body.reason || "").slice(0, 250));
  res.json({ order: updated });
}));

app.get("/api/admin/customer-terms", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  res.json(await currentCustomerTerms());
}));

app.put("/api/admin/customer-terms", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  let updatedTerms;
  try {
    updatedTerms = updateCustomerTerms(await currentCustomerTerms(), req.body.clauses);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  const setting = await PlatformSetting.findOneAndUpdate(
    { key: "customerTerms" },
    {
      $set: {
        value: JSON.stringify({ version: updatedTerms.version, clauses: updatedTerms.clauses }),
        updatedBy: req.user._id
      }
    },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  if (updatedTerms.changed) {
    await writeAudit({
      user: req.user,
      action: "CUSTOMER_TERMS_UPDATED",
      entity: "PlatformSetting",
      entityId: setting._id,
      details: { version: updatedTerms.version, clauseCount: updatedTerms.clauses.length }
    });
  }
  res.json({ version: updatedTerms.version, clauses: updatedTerms.clauses });
}));

app.get("/api/admin/audit", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ logs });
}));

app.get("/api/admin/brand", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const setting = await PlatformSetting.findOne({ key: "brandLogo" }).select("value").lean();
  res.json({ logoData: setting?.value || "" });
}));

app.put("/api/admin/brand", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (typeof req.body.logoData !== "string") return res.status(400).json({ error: "Provide a valid logo image or an empty value to restore the text logo." });
  const image = validateImageDataUrl(req.body.logoData);
  if (image?.error) return res.status(400).json({ error: image.error });
  const setting = await PlatformSetting.findOneAndUpdate(
    { key: "brandLogo" },
    { $set: { value: image?.imageData || "", updatedBy: req.user._id } },
    { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
  );
  await writeAudit({ user: req.user, action: "BRAND_LOGO_UPDATED", entity: "PlatformSetting", entityId: setting._id });
  res.json({ logoData: setting.value });
}));

app.get("/api/admin/partner-registrations", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const registrations = await RestaurantRegistration.find().sort({ createdAt: -1 }).limit(200);
  res.json({ registrations: registrations.map((registration) => publicRegistration(registration, true)) });
}));

app.patch("/api/admin/partner-registrations/:registrationId", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const registration = await RestaurantRegistration.findOne({ registrationId: String(req.params.registrationId).toUpperCase() });
  if (!registration) return res.status(404).json({ error: "Restaurant registration not found." });
  const action = String(req.body.action || "");
  const reason = String(req.body.reason || "").trim().slice(0, 1000);
  let activationUrl = "";
  let actionName = "";

  if (action === "UNDER_REVIEW" && registration.status === "PENDING_VERIFICATION") {
    registration.status = "UNDER_REVIEW";
    registration.correctionAllowed = false;
    registration.adminReviewerId = req.user._id;
    registration.reviewedAt = new Date();
    actionName = "PARTNER_REGISTRATION_REVIEW_STARTED";
  } else if (action === "REQUEST_CHANGES" && ["UNDER_REVIEW", "REJECTED"].includes(registration.status)) {
    if (reason.length < 5) return res.status(400).json({ error: "Provide a correction request with at least 5 characters." });
    registration.status = "PENDING_VERIFICATION";
    registration.correctionAllowed = true;
    registration.reviewReason = reason;
    registration.adminReviewerId = req.user._id;
    registration.reviewedAt = new Date();
    actionName = "PARTNER_REGISTRATION_CHANGES_REQUESTED";
  } else if (action === "REJECTED" && ["PENDING_VERIFICATION", "UNDER_REVIEW"].includes(registration.status)) {
    if (reason.length < 5) return res.status(400).json({ error: "Provide a rejection reason with at least 5 characters." });
    registration.status = "REJECTED";
    registration.correctionAllowed = false;
    registration.reviewReason = reason;
    registration.adminReviewerId = req.user._id;
    registration.reviewedAt = new Date();
    actionName = "PARTNER_REGISTRATION_REJECTED";
  } else if (action === "APPROVED" && registration.status === "UNDER_REVIEW") {
    const details = registration.details;
    let restaurant = registration.restaurantId
      ? await Restaurant.findById(registration.restaurantId)
      : await Restaurant.findOne({ partnerRegistrationId: registration.registrationId });
    if (!restaurant) {
      const restaurantDetails = {
        partnerRegistrationId: registration.registrationId,
        name: details.restaurantName,
        imageData: details.coverImageData || details.logoImageData || "",
        hotelName: details.restaurantType === "Hotel Restaurant" ? details.restaurantName : "",
        cuisine: [details.primaryCuisine, ...details.additionalCuisines],
        description: details.description,
        address: details.address,
        latitude: details.latitude,
        longitude: details.longitude,
        serviceRadiusKm: details.serviceRadiusKm,
        phone: details.phone,
        whatsapp: details.whatsapp,
        email: details.email,
        preparationMinutes: details.preparationMinutes,
        minOrder: details.minimumOrderValue ?? 0,
        maxOrder: details.maximumOrderValue ?? 1000,
        category: details.restaurantType,
        status: "PENDING_REVIEW",
        availability: "CLOSED"
      };
      try {
        restaurant = await Restaurant.findOneAndUpdate(
          { partnerRegistrationId: registration.registrationId },
          { $setOnInsert: restaurantDetails },
          { new: true, upsert: true, runValidators: true, setDefaultsOnInsert: true }
        );
      } catch (error) {
        if (error.code !== 11000) throw error;
        restaurant = await Restaurant.findOne({ partnerRegistrationId: registration.registrationId });
        if (!restaurant) throw error;
      }
    }
    registration.restaurantId = restaurant._id;
    registration.status = "APPROVED";
    registration.correctionAllowed = false;
    registration.adminReviewerId = req.user._id;
    registration.reviewedAt = new Date();
    registration.reviewReason = "";
    const activationToken = crypto.randomBytes(32).toString("base64url");
    registration.activationTokenHash = hashSecret(activationToken);
    registration.activationExpiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    activationUrl = new URL(`/activate-restaurant?token=${encodeURIComponent(activationToken)}`, apiOrigin).toString();
    actionName = "PARTNER_REGISTRATION_APPROVED";
  } else if (action === "SUSPENDED" && registration.status === "APPROVED") {
    registration.status = "SUSPENDED";
    registration.adminReviewerId = req.user._id;
    registration.reviewedAt = new Date();
    registration.reviewReason = reason;
    registration.correctionAllowed = false;
    if (registration.restaurantId) {
      await Restaurant.findByIdAndUpdate(registration.restaurantId, { status: "SUSPENDED", availability: "CLOSED" });
    }
    actionName = "PARTNER_REGISTRATION_SUSPENDED";
  } else {
    return res.status(409).json({ error: `Cannot apply ${action || "that action"} to a ${registration.status} registration.` });
  }

  await registration.save();
  await writeAudit({
    user: req.user,
    action: actionName,
    entity: "RestaurantRegistration",
    entityId: registration.registrationId,
    details: { status: registration.status, restaurantId: registration.restaurantId, reason }
  });
  if (action === "APPROVED") {
    const recipient = registration.details.whatsapp || registration.details.email || registration.details.phone;
    await logNotification(null, "PARTNER_REGISTRATION_APPROVED_ACTIVATION_LINK", recipient);
  }
  res.json({ registration: publicRegistration(registration, true), activationUrl });
}));

app.get("/api/admin/messages", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const messages = await MessageLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ messages });
}));

app.get("/api/admin/billing", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const transactions = await BillingTransaction.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ transactions });
}));

app.get("/api/admin/feedback", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const feedbackEntries = await Feedback.find().sort({ submittedAt: -1 }).limit(100).lean();
  const summary = buildFeedbackSummary(feedbackEntries);
  res.json({ feedback: feedbackEntries, summary });
}));

app.get("/api/admin/marketing", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const [promotions, advertisements] = await Promise.all([
    Promotion.find().sort({ createdAt: -1 }).limit(100).lean(),
    Advertisement.find().sort({ createdAt: -1 }).limit(100).lean()
  ]);
  res.json({ promotions, advertisements });
}));

app.post("/api/admin/promotions", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const code = String(req.body.code || "").trim().toUpperCase();
  const title = String(req.body.title || "").trim();
  const discountValue = Number(req.body.discountValue);
  const discountType = String(req.body.discountType || "PERCENTAGE");
  const minimumOrder = Number(req.body.minimumOrder || 0);
  const maximumDiscount = Number(req.body.maximumDiscount || 1000);
  if (!/^[A-Z0-9_-]{3,24}$/.test(code) || !title || !Number.isFinite(discountValue) || discountValue <= 0 ||
      !Number.isFinite(minimumOrder) || minimumOrder < 0 || !Number.isFinite(maximumDiscount) || maximumDiscount < 0 ||
      !["PERCENTAGE", "FIXED_AMOUNT"].includes(discountType) || (discountType === "PERCENTAGE" && discountValue > 100)) {
    return res.status(400).json({ error: "Enter a valid code, title and discount (percentages must be 1–100)." });
  }
  const promotion = await Promotion.create({
    code,
    title,
    description: String(req.body.description || "").slice(0, 500),
    discountType,
    discountValue,
    minimumOrder,
    maximumDiscount,
    active: true
  });
  await writeAudit({ user: req.user, action: "PROMOTION_CREATED", entity: "Promotion", entityId: promotion._id, details: { code, discountType, discountValue } });
  res.status(201).json({ promotion });
}));

app.patch("/api/admin/promotions/:id", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "An active true/false value is required." });
  const promotion = await Promotion.findById(req.params.id);
  if (!promotion) return res.status(404).json({ error: "Promotion not found." });
  const previous = promotion.active;
  promotion.active = req.body.active;
  await promotion.save();
  await writeAudit({ user: req.user, action: "PROMOTION_STATUS_CHANGED", entity: "Promotion", entityId: promotion._id, details: { previous, active: promotion.active } });
  res.json({ promotion });
}));

app.post("/api/admin/advertisements", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const title = String(req.body.title || "").trim();
  const description = String(req.body.description || "").trim();
  const priority = Number(req.body.priority || 0);
  if (!title || !description || !Number.isFinite(priority)) return res.status(400).json({ error: "Advertisement title, description and a valid priority are required." });
  const advertisement = await Advertisement.create({ title, description, placement: "HOME_BANNER", priority, active: true });
  await writeAudit({ user: req.user, action: "ADVERTISEMENT_CREATED", entity: "Advertisement", entityId: advertisement._id, details: { title, placement: advertisement.placement } });
  res.status(201).json({ advertisement });
}));

app.patch("/api/admin/advertisements/:id", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (typeof req.body.active !== "boolean") return res.status(400).json({ error: "An active true/false value is required." });
  const advertisement = await Advertisement.findById(req.params.id);
  if (!advertisement) return res.status(404).json({ error: "Advertisement not found." });
  const previous = advertisement.active;
  advertisement.active = req.body.active;
  await advertisement.save();
  await writeAudit({ user: req.user, action: "ADVERTISEMENT_STATUS_CHANGED", entity: "Advertisement", entityId: advertisement._id, details: { previous, active: advertisement.active } });
  res.json({ advertisement });
}));

app.use((_req, res) => res.status(404).json({ error: "The requested resource was not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    const message = error.code === "LIMIT_FILE_SIZE"
      ? "The uploaded file exceeds the allowed size limit."
      : "Upload one valid file at a time.";
    return res.status(400).json({ error: message });
  }
  if (error.type === "entity.too.large") return res.status(413).json({ error: "The uploaded data exceeds the allowed size limit." });
  if (error.code === 11000) return res.status(409).json({ error: "This request was already processed." });
  if (error.name === "ValidationError") return res.status(400).json({ error: "Some submitted information is invalid." });
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("API request failed:", error.message);
  res.status(status).json({ error: status >= 500 && !error.expose ? "Something went wrong. Please try again." : error.message });
});

module.exports = app;
