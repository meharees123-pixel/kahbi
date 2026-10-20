const test = require("node:test");
const assert = require("node:assert/strict");
const { validatePartnerRegistration } = require("../src/partner-registration");

function validApplication() {
  return {
    restaurantName: "Pearl Garden",
    restaurantType: "Restaurant",
    primaryCuisine: "Qatari",
    additionalCuisines: ["Arabic", "Indian"],
    description: "",
    ownerName: "Amina Ahmed",
    phone: "+974 5555 1234",
    whatsapp: "+974 5555 1234",
    email: "",
    address: "West Bay, Doha",
    country: "Qatar",
    city: "Doha",
    latitude: 25.3212,
    longitude: 51.531,
    openingTime: "09:00",
    closingTime: "23:00",
    preparationMinutes: 35,
    estimatedDeliveryMinutes: 45,
    serviceRadiusKm: 5,
    extendedDeliveryAvailable: false,
    extendedDeliveryRadiusKm: null,
    minimumOrderValue: null,
    maximumOrderValue: null,
    deliveryManagedBy: "Restaurant",
    deliveryFee: null,
    freeDeliveryThreshold: null,
    currency: "QAR",
    declarations: {
      authorized: true,
      accurate: true,
      terms: true,
      approval: true,
      adminReview: true
    }
  };
}

test("partner registration accepts complete Qatar applications and applies operating defaults", () => {
  const { details, errors } = validatePartnerRegistration(validApplication());
  assert.deepEqual(errors, {});
  assert.equal(details.restaurantName, "Pearl Garden");
  assert.equal(details.country, "Qatar");
  assert.equal(details.currency, "QAR");
  assert.equal(details.extendedDeliveryRadiusKm, null);
  assert.deepEqual(details.paymentMethods, ["CASH_TO_RESTAURANT"]);
});

test("partner registration accepts cash or POS payment methods and requires at least one", () => {
  const application = validApplication();
  application.paymentMethods = ["CASH_TO_RESTAURANT", "POS_MACHINE"];
  assert.deepEqual(validatePartnerRegistration(application).details.paymentMethods, application.paymentMethods);

  application.paymentMethods = ["POS_MACHINE"];
  assert.deepEqual(validatePartnerRegistration(application).details.paymentMethods, ["POS_MACHINE"]);

  application.paymentMethods = [];
  assert.ok(validatePartnerRegistration(application).errors.paymentMethods);
  application.paymentMethods = ["UNSUPPORTED"];
  assert.ok(validatePartnerRegistration(application).errors.paymentMethods);
});

test("partner registration requires location, valid contact numbers and all declarations", () => {
  const application = validApplication();
  application.latitude = null;
  application.phone = "abc";
  application.whatsapp = "12";
  application.declarations.terms = false;
  const { errors } = validatePartnerRegistration(application);
  assert.ok(errors.mapLocation);
  assert.ok(errors.phone);
  assert.ok(errors.whatsapp);
  assert.ok(errors.declaration_terms);
});

test("partner registration pins must be located in Qatar", () => {
  const application = validApplication();
  application.latitude = 40;
  application.longitude = -74;
  const { errors } = validatePartnerRegistration(application);
  assert.ok(errors.mapLocation);
});

test("partner registration rejects invalid times, radii and order limits", () => {
  const application = validApplication();
  application.openingTime = "24:60";
  application.serviceRadiusKm = 0;
  application.extendedDeliveryAvailable = true;
  application.extendedDeliveryRadiusKm = null;
  application.minimumOrderValue = 50;
  application.maximumOrderValue = 25;
  const { errors } = validatePartnerRegistration(application);
  assert.ok(errors.openingTime);
  assert.ok(errors.serviceRadiusKm);
  assert.ok(errors.extendedDeliveryRadiusKm);
  assert.ok(errors.maximumOrderValue);
});
