const { getApps, initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");

let firebaseApp;

function getFirebaseAuth(env = process.env) {
  if (firebaseApp) return getAuth(firebaseApp);
  const projectId = env.FIREBASE_PROJECT_ID;
  if (!projectId) {
    const error = new Error("Firebase Phone Authentication is not configured. Set FIREBASE_PROJECT_ID to the Firebase project ID.");
    error.status = 503;
    error.expose = true;
    throw error;
  }
  firebaseApp = getApps().find((app) => app.name === "kahbi-phone-auth") ||
    initializeApp({ projectId }, "kahbi-phone-auth");
  return getAuth(firebaseApp);
}

async function verifyFirebasePhoneToken(idToken, env = process.env) {
  if (typeof idToken !== "string" || idToken.length < 100 || idToken.length > 8192) {
    const error = new Error("Verify your phone number with Firebase before continuing.");
    error.status = 401;
    error.expose = true;
    throw error;
  }
  let decoded;
  try {
    decoded = await getFirebaseAuth(env).verifyIdToken(idToken);
  } catch (error) {
    if (error.status === 503) throw error;
    const invalidToken = new Error("Your Firebase phone-authentication session is invalid or expired. Verify your phone again.");
    invalidToken.status = 401;
    invalidToken.expose = true;
    throw invalidToken;
  }
  const phone = decoded.phone_number;
  if (decoded.firebase?.sign_in_provider !== "phone" ||
      typeof phone !== "string" ||
      !Number.isInteger(decoded.auth_time)) {
    const error = new Error("A Firebase phone-authentication session is required.");
    error.status = 401;
    error.expose = true;
    throw error;
  }
  return { phone, authTime: decoded.auth_time };
}

module.exports = { getFirebaseAuth, verifyFirebasePhoneToken };
