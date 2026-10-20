const { isValidCoordinate, isValidServiceRadius } = require("./rules");

const RESTAURANT_TYPES = ["Hotel Restaurant", "Restaurant", "Café", "Cloud Kitchen", "Other"];
const PAYMENT_METHODS = ["CASH_TO_RESTAURANT", "POS_MACHINE"];
const CUISINE_LIMIT = 10;
const PHONE_PATTERN = /^\+?[0-9 ()-]{8,20}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

function optionalText(value, maxLength = 250) {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

function validPhone(value) {
  const phone = optionalText(value, 30);
  const digits = phone.replace(/\D/g, "");
  return PHONE_PATTERN.test(phone) && digits.length >= 8 && digits.length <= 15;
}

function optionalNumber(value, field, errors, { min = 0, max = 100000 } = {}) {
  if (value === "" || value === null || value === undefined) return null;
  if (typeof value !== "number" && typeof value !== "string") {
    errors[field] = `Enter a number between ${min} and ${max}.`;
    return null;
  }
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) {
    errors[field] = `Enter a number between ${min} and ${max}.`;
    return null;
  }
  return number;
}

function validatePartnerRegistration(input) {
  const errors = {};
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const details = {};
  const requiredText = (key, label, minLength = 1, maxLength = 250) => {
    const value = optionalText(source[key], maxLength);
    if (value.length < minLength) errors[key] = `${label} is required.`;
    details[key] = value;
  };

  requiredText("restaurantName", "Restaurant / Hotel Name", 2, 120);
  details.restaurantType = optionalText(source.restaurantType, 50);
  if (!RESTAURANT_TYPES.includes(details.restaurantType)) errors.restaurantType = "Choose a valid restaurant type.";
  requiredText("primaryCuisine", "Primary Cuisine", 2, 80);
  details.additionalCuisines = Array.isArray(source.additionalCuisines)
    ? [...new Set(source.additionalCuisines.filter((value) => typeof value === "string").map((value) => value.trim().slice(0, 80)).filter(Boolean))].slice(0, CUISINE_LIMIT)
    : [];
  details.description = optionalText(source.description, 1000);
  details.logoImageData = typeof source.logoImageData === "string" ? source.logoImageData : "";
  details.coverImageData = typeof source.coverImageData === "string" ? source.coverImageData : "";
  details.paymentMethods = Array.isArray(source.paymentMethods)
    ? [...new Set(source.paymentMethods.filter((method) => PAYMENT_METHODS.includes(method)))]
    : ["CASH_TO_RESTAURANT"];
  if (!details.paymentMethods.length ||
      (Array.isArray(source.paymentMethods) && details.paymentMethods.length !== new Set(source.paymentMethods).size)) {
    errors.paymentMethods = "Select at least one supported payment method.";
  }

  requiredText("ownerName", "Owner / Authorized Representative Name", 2, 100);
  details.phone = optionalText(source.phone, 30);
  details.whatsapp = optionalText(source.whatsapp, 30);
  if (!validPhone(details.phone)) errors.phone = "Enter a valid contact number, including country code.";
  if (!validPhone(details.whatsapp)) errors.whatsapp = "Enter a valid WhatsApp number, including country code.";
  details.email = optionalText(source.email, 254).toLowerCase();
  if (details.email && !EMAIL_PATTERN.test(details.email)) errors.email = "Enter a valid business email address.";
  requiredText("address", "Restaurant Address", 5, 300);
  details.country = optionalText(source.country, 80);
  if (details.country !== "Qatar") errors.country = "Country must be Qatar for the initial launch.";
  requiredText("city", "City / Municipality", 2, 100);
  details.zoneNumber = optionalText(source.zoneNumber, 30);
  details.streetBuilding = optionalText(source.streetBuilding, 120);
  details.latitude = Number(source.latitude);
  details.longitude = Number(source.longitude);
  if (source.latitude === "" || source.latitude === null || source.latitude === undefined ||
      source.longitude === "" || source.longitude === null || source.longitude === undefined ||
      !isValidCoordinate(details.latitude, 24.4, 26.2) || !isValidCoordinate(details.longitude, 50.7, 51.8)) {
    errors.mapLocation = "Select the restaurant location on the map within Qatar.";
    details.latitude = null;
    details.longitude = null;
  }

  for (const field of ["openingTime", "closingTime"]) {
    details[field] = optionalText(source[field], 5);
    if (details[field] && !TIME_PATTERN.test(details[field])) errors[field] = "Enter a valid time in 24-hour HH:MM format.";
  }
  for (const [field, label, fallback, maximum] of [
    ["preparationMinutes", "Preparation time", 35, 360],
    ["estimatedDeliveryMinutes", "Estimated delivery time", 45, 720]
  ]) {
    const value = source[field] === "" || source[field] === null || source[field] === undefined ? fallback : Number(source[field]);
    if (!Number.isInteger(value) || value < 1 || value > maximum) errors[field] = `${label} must be a whole number between 1 and ${maximum}.`;
    details[field] = value;
  }
  details.serviceRadiusKm = Number(source.serviceRadiusKm);
  if (!isValidServiceRadius(details.serviceRadiusKm)) errors.serviceRadiusKm = "Delivery radius must be between 0.5 and 100 km.";
  details.extendedDeliveryAvailable = source.extendedDeliveryAvailable === true;
  details.extendedDeliveryRadiusKm = optionalNumber(source.extendedDeliveryRadiusKm, "extendedDeliveryRadiusKm", errors, { min: 0.5, max: 200 });
  if (details.extendedDeliveryAvailable && details.extendedDeliveryRadiusKm === null) {
    errors.extendedDeliveryRadiusKm = "Enter an extended delivery radius when extended delivery is enabled.";
  }
  details.minimumOrderValue = optionalNumber(source.minimumOrderValue, "minimumOrderValue", errors);
  details.maximumOrderValue = optionalNumber(source.maximumOrderValue, "maximumOrderValue", errors);
  if (details.minimumOrderValue !== null &&
      (details.maximumOrderValue ?? 1000) < details.minimumOrderValue) {
    errors.maximumOrderValue = "Maximum order value must be at least the minimum order value.";
  }
  details.deliveryManagedBy = optionalText(source.deliveryManagedBy, 30);
  if (!["Restaurant", "Hotel"].includes(details.deliveryManagedBy)) errors.deliveryManagedBy = "Choose Restaurant or Hotel.";
  details.deliveryFee = optionalNumber(source.deliveryFee, "deliveryFee", errors);
  details.freeDeliveryThreshold = optionalNumber(source.freeDeliveryThreshold, "freeDeliveryThreshold", errors);
  details.currency = optionalText(source.currency, 3);
  if (details.currency !== "QAR") errors.currency = "Currency must be QAR.";

  const declarationKeys = ["authorized", "accurate", "terms", "approval", "adminReview"];
  details.declarations = {};
  for (const key of declarationKeys) {
    details.declarations[key] = source.declarations?.[key] === true;
    if (!details.declarations[key]) errors[`declaration_${key}`] = "This declaration is required.";
  }
  for (const field of ["logoImageData", "coverImageData"]) {
    if (details[field] && (!details[field].startsWith("data:image/") || details[field].length > 350100)) {
      errors[field] = "Choose a valid image smaller than 256 KB.";
    }
  }
  return { details, errors };
}

module.exports = { PAYMENT_METHODS, validatePartnerRegistration, validPhone };
