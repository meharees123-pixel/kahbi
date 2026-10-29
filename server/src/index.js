const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.resolve(__dirname, "../../.env") });
// if (!process.env.SMTP_HOST || !process.env.SMTP_USER) {
//   dotenv.config({ path: path.resolve(__dirname, "../../.env.example") });
// }
const mongoose = require("mongoose");
const app = require("./app");
const { expirePendingOrders } = require("./services");
const { emailNotifications } = require("./email-notifications");

const port = Number(process.env.PORT || 3000);
const mongoUri = process.env.MONGODB_URI || "mongodb://localhost:27017/kabhi";

async function start() {
  await mongoose.connect(mongoUri);
  app.listen(port, () => console.log(`KABHI API listening on ${port}`));
  emailNotifications.processPending().catch((error) => {
    console.error("Email notification processing failed:", error.name, error.code || "");
  });
  emailNotifications.startWorker();
  const timer = setInterval(() => {
    expirePendingOrders().catch((error) => console.error("Order timeout processing failed:", error.message));
  }, 60 * 1000);
  timer.unref();
}

start().catch((error) => {
  console.error("Unable to start KABHI API:", error.message);
  process.exit(1);
});
