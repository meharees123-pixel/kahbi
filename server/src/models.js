const mongoose = require("mongoose");
const bcrypt = require("bcryptjs");

const { Schema } = mongoose;

const UserSchema = new Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phone: { type: String, trim: true, default: "" },
    whatsappVerifiedAt: { type: Date, default: null },
    customerTermsVersion: { type: String, default: "" },
    customerTermsAcceptedAt: { type: Date, default: null },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["CUSTOMER", "RESTAURANT_OWNER", "RESTAURANT_MANAGER", "RESTAURANT_STAFF", "ADMIN", "SUPER_ADMIN"],
      required: true
    },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
    status: { type: String, enum: ["ACTIVE", "SUSPENDED", "DEACTIVATED"], default: "ACTIVE" },
    demo: { type: Boolean, default: false }
  },
  { timestamps: true }
);
UserSchema.methods.setPassword = async function setPassword(password) {
  this.passwordHash = await bcrypt.hash(password, 12);
};
UserSchema.methods.verifyPassword = function verifyPassword(password) {
  return bcrypt.compare(password, this.passwordHash);
};

const RestaurantSchema = new Schema(
  {
    name: { type: String, required: true, trim: true },
    imageData: { type: String, default: "", maxlength: 350100 },
    hotelName: { type: String, default: "" },
    cuisine: { type: [String], default: [] },
    description: { type: String, default: "" },
    address: { type: String, required: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    serviceRadiusKm: { type: Number, default: null },
    phone: { type: String, default: "" },
    whatsapp: { type: String, default: "" },
    email: { type: String, default: "" },
    preparationMinutes: { type: Number, default: 35, min: 1 },
    minOrder: { type: Number, default: 0, min: 0 },
    maxOrder: { type: Number, default: 1000, min: 1 },
    paymentMethods: { type: [String], enum: ["CASH_TO_RESTAURANT", "POS_MACHINE"], default: ["CASH_TO_RESTAURANT"] },
    status: {
      type: String,
      enum: ["DRAFT", "PENDING_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"],
      default: "PENDING_REVIEW"
    },
    availability: { type: String, enum: ["OPEN", "CLOSED", "TEMPORARILY_UNAVAILABLE", "PAUSED"], default: "OPEN" },
    demo: { type: Boolean, default: false },
    category: { type: String, default: "Restaurant" },
    partnerRegistrationId: { type: String, default: undefined, unique: true, sparse: true },
    ratingAverage: { type: Number, default: 0 },
    ratingCount: { type: Number, default: 0 }
  },
  { timestamps: true }
);

const MenuItemSchema = new Schema(
  {
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    category: { type: String, required: true, trim: true },
    name: { type: String, required: true, trim: true },
    imageData: { type: String, default: "", maxlength: 350100 },
    imageUrl: { type: String, default: "", maxlength: 2048 },
    itemCode: { type: String, default: undefined, trim: true, maxlength: 100 },
    availabilityStart: { type: String, default: "" },
    availabilityEnd: { type: String, default: "" },
    description: { type: String, default: "" },
    price: { type: Number, required: true, min: 0 },
    discountPrice: { type: Number, default: null, min: 0 },
    foodType: { type: String, enum: ["VEGETARIAN", "NON_VEGETARIAN", "VEGAN", null], default: null },
    customizationOptions: { type: String, default: "", maxlength: 1000 },
    currency: { type: String, default: "QAR" },
    availability: { type: String, enum: ["AVAILABLE", "UNAVAILABLE", "TEMPORARILY_UNAVAILABLE"], default: "AVAILABLE" },
    approvalStatus: { type: String, enum: ["PENDING_REVIEW", "APPROVED", "REJECTED"], default: "APPROVED", index: true },
    active: { type: Boolean, default: true },
    bestSeller: { type: Boolean, default: false },
    chefRecommended: { type: Boolean, default: false },
    preparationMinutes: { type: Number, default: 15, min: 1 },
    demo: { type: Boolean, default: false }
  },
  { timestamps: true }
);
MenuItemSchema.index({ restaurantId: 1, itemCode: 1 }, {
  unique: true,
  partialFilterExpression: { itemCode: { $type: "string" } }
});

const OrderSchema = new Schema(
  {
    reference: { type: String, required: true, unique: true },
    idempotencyKey: { type: String, required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
    guest: {
      name: { type: String, default: "" },
      phone: { type: String, default: "" }
    },
    restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
    restaurantName: { type: String, required: true },
    items: [{
      menuItemId: { type: Schema.Types.ObjectId, ref: "MenuItem", required: true },
      name: { type: String, required: true },
      unitPrice: { type: Number, required: true },
      quantity: { type: Number, required: true, min: 1 },
      lineTotal: { type: Number, required: true },
      instructions: { type: String, default: "" }
    }],
    address: { type: String, required: true },
    latitude: { type: Number, default: null },
    longitude: { type: Number, default: null },
    subtotal: { type: Number, required: true },
    discount: { type: Number, default: 0 },
    deliveryFee: { type: Number, default: 0 },
    adminFee: { type: Number, default: 0 },
    tax: { type: Number, default: 0 },
    total: { type: Number, required: true },
    currency: { type: String, default: "QAR" },
    promotionCode: { type: String, default: "" },
    paymentMethod: { type: String, enum: ["CASH_TO_RESTAURANT", "POS_MACHINE"], default: "CASH_TO_RESTAURANT" },
    paymentStatus: { type: String, enum: ["NOT_REQUIRED", "PENDING", "PAID", "FAILED", "REFUNDED", "PARTIALLY_REFUNDED"], default: "NOT_REQUIRED" },
    status: { type: String, default: "RESTAURANT_PENDING", index: true },
    estimatedPreparationMinutes: { type: Number, default: 35 },
    cancellationReason: { type: String, default: "" },
    rejectionReason: { type: String, default: "" },
    commissionRate: { type: Number, default: 0 },
    commissionAmount: { type: Number, default: 0 },
    statusHistory: [{
      previousStatus: { type: String, default: "" },
      status: { type: String, required: true },
      changedBy: { type: String, default: "SYSTEM" },
      role: { type: String, default: "SYSTEM" },
      reason: { type: String, default: "" },
      createdAt: { type: Date, default: Date.now }
    }],
    customerTermsVersion: { type: String, default: "" },
    customerTermsAcceptedAt: { type: Date, default: null },
    completedAt: { type: Date, default: null }
  },
  { timestamps: true }
);
OrderSchema.index({ customerId: 1, createdAt: -1 });
OrderSchema.index({ restaurantId: 1, status: 1, createdAt: -1 });

const BillingTransactionSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  transactionType: { type: String, default: "ORDER_COMPLETED" },
  grossAmount: { type: Number, required: true },
  commissionRate: { type: Number, required: true },
  commissionAmount: { type: Number, required: true },
  adminFee: { type: Number, default: 0 },
  advertisementFee: { type: Number, default: 0 },
  promotionFee: { type: Number, default: 0 },
  netRestaurantAmount: { type: Number, required: true },
  currency: { type: String, default: "QAR" },
  status: { type: String, default: "RECORDED" }
}, { timestamps: true });

const PromotionSchema = new Schema({
  code: { type: String, required: true, unique: true, uppercase: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
  title: { type: String, required: true },
  description: { type: String, default: "" },
  discountType: { type: String, enum: ["PERCENTAGE", "FIXED_AMOUNT"], default: "PERCENTAGE" },
  discountValue: { type: Number, required: true, min: 0 },
  minimumOrder: { type: Number, default: 0 },
  maximumDiscount: { type: Number, default: 1000 },
  usageLimit: { type: Number, default: 0 },
  usageCount: { type: Number, default: 0 },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  demo: { type: Boolean, default: false }
}, { timestamps: true });

const AdvertisementSchema = new Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  description: { type: String, default: "", maxlength: 500 },
  placement: { type: String, enum: ["HOME_BANNER", "RESTAURANT_LISTING", "RESTAURANT_PAGE"], default: "HOME_BANNER" },
  priority: { type: Number, default: 0 },
  sponsoredLabel: { type: String, default: "Sponsored" },
  startsAt: { type: Date, default: Date.now },
  endsAt: { type: Date, default: null },
  active: { type: Boolean, default: true },
  demo: { type: Boolean, default: false }
}, { timestamps: true });

const AdvertisementEventSchema = new Schema({
  advertisementId: { type: Schema.Types.ObjectId, ref: "Advertisement", required: true, index: true },
  eventType: { type: String, enum: ["IMPRESSION", "CLICK"], required: true },
  createdAt: { type: Date, default: Date.now, index: true }
}, { versionKey: false });

const RatingSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", required: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true },
  stars: { type: Number, required: true, min: 1, max: 5 },
  comment: { type: String, default: "", maxlength: 1000 }
}, { timestamps: true });

const FeedbackSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", required: true, unique: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: "User", default: null, index: true },
  customerContact: { type: String, default: "", trim: true },
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", required: true, index: true },
  overallRating: { type: Number, required: true, min: 1, max: 5 },
  foodRating: { type: Number, default: null, min: 1, max: 5 },
  deliveryRating: { type: Number, default: null, min: 1, max: 5 },
  comment: { type: String, default: "", maxlength: 500 },
  submittedAt: { type: Date, default: Date.now }
}, { timestamps: true });

const AuditSchema = new Schema({
  userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  role: { type: String, default: "SYSTEM" },
  action: { type: String, required: true },
  entity: { type: String, required: true },
  entityId: { type: String, default: "" },
  details: { type: Schema.Types.Mixed, default: {} }
}, { timestamps: true });

const MessageLogSchema = new Schema({
  orderId: { type: Schema.Types.ObjectId, ref: "Order", default: null },
  recipient: { type: String, required: true },
  direction: { type: String, default: "OUTBOUND" },
  template: { type: String, required: true },
  status: { type: String, enum: ["NOT_CONFIGURED", "QUEUED", "SENT", "DELIVERED", "FAILED"], default: "NOT_CONFIGURED" },
  error: { type: String, default: "WhatsApp provider is not configured; demo mode only." }
}, { timestamps: true });

const WhatsappOtpSchema = new Schema({
  phone: { type: String, required: true, index: true },
  purpose: { type: String, enum: ["LOGIN", "ORDER"], required: true },
  codeHash: { type: String, required: true },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true },
  consumedAt: { type: Date, default: null },
  deleteAt: { type: Date, required: true }
}, { timestamps: true });
WhatsappOtpSchema.index({ phone: 1, purpose: 1, createdAt: -1 });
WhatsappOtpSchema.index({ deleteAt: 1 }, { expireAfterSeconds: 0 });

const WhatsappSettingsSchema = new Schema({
  key: { type: String, required: true, unique: true },
  encryptedConfiguration: {
    salt: { type: String, required: true },
    iv: { type: String, required: true },
    authTag: { type: String, required: true },
    ciphertext: { type: String, required: true }
  },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

const WhatsappOtpControlSchema = new Schema({
  key: { type: String, required: true, unique: true },
  deliveryEnabled: { type: Boolean, required: true, default: true },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

const RestaurantRegistrationSchema = new Schema({
  registrationId: { type: String, required: true, unique: true },
  requestId: { type: String, required: true, unique: true },
  details: { type: Schema.Types.Mixed, required: true },
  termsVersion: { type: String, required: true },
  termsAcceptedAt: { type: Date, required: true },
  status: {
    type: String,
    enum: ["PENDING_VERIFICATION", "UNDER_REVIEW", "APPROVED", "REJECTED", "SUSPENDED"],
    default: "PENDING_VERIFICATION",
    index: true
  },
  accessTokenHash: { type: String, required: true, select: false },
  activationTokenHash: { type: String, default: "", select: false },
  activationExpiresAt: { type: Date, default: null },
  activatedAt: { type: Date, default: null },
  restaurantId: { type: Schema.Types.ObjectId, ref: "Restaurant", default: null },
  adminReviewerId: { type: Schema.Types.ObjectId, ref: "User", default: null },
  reviewedAt: { type: Date, default: null },
  reviewReason: { type: String, default: "" },
  correctionAllowed: { type: Boolean, default: false }
}, { timestamps: true });
RestaurantRegistrationSchema.index({ status: 1, createdAt: -1 });

const PlatformSettingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: { type: String, default: "" },
  updatedBy: { type: Schema.Types.ObjectId, ref: "User", default: null }
}, { timestamps: true });

module.exports = {
  User: mongoose.model("User", UserSchema),
  Restaurant: mongoose.model("Restaurant", RestaurantSchema),
  MenuItem: mongoose.model("MenuItem", MenuItemSchema),
  Order: mongoose.model("Order", OrderSchema),
  BillingTransaction: mongoose.model("BillingTransaction", BillingTransactionSchema),
  Promotion: mongoose.model("Promotion", PromotionSchema),
  Advertisement: mongoose.model("Advertisement", AdvertisementSchema),
  AdvertisementEvent: mongoose.model("AdvertisementEvent", AdvertisementEventSchema),
  Rating: mongoose.model("Rating", RatingSchema),
  Feedback: mongoose.model("Feedback", FeedbackSchema),
  AuditLog: mongoose.model("AuditLog", AuditSchema),
  MessageLog: mongoose.model("MessageLog", MessageLogSchema),
  WhatsappOtp: mongoose.model("WhatsappOtp", WhatsappOtpSchema),
  WhatsappSettings: mongoose.model("WhatsappSettings", WhatsappSettingsSchema),
  WhatsappOtpControl: mongoose.model("WhatsappOtpControl", WhatsappOtpControlSchema),
  RestaurantRegistration: mongoose.model("RestaurantRegistration", RestaurantRegistrationSchema),
  PlatformSetting: mongoose.model("PlatformSetting", PlatformSettingSchema)
};
