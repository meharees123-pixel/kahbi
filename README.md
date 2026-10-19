# KABHI

KABHI is a Qatar-focused ordering platform MVP. It keeps customer ordering, restaurant operations, and administration in separate server-authorized roles. Restaurants remain responsible for preparation and delivery; the platform does not dispatch couriers.

## Run locally with Docker (one command)

Install and start Docker Desktop, then run this from the project directory:

```sh
npm run local
```

This starts MongoDB, seeds the demo data, and launches the API and web app. Open [http://localhost:4200](http://localhost:4200). The API health endpoint is [http://localhost:3000/api/health](http://localhost:3000/api/health). Stop the stack with `Ctrl+C`.

By default the API and seeder use the local MongoDB container and the `kabhi` database. `.env.example` is only a template; Compose reads the ignored root `.env` file. To use MongoDB Atlas locally, set `MONGODB_URI` in root `.env` to your Atlas connection string; Compose passes the same value to both the API and seeder. Include the intended database path in the URI (this project uses `/kabhi`) so you do not accidentally use MongoDB's default database. Keep `.env` private and never commit it. Ensure the Atlas database user has read/write access, the machine's IP is permitted by the Atlas network access list, and any special characters in the password are percent-encoded. The Compose MongoDB container may still appear as running, but when root `.env` points to Atlas, neither the API nor seeder uses that local database.

For a deployed server, configure `MONGODB_URI` as a private server-side environment variable on both the API service and any seed/migration job; do not put it in the frontend or source code. Use the same Atlas database path and confirm the deployed server's IP/network access is allowed in Atlas.

Customer accounts sign in with a WhatsApp one-time code; customer passwords are no longer used. When your Meta WhatsApp account is ready, sign in to the **Admin** portal and enter the Cloud API access token, Phone Number ID, and approved template details in the **WhatsApp Cloud API** settings panel. The access token and ID are encrypted before being stored in MongoDB; the token is never sent back to the browser. Use an authorized test recipient while developing. Before saving credentials, add both signing/encryption secrets to the root `.env` and restart the stack. Generate each secret independently with `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`. Keep `.env` private and do not commit it. Preserve `WHATSAPP_CONFIG_ENCRYPTION_KEY`: changing it makes already-saved credentials unreadable. When delivery is enabled, missing credentials or an unapproved template cause an explicit error; verification codes are never logged or returned.

The Admin dashboard also has a WhatsApp OTP delivery switch. In local development, turning delivery off shows the generated code in the customer app so the flow can be tested before Meta setup is ready. This bypasses possession verification and is allowed only when `NODE_ENV=development`; other environments reject disabling delivery and never return the code. The local Compose setup defaults `NODE_ENV` to `development`; set it to `production` when deploying. In local development, if no `OTP_SIGNING_SECRET` is set, the API creates a random temporary key on startup; outstanding codes expire when the API restarts. Production requires an explicit persistent signing secret. Keep code-display mode for local development only.

```env
WHATSAPP_OTP_TEMPLATE=kahbi_customer_otp
WHATSAPP_OTP_LANGUAGE=en_US
WHATSAPP_GRAPH_API_VERSION=v23.0
OTP_SIGNING_SECRET=generate-a-private-random-secret-at-least-32-characters
WHATSAPP_CONFIG_ENCRYPTION_KEY=generate-a-different-private-random-secret-at-least-32-characters
```

For Docker, `MONGODB_URI` in `.env` must be `mongodb://mongodb:27017/kabhi` when using the local container (not `localhost` from inside the API container). Put the generated secrets into `.env`, then run `npm run local` again. Sign in at [http://localhost:4200/login/admin](http://localhost:4200/login/admin), open the **WhatsApp Cloud API** panel, and save your Meta access token, numeric Phone Number ID, template name, language, and Graph API version. Customer login and checkout verification require only an international-format WhatsApp number; a new customer account is created after the code is verified. Every subsequent customer sign-in also requires an OTP.

The first startup seeds a clearly labeled demo restaurant, menu, promotion, and accounts. Seeding is safe to repeat. Restaurant and admin demo passwords are `Demo123!`; the demo customer's number is `+97450000002` and needs to be able to receive a code through your configured WhatsApp test/sender setup:

| Portal | Sign-in URL | Demo identity |
| --- | --- | --- |
| Customer | [http://localhost:4200/login/customer](http://localhost:4200/login/customer) | WhatsApp `+97450000002` |
| Restaurant owner — KABHI Demo Hotel | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `restaurant@kahbi.demo` |
| Restaurant owner — Pearl Garden Kitchen | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.pearl@kahbi.demo` |
| Restaurant owner — Souq Flame Grill | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.souq@kahbi.demo` |
| Restaurant owner — Corniche Breakfast Club | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.corniche@kahbi.demo` |
| Restaurant owner — Lusail Spice House | [http://localhost:4200/login/restaurant](http://localhost:4200/login/restaurant) | `owner.lusail@kahbi.demo` |
| Admin | [http://localhost:4200/login/admin](http://localhost:4200/login/admin) | `admin@kahbi.demo` |

Use `Demo123!` for all demo accounts. Each restaurant-owner account is scoped to its own restaurant; the admin account can manage all restaurants. The login API also enforces the selected portal, so a restaurant or admin account cannot sign in through the customer portal. Customer accounts are created after WhatsApp verification. Restaurant partners apply publicly and can create a login only after Admin approval; admin signup is disabled.

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
- Customer sign-in is passwordless and requires a WhatsApp OTP every time. Before the first checkout order on a new customer session, verify the WhatsApp number; this creates the customer account and links that order to it. The API validates restaurant and item availability, quantities, service radius, promotion and all amounts before creating an order. An idempotency key prevents duplicate submissions.
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

Restaurant owners and managers can open **Bulk Upload Menu** in the dashboard, download the CSV template, and upload CSV or Excel `.xlsx` files containing up to 500 rows. The template columns are `Category`, `Item Name`, `Description`, `Price`, `Availability Start (HH:MM)`, `Availability End (HH:MM)`, and `Image URL (Optional)`. Restaurant identity is taken from the signed-in account rather than the file. Availability start/end are optional daily windows in Qatar time; leave both blank for all-day availability, and enter both for a scheduled item. Overnight windows are supported.

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
