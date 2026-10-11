const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const crypto = require("crypto");
const {
  User, Restaurant, MenuItem, Order, Promotion, Rating, AuditLog, MessageLog, BillingTransaction,
  Advertisement, AdvertisementEvent, WhatsappOtp, WhatsappSettings, WhatsappOtpControl
} = require("./models");
const { canTransition, haversineKm, isValidCoordinate, isValidServiceRadius, isWithinServiceArea } = require("./rules");
const { validateImageDataUrl } = require("./images");
const { writeAudit, logNotification, changeOrderStatus } = require("./services");
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
  sendWhatsappOtp
} = require("./whatsapp");

const app = express();
const secret = process.env.JWT_SECRET || "local-development-secret-change-before-deploy";
const resolvedOtpSigningSecret = resolveOtpSigningSecret(process.env);
const currency = process.env.CURRENCY || "QAR";
const apiOrigin = process.env.CLIENT_ORIGIN || "http://localhost:4200";

app.use(helmet());
app.use(cors({ origin: apiOrigin }));
app.use(express.json({ limit: "512kb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));
const customerOtpRateLimit = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });

async function whatsappRuntimeEnvironment() {
  const saved = await WhatsappSettings.findOne({ key: "primary" }).lean();
  const savedConfiguration = saved
    ? decryptWhatsappConfiguration(saved.encryptedConfiguration, process.env.WHATSAPP_CONFIG_ENCRYPTION_KEY)
    : {};
  return { ...process.env, ...savedConfiguration };
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
    if (user.role === "CUSTOMER" && decoded.amr !== "whatsapp_otp") {
      return res.status(401).json({ error: "Customer sessions must be verified with WhatsApp OTP. Sign in again." });
    }
    req.user = user;
    req.authMethod = decoded.amr || "password";
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
    name: user.name,
    email: String(user.email || "").endsWith("@customer.kahbi.invalid") ? "" : user.email,
    phone: user.phone,
    role: user.role,
    demo: user.demo
  };
}

function issueToken(user, authMethod = "password") {
  return jwt.sign({ sub: String(user._id), role: user.role, amr: authMethod }, secret, { expiresIn: "8h", issuer: "kahbi-api" });
}

function roundMoney(amount) {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}

function validatePhone(phone) {
  return typeof phone === "string" && /^\+?[0-9 ()-]{8,20}$/.test(phone.trim());
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

app.get("/api/health", (_req, res) => res.json({ status: "ok", service: "kahbi-api", currency }));

app.post("/api/auth/register", asyncRoute(async (req, res) => {
  res.status(410).json({ error: "Customer accounts are created after WhatsApp OTP verification. Request a code to continue." });
}));

app.post("/api/auth/register-restaurant", asyncRoute(async (req, res) => {
  const { ownerName, email, password, phone, restaurantName, cuisine, address, latitude, longitude, serviceRadiusKm } = req.body;
  if (!ownerName || !restaurantName || !address || !email || typeof password !== "string" || password.length < 10 || !validatePhone(phone || "")) {
    return res.status(400).json({ error: "Complete all business and owner fields; use a valid mobile number and a password of at least 10 characters." });
  }
  const restaurantLatitude = Number(latitude);
  const restaurantLongitude = Number(longitude);
  const deliveryRadius = Number(serviceRadiusKm);
  if (!isValidCoordinate(restaurantLatitude, -90, 90) || !isValidCoordinate(restaurantLongitude, -180, 180) || !isValidServiceRadius(deliveryRadius)) {
    return res.status(400).json({ error: "Choose the restaurant location on the map and set a delivery radius between 0.5 and 100 km." });
  }
  if (await User.exists({ email: String(email).toLowerCase() })) return res.status(409).json({ error: "An account already uses that email." });
  const restaurant = await Restaurant.create({
    name: restaurantName,
    cuisine: Array.isArray(cuisine) ? cuisine : String(cuisine || "Other").split(",").map((entry) => entry.trim()).filter(Boolean),
    address,
    latitude: restaurantLatitude,
    longitude: restaurantLongitude,
    serviceRadiusKm: deliveryRadius,
    phone,
    status: "PENDING_REVIEW",
    availability: "CLOSED"
  });
  const user = new User({ name: ownerName, email, phone, role: "RESTAURANT_OWNER", restaurantId: restaurant._id });
  await user.setPassword(password);
  await user.save();
  await writeAudit({ user, action: "RESTAURANT_ONBOARDED", entity: "Restaurant", entityId: restaurant._id, details: { status: restaurant.status } });
  res.status(201).json({ token: issueToken(user), user: publicUser(user), message: "Application submitted for admin review." });
}));

app.post("/api/auth/customer-otp/request", customerOtpRateLimit, asyncRoute(async (req, res) => {
  const phone = normalizeWhatsappPhone(req.body.phone);
  const purpose = String(req.body.purpose || "LOGIN").toUpperCase();
  if (!phone) return res.status(400).json({ error: "Enter your WhatsApp number in international format, for example +974 5XXX XXXX." });
  if (!["LOGIN", "ORDER"].includes(purpose)) return res.status(400).json({ error: "Choose a valid WhatsApp verification purpose." });
  const deliveryControl = await WhatsappOtpControl.findOne({ key: "primary" }).lean();
  const deliveryEnabled = deliveryControl?.deliveryEnabled !== false;
  const deliveryMode = developmentOtpMode(deliveryEnabled);
  const whatsappEnvironment = {
    ...(deliveryEnabled ? await whatsappRuntimeEnvironment() : process.env),
    OTP_SIGNING_SECRET: resolvedOtpSigningSecret
  };
  if (deliveryEnabled) whatsappOtpConfiguration(whatsappEnvironment);
  const signingSecret = otpSigningSecret(whatsappEnvironment);
  const latest = await WhatsappOtp.findOne({ phone }).sort({ createdAt: -1 }).lean();
  if (latest && Date.now() - latest.createdAt.getTime() < 60 * 1000) {
    return res.status(429).json({ error: "Please wait one minute before requesting another WhatsApp code." });
  }
  const requestsThisHour = await WhatsappOtp.countDocuments({ phone, createdAt: { $gte: new Date(Date.now() - 60 * 60 * 1000) } });
  if (requestsThisHour >= 5) return res.status(429).json({ error: "Too many WhatsApp codes were requested for this number. Try again in an hour." });

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const challenge = new WhatsappOtp({
    phone,
    purpose,
    codeHash: "",
    expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    deleteAt: new Date(Date.now() + 24 * 60 * 60 * 1000)
  });
  challenge.codeHash = hashOtp(String(challenge._id), code, signingSecret).toString("hex");
  await challenge.save();
  if (deliveryMode === "WHATSAPP") {
    try {
      await sendWhatsappOtp(phone, code, whatsappEnvironment);
    } catch (error) {
      await WhatsappOtp.deleteOne({ _id: challenge._id });
      throw error;
    }
  }
  res.json({
    challengeId: String(challenge._id),
    message: deliveryMode === "DEVELOPMENT"
      ? "WhatsApp delivery is disabled. Enter the development code shown here; it expires in 5 minutes."
      : "A verification code was sent to your WhatsApp number. It expires in 5 minutes.",
    deliveryMode,
    ...(deliveryMode === "DEVELOPMENT" ? { developmentCode: code } : {})
  });
}));

app.post("/api/auth/customer-otp/verify", asyncRoute(async (req, res) => {
  const challengeId = String(req.body.challengeId || "");
  const phone = normalizeWhatsappPhone(req.body.phone);
  const code = String(req.body.code || "").trim();
  if (!mongoose.isValidObjectId(challengeId) || !phone || !/^\d{6}$/.test(code)) {
    return res.status(400).json({ error: "Enter the WhatsApp number and six-digit code from your message." });
  }
  const challengeQuery = {
    _id: challengeId,
    phone,
    consumedAt: null,
    expiresAt: { $gt: new Date() }
  };
  const challenge = await WhatsappOtp.findOneAndUpdate(
    { ...challengeQuery, attempts: { $lt: 5 } },
    { $inc: { attempts: 1 } },
    { new: true }
  );
  if (!challenge) {
    const exhausted = await WhatsappOtp.exists(challengeQuery);
    return res.status(exhausted ? 429 : 400).json({
      error: exhausted
        ? "Too many incorrect codes. Request a new WhatsApp code."
        : "That verification code is invalid or expired. Request a new code."
    });
  }
  if (!matchesOtp(String(challenge._id), code, otpSigningSecret({ OTP_SIGNING_SECRET: resolvedOtpSigningSecret }), challenge.codeHash)) {
    return res.status(400).json({ error: "That verification code is incorrect." });
  }

  const consumedChallenge = await WhatsappOtp.findOneAndUpdate(
    { _id: challenge._id, consumedAt: null },
    { $set: { consumedAt: new Date() } },
    { new: true }
  );
  if (!consumedChallenge) return res.status(400).json({ error: "That verification code has already been used." });
  let user = await User.findOne({ role: "CUSTOMER", phone: customerPhoneQuery(phone) });
  if (user && user.status !== "ACTIVE") return res.status(403).json({ error: "This customer account is unavailable." });
  if (!user) {
    const phoneDigits = phone.slice(1);
    user = new User({
      name: "WhatsApp customer",
      email: `whatsapp.${phoneDigits}@customer.kahbi.invalid`,
      phone,
      whatsappVerifiedAt: new Date(),
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
    await writeAudit({ user, action: "CUSTOMER_REGISTERED_WITH_WHATSAPP", entity: "User", entityId: user._id });
  } else {
    user.phone = phone;
    user.whatsappVerifiedAt = new Date();
    await user.save();
  }
  await writeAudit({ user, action: "CUSTOMER_WHATSAPP_LOGIN", entity: "User", entityId: user._id, details: { purpose: consumedChallenge.purpose } });
  res.json({ token: issueToken(user, "whatsapp_otp"), user: publicUser(user), purpose: consumedChallenge.purpose });
}));

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await user.verifyPassword(String(req.body.password || "")))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  if (user.role === "CUSTOMER") {
    return res.status(403).json({ error: "Customer accounts sign in with a WhatsApp verification code." });
  }
  const portal = String(req.body.portal || "").toUpperCase();
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

app.get("/api/restaurants", asyncRoute(async (req, res) => {
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
      availability: "AVAILABLE"
    }).distinct("restaurantId");
    if (matchingItems.length) query.$or.push({ _id: { $in: matchingItems } });
  }
  if (req.query.open === "true") query.availability = "OPEN";
  const restaurants = await Restaurant.find(query)
    .select("name imageData hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder status availability category ratingAverage ratingCount demo")
    .sort({ demo: -1, name: 1 })
    .limit(50)
    .lean();
  const lat = Number(req.query.lat);
  const lng = Number(req.query.lng);
  const locationProvided = req.query.lat !== undefined || req.query.lng !== undefined;
  if (locationProvided && (!isValidCoordinate(lat, -90, 90) || !isValidCoordinate(lng, -180, 180))) {
    return res.status(400).json({ error: "Provide valid latitude and longitude." });
  }
  const result = restaurants.map((restaurant) => {
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
    return { ...restaurant, distanceKm, eligible };
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
    .select("name imageData hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder status availability category ratingAverage ratingCount demo")
    .lean();
  if (!restaurant) return res.status(404).json({ error: "Restaurant not found." });
  const items = await MenuItem.find({ restaurantId: restaurant._id, active: true }).sort({ category: 1, name: 1 }).lean();
  const promotion = await Promotion.findOne({ active: true, restaurantId: restaurant._id, startsAt: { $lte: new Date() }, $or: [{ endsAt: null }, { endsAt: { $gte: new Date() } }] }).lean();
  res.json({ restaurant, items, promotion });
}));

app.get("/api/orders/mine", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const orders = await Order.find({ customerId: req.user._id }).sort({ createdAt: -1 }).limit(50).lean();
  res.json({ orders });
}));

app.post("/api/orders/track", asyncRoute(async (req, res) => {
  const reference = String(req.body.reference || "").trim().toUpperCase();
  const phone = String(req.body.phone || "").replace(/[^\d+]/g, "");
  if (!reference || !phone) return res.status(400).json({ error: "Order reference and checkout phone are required." });
  const order = await Order.findOne({ reference, customerId: null, "guest.phone": { $in: [phone, String(req.body.phone || "").trim()] } }).lean();
  if (!order) return res.status(404).json({ error: "We couldn't find an order matching that reference and phone number." });
  res.json({ order });
}));

app.post("/api/orders", auth(false), asyncRoute(async (req, res) => {
  const { restaurantId, items, address, latitude, longitude, promotionCode } = req.body;
  if (req.user && req.user.role !== "CUSTOMER") return res.status(403).json({ error: "Only customer accounts can place orders." });
  if (!req.user) return res.status(401).json({ error: "Verify your WhatsApp number before placing an order." });
  const idempotencyKey = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 100) return res.status(400).json({ error: "A valid order request key is required." });
  const previous = await Order.findOne({ idempotencyKey });
  if (previous) {
    const signedOwner = req.user && previous.customerId && String(previous.customerId) === String(req.user._id);
    if (!signedOwner) return res.status(409).json({ error: "This order request key has already been used." });
    return res.status(200).json({ order: previous, duplicate: true });
  }
  if (!mongoose.isValidObjectId(restaurantId)) return res.status(400).json({ error: "Choose a valid restaurant." });
  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    return res.status(400).json({ error: "Add between 1 and 50 items to your order." });
  }
  if (typeof address !== "string" || address.trim().length < 5) {
    return res.status(400).json({ error: "Enter a delivery address with at least 5 characters." });
  }
  const signedCustomer = req.user && req.user.role === "CUSTOMER" ? req.user : null;
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "APPROVED" });
  if (!restaurant) return res.status(404).json({ error: "This restaurant is not available for ordering." });
  if (restaurant.availability !== "OPEN") return res.status(409).json({ error: "This restaurant is not accepting orders right now." });
  const hasLatitude = latitude !== undefined;
  const hasLongitude = longitude !== undefined;
  if (hasLatitude !== hasLongitude || !hasLatitude ||
      !isValidCoordinate(Number(latitude), -90, 90) || !isValidCoordinate(Number(longitude), -180, 180)) {
    return res.status(400).json({ error: "Choose your delivery location on the map before placing your order." });
  }
  if (!isValidCoordinate(restaurant.latitude, -90, 90) ||
      !isValidCoordinate(restaurant.longitude, -180, 180) ||
      !isValidServiceRadius(restaurant.serviceRadiusKm)) {
    return res.status(409).json({ error: "This restaurant has not configured its free-delivery area yet." });
  }
  if (!isWithinServiceArea(Number(latitude), Number(longitude), restaurant.latitude, restaurant.longitude, restaurant.serviceRadiusKm)) {
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
  const menuItems = await MenuItem.find({ _id: { $in: [...quantities.keys()] }, restaurantId, active: true, availability: "AVAILABLE" });
  if (menuItems.length !== quantities.size) return res.status(409).json({ error: "One or more items are unavailable. Refresh the menu and try again." });
  const orderItems = menuItems.map((menuItem) => ({
    menuItemId: menuItem._id,
    name: menuItem.name,
    unitPrice: menuItem.price,
    quantity: quantities.get(String(menuItem._id)),
    lineTotal: roundMoney(menuItem.price * quantities.get(String(menuItem._id))),
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
    address: address.trim(),
    latitude: Number(latitude),
    longitude: Number(longitude),
    subtotal,
    discount,
    deliveryFee,
    adminFee,
    tax: 0,
    total,
    currency,
    promotionCode: promotion ? promotion.code : "",
    estimatedPreparationMinutes: restaurant.preparationMinutes,
    statusHistory: [{ previousStatus: "", status: "RESTAURANT_PENDING", changedBy: "SYSTEM", role: "SYSTEM" }]
  });
  if (promotion) {
    promotion.usageCount += 1;
    await promotion.save();
  }
  await writeAudit({ user: signedCustomer, action: "ORDER_CREATED", entity: "Order", entityId: order._id, details: { reference, restaurantId: restaurant._id, total } });
  await logNotification(order, "NEW_ORDER_RESTAURANT", restaurant.whatsapp || restaurant.phone);
  await logNotification(order, "ORDER_CREATED_CUSTOMER", signedCustomer.phone);
  res.status(201).json({ order });
}));

app.post("/api/orders/:id/cancel", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id });
  if (!order) return res.status(404).json({ error: "Order not found." });
  const windowMs = Math.max(0, Number(process.env.CUSTOMER_CANCELLATION_WINDOW_MINUTES || 5)) * 60 * 1000;
  if (Date.now() - order.createdAt.getTime() > windowMs || !canTransition(order.status, "CANCELLED")) {
    return res.status(409).json({ error: "This order can no longer be cancelled in the app. Please contact support." });
  }
  const updated = await changeOrderStatus(order, "CANCELLED", req.user, String(req.body.reason || "Customer requested cancellation").slice(0, 250));
  res.json({ order: updated });
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
  res.json({ order: updated });
}));

app.post("/api/orders/:id/rating", auth(), roles("CUSTOMER"), asyncRoute(async (req, res) => {
  const stars = Number(req.body.stars);
  if (!Number.isInteger(stars) || stars < 1 || stars > 5) return res.status(400).json({ error: "Choose a rating from 1 to 5 stars." });
  const order = await Order.findOne({ _id: req.params.id, customerId: req.user._id, status: "CLOSED" });
  if (!order) return res.status(400).json({ error: "Only your completed orders can be rated." });
  const rating = await Rating.create({ orderId: order._id, customerId: req.user._id, restaurantId: order.restaurantId, stars, comment: String(req.body.comment || "").slice(0, 1000) });
  const aggregate = await Rating.aggregate([{ $match: { restaurantId: order.restaurantId } }, { $group: { _id: "$restaurantId", average: { $avg: "$stars" }, count: { $sum: 1 } } }]);
  if (aggregate[0]) await Restaurant.findByIdAndUpdate(order.restaurantId, { ratingAverage: roundMoney(aggregate[0].average), ratingCount: aggregate[0].count });
  res.status(201).json({ rating });
}));

const restaurantRoles = ["RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF"];
app.get("/api/restaurant/me", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  res.json({ restaurant });
}));

app.patch("/api/restaurant/me", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const fields = ["name", "hotelName", "cuisine", "description", "address", "latitude", "longitude", "serviceRadiusKm", "phone", "whatsapp", "email", "preparationMinutes", "minOrder", "maxOrder", "category"];
  const updates = {};
  for (const field of fields) {
    if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
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
  await restaurant.save();
  await writeAudit({ user: req.user, action: "RESTAURANT_PROFILE_UPDATED", entity: "Restaurant", entityId: restaurant._id });
  res.json({ restaurant });
}));

app.get("/api/restaurant/orders", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const orders = await Order.find({ restaurantId: restaurant._id }).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ orders });
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
  if (hasImage) item.imageData = image?.imageData || "";
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
  const image = Object.hasOwn(req.body, "imageData") ? validateImageDataUrl(req.body.imageData) : null;
  if (image?.error) return res.status(400).json({ error: image.error });
  const item = await MenuItem.create({ restaurantId: restaurant._id, name: String(name).trim(), category: String(category).trim(), description: String(description || ""), price: roundMoney(Number(price)), currency, imageData: image?.imageData || "" });
  await writeAudit({ user: req.user, action: "MENU_ITEM_CREATED", entity: "MenuItem", entityId: item._id, details: { name: item.name, price: item.price } });
  res.status(201).json({ item });
}));

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

app.get("/api/admin/whatsapp-config", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const environment = await whatsappRuntimeEnvironment();
  const [saved, deliveryControl] = await Promise.all([
    WhatsappSettings.exists({ key: "primary" }),
    WhatsappOtpControl.findOne({ key: "primary" }).lean()
  ]);
  const hasAccessToken = Boolean(environment.WHATSAPP_ACCESS_TOKEN);
  const hasPhoneNumberId = Boolean(environment.WHATSAPP_PHONE_NUMBER_ID);
  const hasTemplate = Boolean(environment.WHATSAPP_OTP_TEMPLATE);
  const otpSecretConfigured = Boolean(resolvedOtpSigningSecret && resolvedOtpSigningSecret.length >= 32);
  const otpSecretPersistent = Boolean(process.env.OTP_SIGNING_SECRET && process.env.OTP_SIGNING_SECRET.length >= 32);
  res.json({
    configured: hasAccessToken && hasPhoneNumberId && hasTemplate && otpSecretConfigured,
    source: saved ? "admin" : "environment",
    otpDeliveryEnabled: deliveryControl?.deliveryEnabled !== false,
    developmentOtpAllowed: process.env.NODE_ENV === "development",
    accessTokenConfigured: hasAccessToken,
    phoneNumberIdConfigured: hasPhoneNumberId,
    otpSecretConfigured,
    otpSecretPersistent,
    encryptionKeyConfigured: Boolean(process.env.WHATSAPP_CONFIG_ENCRYPTION_KEY && process.env.WHATSAPP_CONFIG_ENCRYPTION_KEY.length >= 32),
    templateName: environment.WHATSAPP_OTP_TEMPLATE || "kahbi_customer_otp",
    language: environment.WHATSAPP_OTP_LANGUAGE || "en_US",
    graphVersion: environment.WHATSAPP_GRAPH_API_VERSION || "v23.0"
  });
}));

app.put("/api/admin/whatsapp-config/otp-delivery", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  if (typeof req.body.enabled !== "boolean") {
    return res.status(400).json({ error: "Choose whether WhatsApp OTP delivery should be enabled." });
  }
  if (!req.body.enabled && process.env.NODE_ENV !== "development") {
    return res.status(403).json({ error: "WhatsApp OTP delivery can only be disabled when NODE_ENV=development." });
  }
  await WhatsappOtpControl.findOneAndUpdate(
    { key: "primary" },
    { $set: { deliveryEnabled: req.body.enabled, updatedBy: req.user._id } },
    { upsert: true, new: true, runValidators: true }
  );
  await writeAudit({
    user: req.user,
    action: req.body.enabled ? "WHATSAPP_OTP_DELIVERY_ENABLED" : "WHATSAPP_OTP_DELIVERY_DISABLED",
    entity: "WhatsappOtpControl",
    details: { deliveryEnabled: req.body.enabled }
  });
  res.json({
    deliveryEnabled: req.body.enabled,
    message: req.body.enabled
      ? "WhatsApp OTP delivery is enabled."
      : "WhatsApp OTP delivery is disabled. Development codes will be shown in the app."
  });
}));

app.put("/api/admin/whatsapp-config", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const encryptionKey = process.env.WHATSAPP_CONFIG_ENCRYPTION_KEY;
  const existing = await WhatsappSettings.findOne({ key: "primary" }).lean();
  const savedConfiguration = existing
    ? decryptWhatsappConfiguration(existing.encryptedConfiguration, encryptionKey)
    : {};
  const effective = { ...process.env, ...savedConfiguration };
  const accessToken = typeof req.body.accessToken === "string" && req.body.accessToken.trim()
    ? req.body.accessToken.trim()
    : effective.WHATSAPP_ACCESS_TOKEN;
  const phoneNumberId = typeof req.body.phoneNumberId === "string" && req.body.phoneNumberId.trim()
    ? req.body.phoneNumberId.trim()
    : effective.WHATSAPP_PHONE_NUMBER_ID;
  const templateName = typeof req.body.templateName === "string" && req.body.templateName.trim()
    ? req.body.templateName.trim()
    : effective.WHATSAPP_OTP_TEMPLATE || "kahbi_customer_otp";
  const language = typeof req.body.language === "string" && req.body.language.trim()
    ? req.body.language.trim()
    : effective.WHATSAPP_OTP_LANGUAGE || "en_US";
  const graphVersion = typeof req.body.graphVersion === "string" && req.body.graphVersion.trim()
    ? req.body.graphVersion.trim()
    : effective.WHATSAPP_GRAPH_API_VERSION || "v23.0";
  if (!accessToken || accessToken.length > 4096) return res.status(400).json({ error: "Enter a valid WhatsApp access token." });
  if (!/^\d{5,30}$/.test(phoneNumberId || "")) return res.status(400).json({ error: "Enter the numeric WhatsApp Phone Number ID from Meta API Setup." });
  if (!/^[a-zA-Z0-9_]{1,512}$/.test(templateName)) return res.status(400).json({ error: "Enter a valid approved WhatsApp template name." });
  if (!/^[a-z]{2}_[A-Z]{2}$/.test(language)) return res.status(400).json({ error: "Enter a template language code such as en_US." });
  if (!/^v\d+\.\d+$/.test(graphVersion)) return res.status(400).json({ error: "Enter a Graph API version in the format vNN.0." });

  const encryptedConfiguration = encryptWhatsappConfiguration({
    WHATSAPP_ACCESS_TOKEN: accessToken,
    WHATSAPP_PHONE_NUMBER_ID: phoneNumberId,
    WHATSAPP_OTP_TEMPLATE: templateName,
    WHATSAPP_OTP_LANGUAGE: language,
    WHATSAPP_GRAPH_API_VERSION: graphVersion
  }, encryptionKey);
  await WhatsappSettings.findOneAndUpdate(
    { key: "primary" },
    { $set: { encryptedConfiguration, updatedBy: req.user._id } },
    { upsert: true, new: true, runValidators: true }
  );
  await writeAudit({ user: req.user, action: "WHATSAPP_CONFIGURATION_UPDATED", entity: "WhatsappSettings", details: { source: "admin" } });
  res.json({
    message: "WhatsApp settings saved securely. Restarting the app is not required.",
    configured: Boolean(accessToken && phoneNumberId && templateName &&
      resolvedOtpSigningSecret && resolvedOtpSigningSecret.length >= 32)
  });
}));

app.get("/api/admin/restaurants", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const query = req.query.status ? { status: String(req.query.status) } : {};
  const restaurants = await Restaurant.find(query).sort({ createdAt: -1 }).limit(100).lean();
  res.json({ restaurants });
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

app.get("/api/admin/audit", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const logs = await AuditLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ logs });
}));

app.get("/api/admin/messages", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const messages = await MessageLog.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ messages });
}));

app.get("/api/admin/billing", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (_req, res) => {
  const transactions = await BillingTransaction.find().sort({ createdAt: -1 }).limit(100).lean();
  res.json({ transactions });
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
  if (error.code === 11000) return res.status(409).json({ error: "This request was already processed." });
  if (error.name === "ValidationError") return res.status(400).json({ error: "Some submitted information is invalid." });
  const status = Number(error.status) || 500;
  if (status >= 500) console.error("API request failed:", error.message);
  res.status(status).json({ error: status >= 500 && !error.expose ? "Something went wrong. Please try again." : error.message });
});

module.exports = app;
