const test = require("node:test");
const assert = require("node:assert/strict");
const { getFirebaseAuth, verifyFirebasePhoneToken } = require("../src/firebase-auth");

test("Firebase phone token verification rejects missing tokens", async () => {
  await assert.rejects(
    verifyFirebasePhoneToken("", {}),
    (error) => error.status === 401 && error.expose === true
  );
});

test("Firebase phone token verification reports missing project configuration", async () => {
  await assert.rejects(
    verifyFirebasePhoneToken("x".repeat(200), {}),
    (error) => error.status === 503 && error.expose === true && /FIREBASE_PROJECT_ID/.test(error.message)
  );
});

test("Firebase Admin token verification initializes with a project ID and no service-account key", () => {
  const auth = getFirebaseAuth({ FIREBASE_PROJECT_ID: "kahbi-test" });
  assert.equal(auth.app.options.projectId, "kahbi-test");
});
