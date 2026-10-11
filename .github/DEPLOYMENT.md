# Google Cloud deployment setup

The GitHub Actions workflow deploys the API and production frontend to Cloud Run when code is pushed to `main`. Pull requests to `main` run dependency installation, backend tests, and an Angular production build without needing Google Cloud credentials.

## Google Cloud resources

Choose a Google Cloud project and region, then enable the IAM, IAM Credentials, Security Token Service, Cloud Run, Artifact Registry, and Secret Manager APIs. Create a Docker-format Artifact Registry repository in the chosen region.

Use Workload Identity Federation (WIF) rather than a downloaded service-account key:

- Create a workload identity pool and GitHub OIDC provider. Map the GitHub repository and ref claims (for example, `attribute.repository=assertion.repository` and `attribute.ref=assertion.ref`). Restrict the provider's attribute condition to repository `meharees123-pixel/kahbi` and ref `refs/heads/main`.
- Create a deployer service account. Grant it Artifact Registry Writer and Cloud Run Admin. Grant it Service Account User on the runtime service account.
- Create a separate runtime service account for Cloud Run. Grant it Secret Manager Secret Accessor only on the KABHI secrets listed below.
- Grant `roles/iam.workloadIdentityUser` on the deployer account to the repository principal set from this workload identity pool, so the GitHub workflow can impersonate it without a service-account key.

Create these secrets in Secret Manager and add a version to each. Do not put their values in GitHub repository variables or commit them to the repository.

| Secret | Value |
| --- | --- |
| MongoDB URI | Production MongoDB connection string for the KABHI database |
| JWT secret | Long, random, persistent signing secret |
| OTP signing secret | Independent random secret of at least 32 characters |
| WhatsApp config encryption key | Independent random key; keep stable so saved credentials remain decryptable |

The workflow references each secret's `latest` version. Production database connectivity and network allow-listing must be configured in the MongoDB provider. Do not point production at the local/demo database.

## GitHub repository variables

In **Settings > Secrets and variables > Actions > Variables**, add:

| Variable | Example / format | Required |
| --- | --- | --- |
| `KAHBI_GCP_DEPLOY_ENABLED` | `true` | Yes; leave unset until setup is complete |
| `GCP_PROJECT_ID` | Google Cloud project ID | Yes |
| `GCP_REGION` | For example, `me-central1` | Yes |
| `GAR_REPOSITORY` | Artifact Registry repository name in that region | Yes |
| `GCP_WIF_PROVIDER` | Full `projects/.../locations/global/workloadIdentityPools/.../providers/...` resource name | Yes |
| `GCP_DEPLOYER_SERVICE_ACCOUNT` | Deployer service account email | Yes |
| `GCP_RUNTIME_SERVICE_ACCOUNT` | Cloud Run runtime service account email | Yes |
| `GCP_MONGODB_SECRET` | Secret Manager secret ID holding the MongoDB URI | Yes |
| `GCP_JWT_SECRET` | Secret Manager secret ID holding the JWT secret | Yes |
| `GCP_OTP_SIGNING_SECRET` | Secret Manager secret ID holding the OTP signing secret | Yes |
| `GCP_WHATSAPP_ENCRYPTION_SECRET` | Secret Manager secret ID holding the WhatsApp encryption key | Yes |
| `GCP_API_SERVICE` | Cloud Run API service name; defaults to `kahbi-api` | No |
| `GCP_WEB_SERVICE` | Cloud Run frontend service name; defaults to `kahbi-web` | No |

The WIF provider condition should limit deployments to this repository's `main` branch. The workflow never receives a long-lived service-account key. Its deploy job remains skipped until `KAHBI_GCP_DEPLOY_ENABLED` is `true`; once enabled, missing configuration causes an explicit failure before authentication.

## Deployment behavior and first release

Each main-branch deployment builds immutable images tagged with the commit SHA and deploys two public Cloud Run services: `kahbi-api` and `kahbi-web`. The web container serves Angular's production build and proxies `/api/` requests to the deployed API. The API uses Cloud Run's injected port and production mode.

The API service is publicly reachable, with application authentication and role checks protecting authorized routes. Do not remove those API checks. The browser uses the web service origin, avoiding a hard-coded Cloud Run URL and cross-origin browser API calls.

The workflow deliberately does not run the demo seeder against production: seeding would create demo accounts and can reset their passwords. Provision production data and the first administrator using an approved, secure process before opening the service to users. Configure WhatsApp Cloud API settings from the admin portal after creating that administrator. The deployment workflow only builds and deploys; it does not create or change database records.

Before enabling the deploy gate, share the project ID, region, Artifact Registry repository, WIF provider and service-account setup, and Secret Manager secret IDs so the configuration can be checked against your Google Cloud resources. Never send secret values in chat.
