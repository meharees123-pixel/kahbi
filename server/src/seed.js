require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const { User, Restaurant, MenuItem, Promotion, Advertisement } = require("./models");

async function upsertUser({ name, email, phone, role, restaurantId = null }) {
  let user = await User.findOne({ email });
  if (!user) user = new User({ name, email, phone, role, restaurantId, demo: true });
  else Object.assign(user, { name, phone, role, restaurantId, demo: true, status: "ACTIVE" });
  await user.setPassword("Demo123!");
  await user.save();
}

async function seed() {
  await mongoose.connect(process.env.MONGODB_URI || "mongodb://localhost:27017/kahbi");
  let restaurant = await Restaurant.findOne({ name: "KABHI Demo Hotel", demo: true });
  if (!restaurant) {
    restaurant = await Restaurant.create({
      name: "KABHI Demo Hotel",
      hotelName: "KABHI Demonstration Kitchen",
      cuisine: ["Indian", "South Indian", "Arabic"],
      category: "Hotel Restaurant",
      description: "Demo restaurant for trying the KABHI ordering flow. Restaurant-managed delivery.",
      address: "West Bay, Doha, Qatar",
      latitude: 25.3212,
      longitude: 51.531,
      serviceRadiusKm: 20,
      phone: "+97450000001",
      whatsapp: "+97450000001",
      email: "restaurant@kahbi.demo",
      preparationMinutes: 35,
      minOrder: 0,
      maxOrder: 1000,
      status: "APPROVED",
      availability: "OPEN",
      demo: true
    });
  } else {
    restaurant.status = "APPROVED";
    restaurant.availability = "OPEN";
    await restaurant.save();
  }
  const demoItems = [
    ["Chicken Biryani", "Biryani", 25, true, false],
    ["Butter Chicken", "Main Course", 28, false, true],
    ["Masala Dosa", "South Indian", 18, true, true],
    ["Arabic Mixed Grill", "Arabic", 35, false, true],
    ["Mango Lassi", "Beverages", 12, false, false]
  ];
  for (const [name, category, price, bestSeller, chefRecommended] of demoItems) {
    await MenuItem.findOneAndUpdate(
      { restaurantId: restaurant._id, name },
      { $set: { restaurantId: restaurant._id, category, name, price, currency: "QAR", availability: "AVAILABLE", active: true, bestSeller, chefRecommended, demo: true } },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
  }
  await Promotion.findOneAndUpdate(
    { code: "KABHI10" },
    { $set: { restaurantId: restaurant._id, code: "KABHI10", title: "10% off your demo order", description: "Up to QAR 20 off your order.", discountType: "PERCENTAGE", discountValue: 10, maximumDiscount: 20, minimumOrder: 20, active: true, demo: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await Advertisement.findOneAndUpdate(
    { title: "A warm welcome from KABHI Demo Hotel", demo: true },
    { $set: { title: "A warm welcome from KABHI Demo Hotel", description: "Discover the demo kitchen and try a restaurant-managed delivery order.", placement: "HOME_BANNER", priority: 1, sponsoredLabel: "DEMO SPONSORED", active: true, demo: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  await upsertUser({ name: "Demo Customer", email: "customer@kahbi.demo", phone: "+97450000002", role: "CUSTOMER" });
  await upsertUser({ name: "Demo Restaurant Owner", email: "restaurant@kahbi.demo", phone: "+97450000001", role: "RESTAURANT_OWNER", restaurantId: restaurant._id });
  await upsertUser({ name: "Demo Admin", email: "admin@kahbi.demo", phone: "+97450000003", role: "ADMIN" });
  console.log("KABHI demo data ready. All demo account passwords are Demo123! (local use only).");
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error("Demo seeding failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
