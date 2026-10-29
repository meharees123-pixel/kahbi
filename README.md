# KABHI

KABHI is a Qatar-focused ordering platform MVP. It keeps customer ordering, restaurant operations, and administration in separate server-authorized roles. Restaurants remain responsible for preparation and delivery; the platform does not dispatch couriers.

## Run locally with Docker (one command)

Install and start Docker Desktop, then run this from the project directory:

```sh
npm run local
```

This starts MongoDB, seeds the demo data, and launches the API and web app. Open [http://localhost:4200](http://localhost:4200). The API health endpoint is [http://localhost:3000/api/health](http://localhost:3000/api/health). Stop the stack with `Ctrl+C`.

Order status changes are pushed over a single authenticated Server-Sent Events connection instead of polling order lists every few seconds. Redis Pub/Sub distributes those events between API instances; Docker Compose starts Redis for local use. A single local API process can run without Redis, but production must configure `REDIS_URL` to a shared Redis service, and startup fails if production Redis is missing. Each instance holds open client connections, sends only small status events, routes events only to the affected order's subscribers, reconciles after Redis reconnects, and closes browser streams when the page is hidden. Plan and load-test API, Redis, reverse-proxy connection limits, and file-descriptor capacity for the expected number of concurrent connections; the application change alone is not a 10,000-connection capacity guarantee.

By default the API and seeder use the local MongoDB container and the `kabhi` database. `.env.example` is only a template; Compose reads the ignored root `.env` file. To use MongoDB Atlas locally, set `MONGODB_URI` in root `.env` to your Atlas connection string; Compose passes the same value to both the API and seeder. Include the intended database path in the URI (this project uses `/kabhi`) so you do not accidentally use MongoDB's default database. Keep `.env` private and never commit it. Ensure the Atlas database user has read/write access, the machine's IP is permitted by the Atlas network access list, and any special characters in the password are percent-encoded. The Compose MongoDB container may still appear as running, but when root `.env` points to Atlas, neither the API nor seeder uses that local database.

The restaurant location picker needs a Google Maps JavaScript API key. Set `GOOGLE_MAPS_API_KEY` in the ignored **root** `.env` file (not `client/.env` or `server/.env`), enable the Maps JavaScript API for that key, and restart the API so it reloads the environment. Both `npm run dev` and Docker Compose read the root `.env`; after changing it, restart `npm run dev` or stop and rerun `npm run local`. The API returns this key to the browser for the map picker, so restrict it to your frontend's HTTP referrers and the required Maps API.

For a deployed server, configure `MONGODB_URI` and `REDIS_URL` as private server-side environment variables on the API service; do not put them in the frontend or source code. Use the same Atlas database path and confirm the deployed server's IP/network access is allowed in Atlas. All API instances must use the same Redis service so status events reach clients connected to any instance.

Customer sign-in, checkout verification, and restaurant Login ID/password recovery use Firebase Phone Authentication and SMS; customer passwords are not used. WhatsApp OTP delivery and its Admin settings have been removed. Restaurant recovery codes are verified by Firebase, expire after five minutes by default, can be configured with `RECOVERY_OTP_TTL_MINUTES` (1–15 minutes), and are limited to five requests per phone per hour. Password reset requires a 10–200 character password containing a letter and a number, stores it using the existing bcrypt password hasher, and invalidates previously issued sessions. Recovery requests and successful/failed recovery events are written to the audit log. Recovery responses do not disclose account details. Pending, inactive, or suspended partners are directed to Contact KABHI; when a registered phone is inaccessible, Support must verify the partner's identity using independently verified business records before helping update the registered contact method. Admins cannot read password hashes or retrieve passwords.

## Firebase Console setup

Do this once per Firebase project. Firebase's web configuration (including its API key) is public client configuration. The API uses Firebase Admin SDK to verify Firebase ID token signatures against Google's public signing certificates; it needs the Firebase project ID, but does not need a service-account key or Firebase Authentication Admin IAM role for token verification.

1. Open the [Firebase Console](https://console.firebase.google.com/), create a project (or select the project you want KABHI to use), and note its **Project ID**.
2. In **Project settings → General → Your apps**, register a **Web app**. Copy its Firebase configuration values (`apiKey`, `authDomain`, `projectId`, and `appId`) into `client/src/app/firebase-config.ts`. This file is used by the browser app; do not put a service-account key or other private credential here.
3. In **Build → Authentication → Sign-in method**, enable **Phone** and save. In **Authentication → Settings → Authorized domains**, make sure `localhost` and your deployed frontend hostname are listed. Review the SMS region policy and allow the countries where your customers and restaurant partners receive codes (for example, Qatar).
4. For local development, use **Authentication → Sign-in method → Phone numbers for testing** to add test numbers and fixed verification codes. Otherwise Firebase sends real SMS messages and project SMS quotas/billing rules apply. Never use a production user's number as a test account.
5. Configure the API with the same **Project ID** in the ignored root `.env`:

   ```env
   FIREBASE_PROJECT_ID=kabhiofficial
   ```

   The local Docker Compose configuration defaults to `kabhiofficial`; set `FIREBASE_PROJECT_ID` explicitly if your Firebase project has a different ID. No downloaded service-account key or extra IAM permission is required for Firebase token verification.
6. Keep `RECOVERY_OTP_TTL_MINUTES=5` (or choose a whole number from 1 to 15). For the local MongoDB container, `MONGODB_URI` must be `mongodb://mongodb:27017/kabhi`, not `localhost`.
7. Save the `.env` values, enter the web configuration in `firebase-config.ts`, then run `npm run local` (Docker rebuilds both services). For non-Docker development, install dependencies with `npm run install:all`, then run `npm run dev`.
8. Open [Customer sign-in](http://localhost:4200/login/customer), select the phone country code (Qatar `+974` is selected by default), enter the national number without the calling code, request an SMS code, and sign in. Verify a new customer can also request a code during checkout. Test **Forgot Login ID** and **Forgot Password** from the restaurant portal; both now require the registered phone number. Firebase verifies the ID token on the API before it creates a customer session or grants account recovery.

For production, add the deployed frontend hostname to Firebase's Authorized domains, configure `FIREBASE_PROJECT_ID` in the API environment, and rebuild/redeploy the frontend after updating `firebase-config.ts`. The API verifies ID token signatures and claims but does not call Firebase to check immediate token revocation; customer and recovery flows separately require a recent phone authentication. If you previously stored a Meta WhatsApp access token for OTP delivery, revoke it in Meta because this app no longer uses it.

The first startup seeds a clearly labeled demo restaurant, menu, promotion, and accounts. Seeding is safe to repeat. Restaurant and admin demo passwords are `Demo123!`; for the demo customer number `+97450000002`, add a Firebase test phone number or use a number that can receive Firebase SMS:

| Portal | Sign-in URL | Demo identity |
| --- | --- | --- |
| Customer | [http://localhost:4200/login/customer](http://localhost:4200/login/customer) | Phone `+97450000002` |
| Restaurant owner — KABHI Demo Hotel | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `restaurant@kahbi.demo` |
| Restaurant owner — Pearl Garden Kitchen | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.pearl@kahbi.demo` |
| Restaurant owner — Souq Flame Grill | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.souq@kahbi.demo` |
| Restaurant owner — Corniche Breakfast Club | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.corniche@kahbi.demo` |
| Restaurant owner — Lusail Spice House | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.lusail@kahbi.demo` |
| Admin | [http://localhost:4200/login/admin](http://localhost:4200/login/admin) | `admin@kahbi.demo` |

Use `Demo123!` for all demo accounts. Each restaurant-owner account is scoped to its own restaurant; the admin account can manage all restaurants. The login API also enforces the selected portal, so a restaurant or admin account cannot sign in through the customer portal. Customer accounts are created after Firebase phone verification. Restaurant partners apply publicly and can create a login only after Admin approval; admin signup is disabled.

## Run without Docker

Requirements: Node.js 22.22.3+ (or 24.15.0+) and MongoDB 7+ running locally.

1. Copy `.env.example` to `.env` (the server and seeder load this root file), set a private `JWT_SECRET`, and configure `MONGODB_URI` for local MongoDB or Atlas.
2. Run `npm run install:all` to install the root, API, and Angular dependencies.
3. Run `npm run seed` once to create demo data.
4. Run `npm run dev`; the Angular UI is at `http://localhost:4200` and API at `http://localhost:3000`.

Production API: `npm start`. Production Angular build: `npm run build`.

## Google Cloud deployment

`.github/workflows/google-cloud-deploy.yml` tests and builds on pull requests to `main`, then builds and deploys the API and production Angular/Nginx frontend to Cloud Run after changes reach `main`. Deployment is intentionally gated until `KAHBI_GCP_DEPLOY_ENABLED=true` is added as a GitHub Actions repository variable and the Google Cloud settings are configured. The frontend serves the Angular production bundle and proxies `/api` requests to the API service; local development continues to use `localhost:3000`.

See [Google Cloud deployment setup](.github/DEPLOYMENT.md) for required GitHub variables, the `GCP_SA_KEY` GitHub Actions secret, Artifact Registry, Cloud Run and Secret Manager setup. No service-account key or database credential belongs in Git. Production secrets are injected from Secret Manager. The release workflow does not seed demo accounts or reset passwords.

## Free-delivery locations and OpenStreetMap

The customer home page lets customers choose a delivery pin or use browser geolocation. KABHI then shows approved restaurants whose configured delivery radius covers that point, nearest first. Checkout requires the pin and the customer's full building/street address; the API checks coverage again before creating an order. Restaurant partners provide a location and a 0.5–100 km standard delivery radius in the public registration. Admins can set or update the restaurant's operational delivery area in restaurant management.

The map uses OpenStreetMap tiles through Leaflet and reverse-geocodes selected pins with the OpenStreetMap Nominatim service. No API key or billing setup is required. The map displays the required OpenStreetMap attribution. An internet connection is needed to load map tiles and look up a nearby address; if lookup is unavailable, the selected coordinates still work and the address can be entered manually.

The public OpenStreetMap tile and Nominatim services have usage policies and are intended for modest development use, not unrestricted high-volume production traffic. For production, review their current policies and choose an appropriately hosted tile/geocoding service if needed.

## Working MVP flow

- Browse approved restaurants and menus as a guest, search and filter by cuisine/status, and add menu items to a single-restaurant cart.
- Customer sign-in is passwordless and requires Firebase phone verification every time. Before the first checkout order on a new customer session, verify the phone number; this creates the customer account and links that order to it. The API verifies Firebase ID tokens and validates restaurant and item availability, quantities, service radius, promotion and all amounts before creating an order. An idempotency key prevents duplicate submissions.
- Track a guest order by its order reference and phone number; signed-in customers have private order history and may rate completed orders.
- Sign in as the restaurant owner to view only that restaurant's orders and advance valid order states through accept, prepare, ready, delivery, and completion. Menu availability can be changed from the restaurant view.
- Sign in as admin to view live database metrics, manage restaurants from a searchable card directory with a separate profile/menu editor, approve/reject/suspend restaurants, and accept/reject or advance orders through their valid lifecycle. Billing snapshots and audit events are recorded for completed orders and administrative decisions.
- Admins can manage customer account status, promotions and sponsored home banners. Served banner impressions are recorded; click/conversion analytics are not enabled.
- Restaurant partners can apply at `/partner/register`; submitted applications remain separate from the Restaurant Master until an Admin approves them. Approval creates a closed, pending-review restaurant record, and customer visibility still requires Admin restaurant approval, an approved menu item, and the restaurant being open.

## Restaurant partner registration

The public registration page captures restaurant, representative, Qatar address/map, operating, delivery, commercial, and declaration details. It previews the information before submission, validates fields in both the browser and API, and records the accepted partner-terms version (`2026-10-v1`) and timestamp. An application receives a `KBR-<year>-<id>` Registration ID and a private browser session access token; applicants can refresh their status from the same browser. Admins review applications in the Admin dashboard, can start review, approve, reject with a reason, request corrections, or suspend an approved registration. Corrections are only accepted after an Admin request.

Approving an application creates the existing Restaurant Master record in `PENDING_REVIEW` and `CLOSED` states; it does not approve customer visibility or menu items. The Admin receives a seven-day, one-use activation link in the dashboard. The partner creates a password and login email with that link. Menu items submitted by an activated partner remain pending Admin review and are excluded from customer menus and order creation until approved. The Admin must then approve the Restaurant Master record (which requires an approved menu item) and separately open it when operations are ready. Registration actions, terms acceptance, menu review, logo updates, and Admin decisions use the existing audit log.

The public KABHI logo is controlled by an Admin-managed image setting. Admins can upload a JPEG, PNG, or WebP logo (optimized to 256 KB); clearing it restores the KABHI text mark. Partner registration status is protected by a random per-application access token retained in the browser session; Admin-only endpoints protect review data and activation-link creation.

Partner approval activation links use `CLIENT_ORIGIN` to build the frontend URL. Set it to the deployed HTTPS origin in production. WhatsApp/email partner notifications are not configured by this MVP: an approval is audit/message-logged and the Admin must deliver the one-time activation link through an approved secure channel. The legal information pages in this MVP summarize the stated onboarding flow and must be replaced or approved by KABHI's legal owner before production use.

## Restaurant bulk menu upload

After signing in, restaurant owners and managers can choose **Import Menu** in the menu area to upload menu files. It accepts JPG/PNG photos, PDF files (including scanned PDFs), `.docx` Word files, `.xlsx` Excel files, and CSV files. Each file may be up to 10 MB; upload up to 10 files at once with a 20 MB combined limit. Office documents are converted to bounded text on the API server, while image and PDF bytes are sent to Gemini using inline data. The API server requires `GEMINI_API_KEY`; set it in the ignored local `.env` or as a deployment secret. `GEMINI_MODEL` defaults to `gemini-2.5-flash` and can be overridden. The requested `gemini-1.5-flash` model has been retired by Google, so it is not used as the default. Uploaded file contents are sent to Google Gemini for extraction; review Google's applicable data terms before enabling this for real restaurant menus. Gemini results are validated and shown as editable item drafts; categories are not inferred, size/portion is preserved, and text or missing prices must be corrected to a numeric QAR amount before saving. Review every draft before using its **Add to menu** action or **Add all remaining items**. Nothing is written to the menu until the owner adds the draft, and new items continue through the existing Admin approval process.

The preview validates required fields, QAR prices, time ranges, image URLs, duplicate rows, and matches against the existing menu. Rows can be corrected in the preview before importing. Choose **Add New Items**, **Update Existing Items and add new**, or **Replace Entire Menu**. Replacement requires an explicit confirmation and all rows must be valid; unmatched existing items are deactivated rather than deleted. New/changed items for approved partners remain hidden from customers until Admin menu approval. Scheduled items are shown as unavailable outside their configured hours, and the API rechecks those hours when quoting and placing an order.

Menu photos can still be uploaded individually or in a ZIP archive. ZIP image filenames should match the menu Item ID, generated menu item ID, or item name; supported JPEG, PNG, and WebP images are limited to 256 KB each and the archive to 10 MB. Upload results include row/file errors and can be downloaded as a CSV report. The API derives the target restaurant from the authenticated account and records each bulk import or image upload in the audit log.

## Integrations and operating assumptions

- Currency is QAR and tax is 0 for the MVP. Fees, commission, SLA, cancellation window, service radius and currency are environment-configurable; historical order prices and commission are stored as snapshots.
- Payment method is cash/direct payment to the restaurant. No order is marked paid without a payment provider confirmation.
- Customer OTP messages are sent through WhatsApp Cloud API using an approved Authentication template; provider credentials and the OTP signing secret belong only in server environment variables. Restaurant/order and partner notifications remain demo/log-only and are not represented as sent or delivered.
- Customer location is selected on OpenStreetMap (or with browser geolocation), and restaurant free-delivery radius is checked both when browsing and when placing an order.
- This MVP does not yet include saved customer addresses, password reset, granular Admin permission management, or an online payment gateway. Partner self-service profile editing is not enabled; operational rates and rules remain Admin-managed or server-configured.
- Demo accounts are for local development only. Change the JWT secret and replace/remove demo accounts before deployment. Use HTTPS, a managed MongoDB, secret storage, backups, and an appropriate operational review before production use.

## Security and data boundaries

Restaurant/admin passwords are hashed, customer OTP challenges are stored as HMAC hashes with expiry and attempt/rate limits, API access uses expiring signed tokens, and role checks are enforced on the server. Restaurant scope is derived from the authenticated restaurant account, and signed-in customer order access is derived from the authenticated customer. Guest tracking requires both order reference and phone number. The API validates inputs and uses server-calculated prices; frontend-supplied totals/ownership are ignored.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run local` | Start the Docker development stack and seed demo data |
| `npm run dev` | Start API and Angular development server |
| `npm run seed` | Insert/update safe demo data |
| `npm test` | Run backend business-rule tests |
| `npm run build` | Build the Angular app |
| `docker compose down` | Stop services; Mongo data remains in its named volume |
