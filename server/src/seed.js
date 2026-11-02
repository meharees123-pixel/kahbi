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
  const mongoUri = process.env.MONGODB_URI;
  if (!mongoUri) throw new Error("MONGODB_URI must be set to the MongoDB connection string.");
  await mongoose.connect(mongoUri);
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
  const additionalRestaurants = [
    {
      name: "Pearl Garden Kitchen",
      ownerName: "Pearl Garden Owner",
      ownerEmail: "owner.pearl@kahbi.demo",
      phone: "+97450000011",
      cuisine: ["Chinese", "Asian"],
      category: "Restaurant",
      description: "Fresh Asian favorites made for sharing.",
      address: "The Pearl, Doha, Qatar",
      latitude: 25.3678,
      longitude: 51.5507,
      serviceRadiusKm: 18,
      items: [
        ["Crispy Chicken Dumplings", "Starters", 24],
        ["Beef Chow Mein", "Noodles", 38],
        ["Sweet and Sour Chicken", "Main Course", 42],
        ["Vegetable Fried Rice", "Rice", 29]
      ]
    },
    {
      name: "Souq Flame Grill",
      ownerName: "Souq Flame Owner",
      ownerEmail: "owner.souq@kahbi.demo",
      phone: "+97450000012",
      cuisine: ["Arabic", "Grill"],
      category: "Restaurant",
      description: "Charcoal-grilled classics with warm Arabic sides.",
      address: "Msheireb Downtown, Doha, Qatar",
      latitude: 25.2856,
      longitude: 51.5333,
      serviceRadiusKm: 16,
      items: [
        ["Chicken Shish Tawook", "Grill", 36],
        ["Lamb Kofta Plate", "Grill", 48],
        ["Hummus and Fresh Bread", "Starters", 18],
        ["Mixed Grill for Two", "Grill", 78]
      ]
    },
    {
      name: "Corniche Breakfast Club",
      ownerName: "Corniche Breakfast Owner",
      ownerEmail: "owner.corniche@kahbi.demo",
      phone: "+97450000013",
      cuisine: ["Breakfast", "Cafe"],
      category: "Cafe",
      description: "All-day breakfast, specialty coffee, and cafe favorites.",
      address: "Al Corniche, Doha, Qatar",
      latitude: 25.3042,
      longitude: 51.5328,
      serviceRadiusKm: 15,
      items: [
        ["Shakshuka and Toast", "Breakfast", 32],
        ["Halloumi Avocado Toast", "Breakfast", 34],
        ["Pancake Stack", "Breakfast", 28],
        ["Iced Spanish Latte", "Coffee", 22]
      ]
    },
    {
      name: "Lusail Spice House",
      ownerName: "Lusail Spice Owner",
      ownerEmail: "owner.lusail@kahbi.demo",
      phone: "+97450000014",
      cuisine: ["Indian", "Pakistani"],
      category: "Restaurant",
      description: "Slow-cooked curries, fragrant rice, and tandoor favorites.",
      address: "Marina District, Lusail, Qatar",
      latitude: 25.4208,
      longitude: 51.4905,
      serviceRadiusKm: 20,
      items: [
        ["Chicken Dum Biryani", "Biryani", 32],
        ["Paneer Tikka Masala", "Main Course", 35],
        ["Beef Nihari", "Main Course", 45],
        ["Garlic Naan", "Bread", 8]
      ]
    }
  ];
  for (const entry of additionalRestaurants) {
    const { items, ownerName, ownerEmail, ...restaurantFields } = entry;
    const additionalRestaurant = await Restaurant.findOneAndUpdate(
      { name: restaurantFields.name, demo: true },
      {
        $set: {
          ...restaurantFields,
          hotelName: "",
          whatsapp: restaurantFields.phone,
          email: ownerEmail,
          preparationMinutes: 30,
          minOrder: 0,
          maxOrder: 1000,
          status: "APPROVED",
          availability: "OPEN",
          demo: true
        }
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    for (const [name, category, price] of items) {
      await MenuItem.findOneAndUpdate(
        { restaurantId: additionalRestaurant._id, name },
        { $set: { restaurantId: additionalRestaurant._id, category, name, price, currency: "QAR", availability: "AVAILABLE", active: true, bestSeller: false, chefRecommended: false, demo: true } },
        { upsert: true, new: true, setDefaultsOnInsert: true }
      );
    }
    await upsertUser({
      name: ownerName,
      email: ownerEmail,
      phone: restaurantFields.phone,
      role: "RESTAURANT_OWNER",
      restaurantId: additionalRestaurant._id
    });
  }
  console.log("KABHI demo data ready. Restaurant/admin demo passwords are Demo123! (local use only). Customer sign-in uses WhatsApp OTP.");
  await mongoose.disconnect();
}

seed().catch(async (error) => {
  console.error("Demo seeding failed:", error.message);
  await mongoose.disconnect().catch(() => {});
  process.exit(1);
});
