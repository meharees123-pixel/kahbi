# KABHI

KABHI is a Qatar-focused ordering platform MVP. It keeps customer ordering, restaurant operations, and administration in separate server-authorized roles. Restaurants remain responsible for preparation and delivery; the platform does not dispatch couriers.

## Run locally with Docker (one command)

Install and start Docker Desktop, then run this from the project directory:

```sh
npm run local
```

This starts MongoDB, seeds the demo data, and launches the API and web app. Open [http://localhost:4200](http://localhost:4200). The API health endpoint is [http://localhost:3000/api/health](http://localhost:3000/api/health). Stop the stack with `Ctrl+C`.

The first startup seeds a clearly labeled demo restaurant, menu, promotion, and accounts. Seeding is safe to repeat. Demo passwords are `Demo123!`:

| Role | Email |
| --- | --- |
| Customer | `customer@kahbi.demo` |
| Restaurant owner | `restaurant@kahbi.demo` |
| Admin | `admin@kahbi.demo` |

## Run without Docker

Requirements: Node.js 22.22.3+ (or 24.15.0+) and MongoDB 7+ running locally.

1. Copy `.env.example` to `.env` (the server and seeder load this root file) and set a private `JWT_SECRET`.
2. Run `npm run install:all` to install the root, API, and Angular dependencies.
3. Run `npm run seed` once to create demo data.
4. Run `npm run dev`; the Angular UI is at `http://localhost:4200` and API at `http://localhost:3000`.

Production API: `npm start`. Production Angular build: `npm run build`.

## Working MVP flow

- Browse approved restaurants and menus as a guest, search and filter by cuisine/status, and add menu items to a single-restaurant cart.
- Check out with a guest's name, Qatar mobile/WhatsApp number, and delivery address, or sign in as a customer. The API validates restaurant and item availability, quantities, service radius, promotion and all amounts before creating an order. An idempotency key prevents duplicate submissions.
- Track a guest order by its order reference and phone number; signed-in customers have private order history and may rate completed orders.
- Sign in as the restaurant owner to view only that restaurant's orders and advance valid order states through accept, prepare, ready, delivery, and completion. Menu availability can be changed from the restaurant view.
- Sign in as admin to view live database metrics, manage restaurants from a searchable card directory with a separate profile/menu editor, approve/reject/suspend restaurants, and accept/reject or advance orders through their valid lifecycle. Billing snapshots and audit events are recorded for completed orders and administrative decisions.
- Admins can manage customer account status, promotions and sponsored home banners. Served banner impressions are recorded; click/conversion analytics are not enabled.
- Restaurant onboarding is available from the sign-in screen. New restaurants remain private until admin approval.

## Integrations and operating assumptions

- Currency is QAR and tax is 0 for the MVP. Fees, commission, SLA, cancellation window, service radius and currency are environment-configurable; historical order prices and commission are stored as snapshots.
- Payment method is cash/direct payment to the restaurant. No order is marked paid without a payment provider confirmation.
- WhatsApp runs in demo/log-only mode. The application records notification intent and makes no claim that an external message was sent or delivered. A WhatsApp Business provider, approved templates, webhook endpoint, credentials, and delivery/retry handling must be configured before enabling live messaging. Credentials belong only in server environment variables.
- Browser geolocation is optional; the customer can enter a delivery address manually. No map/geocoding provider is bundled.
- This MVP does not yet include saved customer addresses, bulk menu upload, password reset, admin user/permission management, or an online payment gateway. Restaurant profile editing and configurable settings UI are also deferred; operational rates and rules are configured through server environment variables.
- Demo accounts are for local development only. Change the JWT secret and replace/remove demo accounts before deployment. Use HTTPS, a managed MongoDB, secret storage, backups, and an appropriate operational review before production use.

## Security and data boundaries

Passwords are hashed, API access uses expiring signed tokens, and role checks are enforced on the server. Restaurant scope is derived from the authenticated restaurant account, and signed-in customer order access is derived from the authenticated customer. Guest tracking requires both order reference and phone number. The API validates inputs and uses server-calculated prices; frontend-supplied totals/ownership are ignored.

## Useful commands

| Command | Purpose |
| --- | --- |
| `npm run local` | Start the Docker development stack and seed demo data |
| `npm run dev` | Start API and Angular development server |
| `npm run seed` | Insert/update safe demo data |
| `npm test` | Run backend business-rule tests |
| `npm run build` | Build the Angular app |
| `docker compose down` | Stop services; Mongo data remains in its named volume |
