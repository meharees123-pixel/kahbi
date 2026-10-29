# KABHI — AI Assistant Guidelines & Project Context

KABHI is a Qatar-focused multi-restaurant food-ordering marketplace MVP built with Node.js/Express, Angular 22, MongoDB, and Docker.

---

## 1. Operating Assumptions & Core Architecture

* **Operating Model:** Multi-restaurant marketplace. Customer orders are prepared and delivered directly by restaurants; the platform does **not** dispatch couriers.
* **Region & Currency:** Qatar (QAR, 0% tax for MVP, Qatar coordinates and time zone `Asia/Qatar`).
* **Roles & Authorization Boundaries:**
  * `CUSTOMER`: Passwordless Firebase Phone Authentication (SMS OTP). Scoped to personal profile, orders, addresses, and cart.
  * `RESTAURANT_OWNER`, `RESTAURANT_MANAGER`, `RESTAURANT_STAFF`: Email + bcrypt password. Scoped strictly to their assigned `restaurantId`. Manage restaurant availability, menu, operational orders, and billing metrics.
  * `ADMIN`, `SUPER_ADMIN`: Email + bcrypt password. Global visibility across all restaurants, partner applications, menu approvals, audit logs, and settings.
* **Monorepo Layout:**
  * `server/`: Express API (`src/index.js`, `src/app.js`, `src/models.js`, `src/rules.js`, `src/services.js`).
  * `client/`: Standalone Angular 22 SPA (`src/app/app.component.ts`, `app.component.html`, `firebase-phone-auth.service.ts`).
  * Root: Docker Compose orchestration (`docker-compose.yml`) and workspace npm scripts.

---

## 2. Key Modules & Domain Responsibilities

* `server/src/models.js`: Mongoose schemas for all collections (`User`, `Restaurant`, `MenuItem`, `CustomerCart`, `Order`, `BillingTransaction`, `Promotion`, `Advertisement`, `Feedback`, `Rating`, `AuditLog`, `MessageLog`, `EmailNotification`, `PhoneAuthChallenge`, `RestaurantRegistration`, `PlatformSetting`).
* `server/src/rules.js`: State transition graph, Haversine formula (`haversineKm`), coordinate boundaries, and service radius validation (0.5 to 100 km).
* `server/src/services.js`: `changeOrderStatus`, `expirePendingOrders` (60s SLA auto-reject), `writeAudit`, `logNotification`.
* `server/src/firebase-auth.js`: Verifies Firebase ID tokens using `firebase-admin` without requiring private service-account keys.
* `server/src/email-notifications.js` & `email-templates.js`: Transactional email outbox queue with unique SHA-256 event keys, locking worker, and exponential backoff retry.
* `server/src/bulk-menu.js`: XLSX and CSV menu file parser, time window validator, and ZIP image archive reader.
* `server/src/menu-extractor.js`: Gemini AI (`@google/genai`) menu extraction from images, PDFs, DOCX, and spreadsheets.
* `server/src/images.js`: Strict validation of base64 JPEG, PNG, and WebP images (max 256 KB after compression).
* `server/src/partner-registration.js`: Validation for public partner registration in Qatar (`KBR-YYYY-ID`).
* `server/src/customer-terms.js`: Versioned customer terms verification during order checkout.
* `server/src/feedback.js`: Rating validation (1-5) and trend aggregation.

---

## 3. Order Lifecycle & State Machine

Order state transitions must follow `canTransition()` in `server/src/rules.js` and be executed atomically via `changeOrderStatus()` in `server/src/services.js`:

```
RESTAURANT_PENDING ──┬─> ACCEPTED ─────────┬─> PREPARING ──> READY ──> OUT_FOR_DELIVERY ──> DELIVERED ──> CLOSED
                     ├─> REJECTED          └─> CANCELLED (within 5-min window)
                     ├─> AUTO_REJECTED (SLA timeout after 5 mins)
                     └─> CANCELLED (customer within window)
```

* **Server-side Calculation:** Prices, delivery fees, discounts, and totals must always be computed on the server; client-submitted totals are ignored.
* **Settlement on Closure:** Transitioning to `CLOSED` writes an immutable `BillingTransaction` calculating restaurant commission (`RESTAURANT_COMMISSION_PERCENT`, default 12%).
* **Idempotency:** Every order placement requires an `idempotencyKey` to avoid double-charging or duplicate submissions.

---

## 4. Authentication & Security Principles

1. **Customers:** Never store or verify customer passwords. Authenticate strictly via Firebase Phone Auth (`POST /api/auth/customer-phone/verify`), issuing an 8-hour JWT with `amr: "firebase_phone"`.
2. **Restaurant / Admin Passwords:** Require bcrypt hash (minimum 10 characters with at least one letter and one number).
3. **Portal Separation:** Enforce portal matching in login (`/login/customer`, `/login/restaurant`, `/login/admin`). A restaurant account cannot log in via customer routes.
4. **Partner Onboarding:** Public registration creates a `RestaurantRegistration`. Admin approval generates a secure, 7-day, single-use activation token to set up partner credentials.
5. **No Secrets in Repo:** Environment variables live in `.env` (never committed). `FIREBASE_PROJECT_ID` configures token verification.

---

## 5. Development & Testing Commands

* **Run local stack (Docker):** `npm run local` (starts Mongo, seeds data, starts API & Angular frontend)
* **Run local dev (without Docker):** `npm run dev` (runs API on :3000 and Angular on :4200)
* **Seed database:** `npm run seed` (safe demo data with password `Demo123!`)
* **Run test suite:** `npm test` (executes Node native tests in `server/test/*.test.js`)
* **Build frontend:** `npm run build` (builds Angular client to `client/dist/kahbi`)

---

## 6. Rules for Modifying This Codebase

1. **Always verify with tests:** Run `npm test` before and after modifying backend logic. Ensure all 58+ unit tests pass.
2. **Server is the authority:** Never trust client-provided totals, delivery validation, or role claims. All business constraints must be enforced in Express route handlers and service functions.
3. **Preserve auditability:** Whenever mutating orders, partner registrations, restaurants, or billing, log the action using `writeAudit()`.
4. **Keep changes minimal and focused:** Avoid refactoring unrelated files or dependencies. Protect existing MongoDB schemas and ensure backward compatibility.

