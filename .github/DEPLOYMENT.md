# Google Cloud deployment setup

The GitHub Actions workflow deploys the API and production frontend to Cloud Run when code is pushed to `main`. Pull requests to `main` run dependency installation, backend tests, and an Angular production build without needing Google Cloud credentials.

## Google Cloud resources

Choose a Google Cloud project and region, then enable the Cloud Run, Artifact Registry, and Secret Manager APIs. Create a Docker-format Artifact Registry repository in the chosen region.

## Deployment service account

- Create a dedicated deployer service account in the selected project and create a JSON key for it.
- Grant the deployer `roles/artifactregistry.writer` and `roles/run.admin` on the project. Grant it `roles/iam.serviceAccountUser` on the runtime service account only.
- Create a separate runtime service account for Cloud Run. Grant it Secret Manager Secret Accessor only on the KABHI secrets listed below.
- Add the service-account JSON key to GitHub **Settings > Secrets and variables > Actions > Secrets** as `GCP_SA_KEY`. Do not commit the key, place it in a repository variable, or send it in chat.

Service-account keys are long-lived credentials. Prefer Workload Identity Federation when available. If using this key-based setup, use a dedicated least-privilege service account, restrict access to the GitHub repository, rotate the key regularly, and revoke it immediately if exposed.

Create these secrets in Secret Manager and add a version to each. Do not put their values in GitHub repository variables or commit them to the repository.

| Secret | Value |
| --- | --- |
| MongoDB URI | Production MongoDB connection string for the KABHI database |
| JWT secret | Long, random, persistent signing secret |
| OTP signing secret | Independent random secret of at least 32 characters |
| WhatsApp config encryption key | Independent random key; keep stable so saved credentials remain decryptable |
| Gemini API key | Private Google AI Studio API key for menu extraction |
| SMTP username | Authenticated account authorized to send from the configured sender |
| SMTP password | SMTP credential or provider app password |

The workflow references each secret's `latest` version. Production database connectivity and network allow-listing must be configured in the MongoDB provider. Do not point production at the local/demo database.

## GitHub repository variables

In **Settings > Secrets and variables > Actions > Variables**, add:

| Variable | Example / format | Required |
| --- | --- | --- |
| `KAHBI_GCP_DEPLOY_ENABLED` | `true` | Yes; leave unset until setup is complete |
| `GCP_PROJECT_ID` | Google Cloud project ID | Yes |
| `GCP_REGION` | For example, `me-central1` | Yes |
| `GAR_REPOSITORY` | Artifact Registry repository name in that region | Yes |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Cloud Run runtime service account email | Yes |
| `GCP_MONGODB_SECRET` | Secret Manager secret ID holding the MongoDB URI | Yes |
| `GCP_JWT_SECRET` | Secret Manager secret ID holding the JWT secret | Yes |
| `GCP_OTP_SIGNING_SECRET` | Secret Manager secret ID holding the OTP signing secret | Yes |
| `GCP_WHATSAPP_ENCRYPTION_SECRET` | Secret Manager secret ID holding the WhatsApp encryption key | Yes |
| `GCP_GEMINI_API_KEY_SECRET` | Secret Manager secret ID holding the Gemini API key | Yes |
| `GCP_SMTP_USER_SECRET` | Secret Manager secret ID holding the SMTP username | Yes |
| `GCP_SMTP_PASS_SECRET` | Secret Manager secret ID holding the SMTP password | Yes |
| `GCP_SMTP_HOST` | SMTP hostname | Yes |
| `GCP_SMTP_PORT` | SMTP port (typically `587` or `465`) | Yes |
| `GCP_SMTP_SECURE` | `true` for implicit TLS (typically port `465`), otherwise `false` | Yes |
| `GCP_EMAIL_FROM` | Verified sender email address authorized by the SMTP provider | Yes |
| `GCP_EMAIL_FROM_NAME` | Sender display name; defaults to `KABHI` | No |
| `GCP_ADMIN_NOTIFICATION_EMAIL` | Admin notification recipient; defaults to `kabhioffical92@gmail.com` | No |
| `GCP_CLIENT_ORIGIN` | Public HTTPS origin of the KABHI web app (for example, `https://kahbi.example.com`) | Yes |
| `GCP_API_SERVICE` | Cloud Run API service name; defaults to `kahbi-api` | No |
| `GCP_WEB_SERVICE` | Cloud Run frontend service name; defaults to `kahbi-web` | No |

Add the deployment service-account JSON key as the GitHub Actions secret `GCP_SA_KEY`. Restrict repository write access and protect the `main` branch because pushes to `main` can use this credential. The deploy job remains skipped until `KAHBI_GCP_DEPLOY_ENABLED` is `true`; once enabled, missing repository variables cause an explicit failure before authentication.

## Deployment behavior and first release

Each main-branch deployment builds immutable images tagged with the commit SHA and deploys two public Cloud Run services with `google-github-actions/deploy-cloudrun@v2`: `kahbi-api` and `kahbi-web`. The web container serves Angular's production build and proxies `/api/` requests to the API URL returned by the API deployment step. The API uses Cloud Run's injected port and production mode.

The API service is publicly reachable, with application authentication and role checks protecting authorized routes. Do not remove those API checks. The browser uses the web service origin, avoiding a hard-coded Cloud Run URL and cross-origin browser API calls.

The workflow deliberately does not run the demo seeder against production: seeding would create demo accounts and can reset their passwords. Provision production data and the first administrator using an approved, secure process before opening the service to users. Configure WhatsApp Cloud API settings from the admin portal after creating that administrator. The deployment workflow only builds and deploys; it does not create or change database records.

Before enabling the deploy gate, configure the project ID, region, Artifact Registry repository, runtime service account, deployer JSON key secret, and Secret Manager secret IDs. Never send secret values or service-account key JSON in chat.

## Email notifications

For local Docker Compose, copy `.env.example` to `.env` and configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, and a provider-verified `EMAIL_FROM`. `ADMIN_NOTIFICATION_EMAIL` defaults to `kabhioffical92@gmail.com`. SMTP credentials are passed only to the API container.

For Cloud Run, store `SMTP_USER` and `SMTP_PASS` in Secret Manager, then configure the SMTP host, port, secure mode, verified sender, and optional sender name as the repository variables listed above. The deployment workflow injects these settings into the API service only. Email notifications are persisted in MongoDB and retried with bounded backoff; if SMTP is unavailable or unconfigured, business operations still succeed and queued notifications are logged/retried.
