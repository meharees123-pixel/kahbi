require("dotenv").config({ path: require("path").resolve(__dirname, "../../.env") });
const mongoose = require("mongoose");
const app = require("./app");
const { expirePendingOrders } = require("./services");

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/kahbi";

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => console.log(`KABHI API listening on ${port}`));
  const timer = setInterval(() => {
    expirePendingOrders().catch((error) => console.error("Order timeout processing failed:", error.message));
  }, 60 * 1000);
  timer.unref();
}

start().catch((error) => {
  console.error("Unable to start KABHI API:", error.message);
  process.exit(1);
});
