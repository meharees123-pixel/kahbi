# KABHI Implementation Analysis

## 1. Project purpose

KABHI is a Qatari food-ordering MVP for a multi-restaurant marketplace. The product supports:

- customer browsing and ordering
- restaurant onboarding and approval
- order lifecycle management
- admin management and billing
- WhatsApp OTP-based customer sign-in
- delivery radius checks using map coordinates
- demo/default data for local development

The project is structured as a small monorepo with a Node.js API, an Angular web app, and a MongoDB-backed data layer.

## 2. Architecture and runtime layout

### Root package and scripts

The root project orchestrates the stack through npm scripts in [package.json](../package.json):

- `npm run local` -> `docker compose up --build`
- `npm run dev` -> runs API and Angular in parallel
- `npm run build` -> Angular production build
- `npm run seed` -> server seed script
- `npm test` -> backend tests
- `npm run start` -> server start

### Server

The backend sits in [server/package.json](../server/package.json) and uses Express, Mongoose, JWT, helmet, bcryptjs, dotenv, CORS, and rate limiting.

Key runtime entry points:

- [server/src/index.js](../server/src/index.js): starts MongoDB connection and HTTP server
- [server/src/app.js](../server/src/app.js): API routes, validation, auth, role checks, and business logic
- [server/src/models.js](../server/src/models.js): all Mongoose schemas and model exports
- [server/src/services.js](../server/src/services.js): shared workflow helpers such as order state changes and audit logging
- [server/src/rules.js](../server/src/rules.js): state transitions and radius calculations
- [server/src/whatsapp.js](../server/src/whatsapp.js): OTP generation and WhatsApp configuration logic

### Frontend

The Angular app is in [client/package.json](../client/package.json) and is served on port 4200 during local development. The production web app is containerized via the Angular/Nginx setup in [client/Dockerfile](../client/Dockerfile) and [client/nginx/default.conf.template](../client/nginx/default.conf.template).

### Infrastructure

Local orchestration is driven by [docker-compose.yml](../docker-compose.yml):

- `mongodb` service on MongoDB 7
- `api` service on port 3000
- `seed` service to initialize demo data
- `web` service on port 4200

The stack intentionally uses named volumes for persistent MongoDB data and a Compose-based initialization pattern.

## 3. Startup and request lifecycle

The server startup sequence is straightforward and reliable:

1. [server/src/index.js](../server/src/index.js) loads environment config from the root `.env` file.
2. It connects to MongoDB with `mongoose.connect(...)`.
3. It imports the Express app from [server/src/app.js](../server/src/app.js).
4. It starts the HTTP server on port 3000.
5. It schedules a periodic `expirePendingOrders()` check every 60 seconds to auto-reject stale pending restaurant orders.

The app then applies middleware in this order:

- security middleware (`helmet`)
- CORS using `CLIENT_ORIGIN`
- JSON body parsing with a 512KB cap
- route-specific rate limits

Authentication is enforced via a `auth(required = true)` helper that:

- reads the `Authorization` bearer token
- verifies the JWT with the app secret
- loads the user from MongoDB
- rejects suspended or inactive accounts
- enforces `whatsapp_otp` auth for customers

Role-based access is enforced by `roles(...allowed)` and is used heavily across restaurant and admin routes.

## 4. Core API structure

The app is a single Express server with route grouping, not a separate router module.

### Public/guest surfaces

- `GET /api/health`
- `POST /api/auth/customer-otp/request`
- `POST /api/auth/customer-otp/verify`
- `GET /api/restaurants`
- `GET /api/restaurants/:id/menu`
- `POST /api/orders/track`
- `POST /api/orders/guest/cancel`

### Authenticated customer flows

- `GET /api/auth/me`
- `GET /api/orders/mine`
- `POST /api/orders`
- `POST /api/orders/:id/cancel`
- `POST /api/orders/:id/rating`

### Restaurant management

- `GET /api/restaurant/me`
- `PATCH /api/restaurant/me`
- `GET /api/restaurant/orders`
- `GET /api/restaurant/menu`
- `GET /api/restaurant/billing`
- `PATCH /api/restaurant/orders/:id/status`
- `PATCH /api/restaurant/availability`
- `PATCH /api/restaurant/profile/image`
- `POST /api/restaurant/menu`

### Admin management

- `GET /api/admin/summary`
- `GET /api/admin/whatsapp-config`
- `PUT /api/admin/whatsapp-config`
- `PUT /api/admin/whatsapp-config/otp-delivery`
- `GET /api/admin/restaurants`
- `PATCH /api/admin/restaurants/:id/status`
- `PATCH /api/admin/restaurants/:id/availability`
- `GET /api/admin/orders`
- `GET /api/admin/audit`
- `GET /api/admin/messages`
- `GET /api/admin/billing`
- `GET /api/admin/marketing`
- `POST /api/admin/promotions`
- `POST /api/admin/advertisements`

## 5. Business rules and workflow behavior

### Customer OTP login

The customer onboarding flow is passwordless and uses WhatsApp OTP verification. The app:

- normalizes phone numbers
- throttles repeated OTP requests
- stores a hashed challenge in `WhatsappOtp`
- validates an OTP against the challenge + signing secret
- creates or reuses a `CUSTOMER` user account when valid
- issues an 8-hour JWT with `amr = whatsapp_otp`

The app explicitly supports a development-only fallback for `NODE_ENV=development` where OTP delivery can be disabled and the code is returned to the client UI for testing. Production mode disallows this.

### Restaurant and location flow

Service area is validated with `haversineKm` and `isWithinServiceArea` from [server/src/rules.js](../server/src/rules.js). This is used for:

- restaurant listing eligibility
- checkout delivery checks
- restaurant onboarding validation

The code enforces a radius between 0.5 and 100 km and rejects invalid coordinates or missing geolocation data. This creates a strong dependency between the UI map selection and server-side order acceptance.

### Order lifecycle

Order transitions are constrained by the finite state table in [server/src/rules.js](../server/src/rules.js):

- `RESTAURANT_PENDING -> ACCEPTED | REJECTED | AUTO_REJECTED | CANCELLED`
- `ACCEPTED -> PREPARING | CANCELLED`
- `PREPARING -> READY`
- `READY -> OUT_FOR_DELIVERY`
- `OUT_FOR_DELIVERY -> DELIVERED`
- `DELIVERED -> CLOSED`

The service helper [server/src/services.js](../server/src/services.js) handles status changes, audit writes, billing snapshot creation when `CLOSED`, and auto-expiration of stale restaurant orders.

### Pricing and settlement

Order totals are built server-side and not trusted from the front end. The API calculates:

- subtotal from captured menu item quantities
- promotion discount
- delivery fee and admin fee
- total
- commission on closed orders

Billing is recorded in `BillingTransaction` for completed orders.

## 6. Data model and MongoDB structure

The key collections are defined in [server/src/models.js](../server/src/models.js):

- `User` — customer, restaurant owner/manager/staff, admin roles
- `Restaurant` — profiles, approval state, delivery radius, coordinates, availability
- `MenuItem` — restaurant menu catalog, pricing, image, active/availability flags
- `Order` — order, items, guest info, amounts, statusHistory, billing data
- `Promotion` — discount codes and eligibility rules
- `Advertisement` and `AdvertisementEvent` — home banners and impression tracking
- `Rating` — restaurant rating aggregates
- `AuditLog` — operational history
- `MessageLog` — outbound message status
- `WhatsappOtp` — OTP challenge storage
- `WhatsappSettings` and `WhatsappOtpControl` — encrypted WhatsApp configuration and delivery toggles

Important schema characteristics:

- unique order references and idempotency keys are enforced
- restaurant and customer identities are strongly scoped by `restaurantId` and `role`
- order state transitions are tracked in `statusHistory`
- `deleteAt` on `WhatsappOtp` supports TTL cleanup

## 7. Docker and deployment notes

The local deployment is controlled by [docker-compose.yml](../docker-compose.yml):

- MongoDB uses a named volume `kahbi-mongo`
- the API waits for seed completion before serving
- the seed service populates demo restaurant and account data
- the Angular app is served on 4200 and proxies to the API on 3000

Production assumptions documented in [README.md](../README.md) include:

- private `.env` only
- managed MongoDB and encrypted secrets
- HTTPS and environment-managed credentials
- Google Cloud deployment workflow for CI/CD

## 8. Security and reliability review

Confirmed areas of strength:

- JWT verification and role enforcement are implemented centrally
- password hashing uses `bcryptjs`
- customer phone verification is required before order placing
- idempotency keys prevent duplicate order creation
- order lifecycle and cancellation rules are enforced server-side
- rate limiting is applied to authentication and OTP requests

High-risk areas to watch when changing behavior:

- the API stores and reads sensitive WhatsApp credentials from environment state and encrypted config records
- any change to signing secret or encryption key breaks previously stored configuration and OTP validation
- order transitions are sensitive to status validations and can lead to business issues if altered without updating tests
- map and radius logic is critical for ordering correctness and must remain server-side validated

## 9. Testing and validation baseline

Existing backend tests are in [server/test/rules.test.js](../server/test/rules.test.js) and cover:

- order state transitions
- geospatial distance logic
- coordinate validation
- service-radius validation
- boundary-based eligibility checks

These tests validate the core business logic around order progression and delivery area rules.

## 10. Change impact map

### Likely impact hot spots

- [server/src/app.js](../server/src/app.js): high risk, central route logic and validation
- [server/src/models.js](../server/src/models.js): schema changes can impact all reads/writes
- [server/src/services.js](../server/src/services.js): status transitions and accounting logic
- [server/src/rules.js](../server/src/rules.js): delivery rule changes affect browsing, ordering, and admin workflows
- [server/src/whatsapp.js](../server/src/whatsapp.js): OTP and Meta integration changes are operationally sensitive

### Safe change strategy

- add or adjust validation in the API layer
- keep data model changes backward-compatible where possible
- update business-rule tests before broad feature work
- preview potential UX impact in Angular before touching order or login flows
- keep secrets in environment variables and avoid embedding them in repo files

## 11. Overall status

The project is a working MVP with clear boundaries between guest, customer, restaurant, and admin flows. The backend is the true authority for rules and authorization, while the frontend mostly mirrors those workflows. The most important implementation constraints for future work are:

- server-side validation is mandatory
- customer auth relies on WhatsApp OTP
- order state transitions and delivery radius checks are business-critical
- all billing and operational state updates must preserve auditability

This document should be treated as the implementation baseline for future changes.

### A. Executive Summary
What the application does, its architecture, and its major components.

### B. Technology Stack
Node.js, npm, frameworks, database tools, frontend technologies, Docker, and integrations.

### C. Repository Structure
A directory tree of the meaningful project files and an explanation of each major directory.

### D. Architecture
A component diagram or text-based architecture diagram, showing the relationships between frontend, backend, database, external services, and deployment components.

### E. Startup and Execution Flow
The complete application initialization and request-processing lifecycle.

### F. Database Documentation
Models, collections, schemas, relationships, indexes, important queries, and data integrity concerns.

### G. API Documentation
A complete route inventory, authentication requirements, inputs, outputs, and side effects.

### H. Business Workflows
End-to-end explanations of major application features with file paths and function references.

### I. Frontend Documentation
Component hierarchy, routing, state management, API integration, and backend dependencies, if applicable.

### J. Docker and Deployment
Container architecture, build process, configuration, networks, volumes, startup, persistence, and deployment risks.

### K. Security and Reliability Findings
Evidence-based findings, severity, impact, and remediation suggestions.

### L. Testing and Baseline
Available tests, safe checks executed, existing failures, and areas without sufficient verification.

### M. Dependency and Change-Impact Map
Critical dependencies and what could break when specific modules or interfaces change.

### N. Risk Register
Ranked risks and the precautions needed before modifying affected components.

### O. Recommended Change Procedure
A safe, repeatable workflow for future modifications.

### P. Unresolved Questions and Limitations
Anything that could not be verified, files or services unavailable, missing context, and assumptions that require my confirmation.

## PHASE 14: RULES FOR FUTURE CHANGE REQUESTS

Once the analysis is complete, use the resulting understanding as the working baseline for future requests in this conversation.

Whenever I ask you to make a change:

1. Clarify the intended behavior if my request is ambiguous.
2. Identify the relevant files, functions, models, routes, and services before editing.
3. Trace the full impact of the proposed change, including indirect dependencies.
4. Check compatibility with existing API contracts, database documents, frontend consumers, and deployment settings.
5. Identify regression risks and the tests needed to mitigate them.
6. Propose the smallest safe implementation that satisfies the requirement.
7. Do not refactor unrelated code or change unrelated dependencies.
8. Preserve existing behavior unless I explicitly request otherwise.
9. Protect existing database records. Never reset, drop, or overwrite data to make a change work.
10. If a database migration is required, explain the migration strategy, compatibility concerns, backup requirements, and rollback limitations before implementation.
11. If a change requires configuration or environment variables, explain the impact on development, testing, and production.
12. Make changes incrementally and inspect the diff.
13. Run the relevant safe tests and checks after the change.
14. Review the final diff for unintended modifications.
15. Report changed files, behavior changes, tests executed, test results, remaining risks, and any manual deployment steps.
16. Never claim that everything works unless the relevant behavior has actually been verified.

If you lack the context, permissions, tools, or test environment needed to validate a change, tell me exactly what is missing rather than guessing.

## PHASE 15: COMPLETION CRITERIA

Do not declare the analysis complete merely because you have generated a report.

Before declaring completion, verify that you have:

- Inspected the relevant source code and configuration across the repository.
- Identified the actual application entry points.
- Mapped the important internal dependencies.
- Traced the main business workflows.
- Understood the MongoDB data model and its consumers.
- Cataloged the API endpoints and their side effects.
- Understood the Docker deployment structure.
- Reviewed the existing testing approach.
- Identified critical risks and unresolved questions.
- Produced the requested report with evidence and file references.
- Recorded which areas remain uninspected or unverified.

If any area is incomplete, explicitly mark it as incomplete.

## START NOW

Begin with a read-only repository inventory.

Then proceed through each phase systematically. Maintain a checklist of progress so you do not skip directories or stop after a superficial review.

Do not make any code changes.

Do not ask me what feature I want to change yet. First, analyze the existing project and explain how it works.

When you finish, present the final Project Understanding Report and wait for my next instruction.