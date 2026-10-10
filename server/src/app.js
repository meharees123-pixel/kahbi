const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const mongoose = require("mongoose");
const {
  User, Restaurant, MenuItem, Order, Promotion, Rating, AuditLog, MessageLog, BillingTransaction,
  Advertisement, AdvertisementEvent
} = require("./models");
const { canTransition, haversineKm, isValidCoordinate } = require("./rules");
const { writeAudit, logNotification, changeOrderStatus } = require("./services");

const app = express();
const secret = process.env.JWT_SECRET || "local-development-secret-change-before-deploy";
const currency = process.env.CURRENCY || "QAR";
const defaultRadius = Number(process.env.DEFAULT_SERVICE_RADIUS_KM || 20);
const apiOrigin = process.env.CLIENT_ORIGIN || "http://localhost:4200";

app.use(helmet());
app.use(cors({ origin: apiOrigin }));
app.use(express.json({ limit: "1mb" }));
app.use("/api/auth", rateLimit({ windowMs: 15 * 60 * 1000, limit: 100, standardHeaders: true, legacyHeaders: false }));

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
    req.user = user;
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
    email: user.email,
    phone: user.phone,
    role: user.role,
    demo: user.demo
  };
}

function issueToken(user) {
  return jwt.sign({ sub: String(user._id), role: user.role }, secret, { expiresIn: "8h", issuer: "kahbi-api" });
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
  const { name, email, password, phone } = req.body;
  if (!name || !email || typeof password !== "string" || password.length < 10 || !validatePhone(phone || "")) {
    return res.status(400).json({ error: "Name, a valid mobile number, email, and password of at least 10 characters are required." });
  }
  if (await User.exists({ email: String(email).toLowerCase() })) return res.status(409).json({ error: "An account already uses that email." });
  const user = new User({ name, email, phone, role: "CUSTOMER" });
  await user.setPassword(password);
  await user.save();
  await writeAudit({ user, action: "CUSTOMER_REGISTERED", entity: "User", entityId: user._id });
  res.status(201).json({ token: issueToken(user), user: publicUser(user) });
}));

app.post("/api/auth/register-restaurant", asyncRoute(async (req, res) => {
  const { ownerName, email, password, phone, restaurantName, cuisine, address } = req.body;
  if (!ownerName || !restaurantName || !address || !email || typeof password !== "string" || password.length < 10 || !validatePhone(phone || "")) {
    return res.status(400).json({ error: "Complete all business and owner fields; use a valid mobile number and a password of at least 10 characters." });
  }
  if (await User.exists({ email: String(email).toLowerCase() })) return res.status(409).json({ error: "An account already uses that email." });
  const restaurant = await Restaurant.create({
    name: restaurantName,
    cuisine: Array.isArray(cuisine) ? cuisine : String(cuisine || "Other").split(",").map((entry) => entry.trim()).filter(Boolean),
    address,
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

app.post("/api/auth/login", asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").toLowerCase().trim();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await user.verifyPassword(String(req.body.password || "")))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
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
    .select("name hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder status availability category ratingAverage ratingCount demo")
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
    if (locationProvided && restaurant.latitude !== null && restaurant.longitude !== null) {
      distanceKm = roundMoney(haversineKm(lat, lng, restaurant.latitude, restaurant.longitude));
      const radius = restaurant.serviceRadiusKm || defaultRadius;
      eligible = distanceKm <= radius;
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
  res.json({ restaurants: eligibleOnly ? result.filter((item) => item.eligible) : result, promotions, advertisements });
}));

app.get("/api/restaurants/:id/menu", asyncRoute(async (req, res) => {
  if (!mongoose.isValidObjectId(req.params.id)) return res.status(404).json({ error: "Restaurant not found." });
  const restaurant = await Restaurant.findOne({ _id: req.params.id, status: "APPROVED" })
    .select("name hotelName cuisine description address latitude longitude serviceRadiusKm preparationMinutes minOrder maxOrder status availability category ratingAverage ratingCount demo")
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
  const idempotencyKey = String(req.get("Idempotency-Key") || req.body.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 100) return res.status(400).json({ error: "A valid order request key is required." });
  const previous = await Order.findOne({ idempotencyKey });
  if (previous) {
    const signedOwner = req.user && previous.customerId && String(previous.customerId) === String(req.user._id);
    const guestPhoneMatch = !previous.customerId &&
      String(previous.guest.phone).replace(/[^\d+]/g, "") === String(req.body.guestPhone || "").replace(/[^\d+]/g, "");
    if (!signedOwner && !guestPhoneMatch) return res.status(409).json({ error: "This order request key has already been used." });
    return res.status(200).json({ order: previous, duplicate: true });
  }
  if (!mongoose.isValidObjectId(restaurantId) || !Array.isArray(items) || items.length < 1 || items.length > 50 || typeof address !== "string" || address.trim().length < 5) {
    return res.status(400).json({ error: "Restaurant, order items, and a complete delivery address are required." });
  }
  const signedCustomer = req.user && req.user.role === "CUSTOMER" ? req.user : null;
  const guestName = String(req.body.guestName || "").trim();
  const guestPhone = String(req.body.guestPhone || "").trim().replace(/[^\d+]/g, "");
  if (!signedCustomer && (!guestName || !validatePhone(guestPhone))) {
    return res.status(400).json({ error: "Guest checkout requires a name and valid Qatar contact number." });
  }
  const restaurant = await Restaurant.findOne({ _id: restaurantId, status: "APPROVED" });
  if (!restaurant) return res.status(404).json({ error: "This restaurant is not available for ordering." });
  if (restaurant.availability !== "OPEN") return res.status(409).json({ error: "This restaurant is not accepting orders right now." });
  const hasCoordinates = latitude !== undefined && longitude !== undefined;
  if (hasCoordinates && (!isValidCoordinate(Number(latitude), -90, 90) || !isValidCoordinate(Number(longitude), -180, 180))) {
    return res.status(400).json({ error: "Provide valid delivery coordinates." });
  }
  if (hasCoordinates && restaurant.latitude !== null && restaurant.longitude !== null) {
    const distance = haversineKm(Number(latitude), Number(longitude), restaurant.latitude, restaurant.longitude);
    if (distance > (restaurant.serviceRadiusKm || defaultRadius)) return res.status(400).json({ error: "This delivery location is outside the restaurant service area." });
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
  const deliveryFee = Math.max(0, Number(process.env.DEFAULT_DELIVERY_FEE || 0));
  const adminFee = Math.max(0, Number(process.env.CUSTOMER_ADMIN_FEE || 0));
  const total = roundMoney(Math.max(0, subtotal - discount) + deliveryFee + adminFee);
  const today = new Date(Date.now() + 3 * 60 * 60 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
  const reference = `KAB-${today}-${require("crypto").randomBytes(4).toString("hex").toUpperCase()}`;
  const order = await Order.create({
    reference,
    idempotencyKey,
    customerId: signedCustomer ? signedCustomer._id : null,
    guest: signedCustomer ? { name: signedCustomer.name, phone: String(signedCustomer.phone).replace(/[^\d+]/g, "") } : { name: guestName, phone: guestPhone },
    restaurantId: restaurant._id,
    restaurantName: restaurant.name,
    items: orderItems,
    address: address.trim(),
    latitude: hasCoordinates ? Number(latitude) : null,
    longitude: hasCoordinates ? Number(longitude) : null,
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
  await logNotification(order, "ORDER_CREATED_CUSTOMER", signedCustomer ? signedCustomer.phone : guestPhone);
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

app.patch("/api/restaurant/menu/:id", auth(), roles(...restaurantRoles), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  if (req.user.role === "RESTAURANT_STAFF" && Object.keys(req.body).some((field) => field !== "availability")) {
    return res.status(403).json({ error: "Restaurant staff can update menu availability but cannot edit menu details." });
  }
  const item = await MenuItem.findOne({ _id: req.params.id, restaurantId: restaurant._id });
  if (!item) return res.status(404).json({ error: "Menu item not found." });
  const fields = ["name", "category", "description", "price", "availability", "preparationMinutes", "bestSeller", "chefRecommended"];
  const updates = {};
  for (const field of fields) {
    if (Object.hasOwn(req.body, field)) updates[field] = req.body[field];
  }
  if (typeof updates.name !== "undefined" && !String(updates.name).trim()) return res.status(400).json({ error: "Item name is required." });
  if (typeof updates.category !== "undefined" && !String(updates.category).trim()) return res.status(400).json({ error: "Item category is required." });
  if (typeof updates.price !== "undefined") {
    updates.price = Number(updates.price);
    if (!Number.isFinite(updates.price) || updates.price <= 0) return res.status(400).json({ error: "Item price must be greater than zero." });
    updates.price = roundMoney(updates.price);
  }
  if (typeof updates.availability !== "undefined" && !["AVAILABLE", "UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"].includes(String(updates.availability))) {
    return res.status(400).json({ error: "Choose a valid menu item availability." });
  }
  if (typeof updates.preparationMinutes !== "undefined") {
    updates.preparationMinutes = Number(updates.preparationMinutes);
    if (!Number.isInteger(updates.preparationMinutes) || updates.preparationMinutes < 1 || updates.preparationMinutes > 600) {
      return res.status(400).json({ error: "Item preparation time must be between 1 and 600 minutes." });
    }
  }
  for (const field of ["bestSeller", "chefRecommended"]) {
    if (typeof updates[field] !== "undefined" && typeof updates[field] !== "boolean") return res.status(400).json({ error: `${field} must be true or false.` });
  }
  Object.assign(item, updates);
  await item.save();
  await writeAudit({ user: req.user, action: "MENU_ITEM_UPDATED", entity: "MenuItem", entityId: item._id });
  res.json({ item });
}));

app.delete("/api/restaurant/menu/:id", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const item = await MenuItem.findOneAndUpdate(
    { _id: req.params.id, restaurantId: restaurant._id, active: true },
    { $set: { active: false } },
    { new: true }
  );
  if (!item) return res.status(404).json({ error: "Menu item not found." });
  await writeAudit({ user: req.user, action: "MENU_ITEM_ARCHIVED", entity: "MenuItem", entityId: item._id });
  res.json({ item });
}));

app.post("/api/restaurant/menu", auth(), roles("RESTAURANT_OWNER", "RESTAURANT_MANAGER"), asyncRoute(async (req, res) => {
  const restaurant = await restaurantForUser(req.user);
  const { name, category, price, description } = req.body;
  if (!name || !category || !Number.isFinite(Number(price)) || Number(price) <= 0) return res.status(400).json({ error: "Item name, category and a positive price are required." });
  const preparationMinutes = Number(req.body.preparationMinutes || 15);
  if (!Number.isInteger(preparationMinutes) || preparationMinutes < 1 || preparationMinutes > 600) return res.status(400).json({ error: "Item preparation time must be between 1 and 600 minutes." });
  const item = await MenuItem.create({
    restaurantId: restaurant._id,
    name: String(name).trim(),
    category: String(category).trim(),
    description: String(description || ""),
    price: roundMoney(Number(price)),
    preparationMinutes,
    bestSeller: req.body.bestSeller === true,
    chefRecommended: req.body.chefRecommended === true,
    currency
  });
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

app.get("/api/admin/restaurants", auth(), roles("ADMIN", "SUPER_ADMIN"), asyncRoute(async (req, res) => {
  const query = req.query.status && req.query.status !== "ALL" ? { status: String(req.query.status) } : {};
  if (req.query.search) {
    const search = String(req.query.search).slice(0, 80).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    query.$or = [
      { name: { $regex: search, $options: "i" } },
      { hotelName: { $regex: search, $options: "i" } },
      { address: { $regex: search, $options: "i" } },
      { cuisine: { $elemMatch: { $regex: search, $options: "i" } } },
      { email: { $regex: search, $options: "i" } }
    ];
  }
  const requestedPage = Number(req.query.page || 1);
  if (!Number.isSafeInteger(requestedPage) || requestedPage < 1) return res.status(400).json({ error: "Page must be a positive whole number." });
  const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 50));
  const total = await Restaurant.countDocuments(query);
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const page = Math.min(requestedPage, totalPages);
  const restaurants = await Restaurant.find(query).sort({ createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean();
  res.json({ restaurants, total, page, limit, totalPages });
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
  res.status(status).json({ error: status >= 500 ? "Something went wrong. Please try again." : error.message });
});

module.exports = app;
