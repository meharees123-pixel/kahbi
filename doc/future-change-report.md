# KABHI Future Change Report

This report is intended as a reusable working document for planned changes to the KABHI platform. It captures the current implementation baseline, likely impact points, and the minimum verification steps to reduce risk.

## 1. Current implementation baseline

- API runtime: Node.js + Express in [server/src/app.js](../server/src/app.js)
- Data layer: MongoDB + Mongoose in [server/src/models.js](../server/src/models.js)
- Frontend: Angular app under [client/src](../client/src)
- Orchestration: Docker Compose in [docker-compose.yml](../docker-compose.yml)
- Business rules: [server/src/rules.js](../server/src/rules.js)
- Operational utilities: [server/src/services.js](../server/src/services.js)
- WhatsApp and OTP logic: [server/src/whatsapp.js](../server/src/whatsapp.js)

## 2. Change categories and risk level

### High risk

1. Order lifecycle updates
   - Files: [server/src/app.js](../server/src/app.js), [server/src/services.js](../server/src/services.js), [server/src/rules.js](../server/src/rules.js)
   - Why: order flow changes can immediately affect billing, status transitions, and restaurant operations.
   - Required checks: confirm transition matrix, statusHistory, billing snapshots, and admin/restaurant state updates.

2. Auth and session changes
   - Files: [server/src/app.js](../server/src/app.js)
   - Why: customer OTP and JWT enforcement are critical to access boundaries.
   - Required checks: verify login portal restrictions, JWT claims, and `amr` validation.

3. Schema or collection changes
   - Files: [server/src/models.js](../server/src/models.js)
   - Why: model changes affect all reads, writes, indexes, and downstream assumptions.
   - Required checks: migration plan, backward compatibility, and database readiness.

4. WhatsApp and OTP configuration changes
   - Files: [server/src/whatsapp.js](../server/src/whatsapp.js), [server/src/app.js](../server/src/app.js)
   - Why: environment keys, OTP signing, and encrypted settings are operationally sensitive.
   - Required checks: validate secret persistence, development vs production rules, and configuration source precedence.

### Medium risk

- restaurant onboarding and approval workflow
- delivery radius and map eligibility rules
- admin promotions and advertisement flows
- menu item availability and image management

### Lower risk

- Angular-only display changes
- static copy and demo text updates
- non-critical UI layout additions

## 3. Dependency map

- customer login -> Firebase Phone Authentication -> verified Firebase ID token -> `User`
- restaurant onboarding -> `Restaurant` + `User`
- order creation -> `Restaurant` + `MenuItem` + `Promotion` + `User` + `Order`
- order status updates -> `Order` + `AuditLog` + `BillingTransaction`
- admin dashboard summary -> aggregate queries across `User`, `Restaurant`, `Order`, `Promotion`, `Advertisement`, and `AuditLog`
- delivery eligibility -> `Restaurant` coordinates + radius + `haversineKm`

## 4. Recommended workflow for future change requests

1. Confirm business requirement and affected user roles.
2. Find the API entry point and trace the request to the DB model.
3. Check whether the change affects status transitions, billing, or authentication.
4. Identify the relevant test file or add a failing test before code changes.
5. Update server validation and DTO expectations before changing the client.
6. Validate against local Docker stack using `npm run local` or the smallest targeted command.
7. Review audit, billing, and notification side effects.

## 5. Change checklist

### For authentication changes

- [ ] confirm customer vs admin vs restaurant portal boundaries
- [ ] verify JWT signing secret handling
- [ ] verify OTP validation flow and rate limits
- [ ] confirm `NODE_ENV` restrictions still hold

### For ordering changes

- [ ] validate order idempotency logic
- [ ] check service-area radius validation
- [ ] confirm status transition matrix remains valid
- [ ] confirm billing and commission calculations still match requirements

### For restaurant changes

- [ ] verify approval, suspension, and availability logic
- [ ] confirm new coordinates/radius validation rules
- [ ] check owner and manager permission boundaries

### For data model changes

- [ ] assess backward compatibility for existing MongoDB documents
- [ ] confirm indexes and unique constraints still match usage
- [ ] review all reads and writes through API routes

### For deployment changes

- [ ] confirm `.env` variables remain private
- [ ] check Compose environment mappings for API and seed services
- [ ] validate startup ordering, health checks, and MongoDB readiness

## 6. Verification expectations

Before merging any future change, at minimum review:

- server route behavior
- MongoDB model impact
- business rule tests in [server/test/rules.test.js](../server/test/rules.test.js)
- admin and restaurant authorization checks
- order state and total calculations
- secret/config handling across local and production environments

## 7. Key risks to monitor

- radius enforcement drift between map selection and API calculation
- OTP secret or encryption key changes causing invalid saved config
- order transition changes that bypass audit or billing logic
- MongoDB schema drift affecting legacy records
- production deploy oversights due to env-var differences between local and Cloud Run

This document should be updated alongside any feature change so future engineers know exactly what was implemented, what was verified, and what risks remain.
