# StepWise

This app has:

- a Vite React frontend
- a Node/Express API in `server/index.js`
- an optional Python FastAPI AI service in `server/server.py` for local experimentation
- an optional Python FastAPI Content Safety service in `server/content_safety_service.py` for moderation
- Azure Postgres, Azure Blob Storage, Azure OpenAI, and Azure Vision integrations

## Security

Credentials must be provided through environment variables. Do not commit `.env` files or hardcode service keys in source files.

Use `.env.example` as the template for local configuration.

If secrets were already committed, rotate them in Azure immediately. Removing them from a later commit does not make the old secrets safe again.

## Local Run

Install JavaScript dependencies:

```bash
npm install
```

Run the Node API:

```bash
PORT=8080 npm run dev:server
```

Run the frontend:

```bash
npm run dev
```

For localhost auth, you now have two options:

- Dev bypass user: set `VITE_DEV_AUTH_BYPASS=true`.
- Real Google OAuth on localhost: set `VITE_DEV_AUTH_BYPASS=false` and configure backend Google OAuth env vars.

When using real Google OAuth on localhost, create a Google OAuth Web client and set:

- Authorized JavaScript origins: `http://localhost:5173`
- Authorized redirect URI: `http://localhost:8080/api/auth/google/callback`

Run the optional Python AI service only if you explicitly want the standalone FastAPI path:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-dotenv openai requests python-multipart
uvicorn server:app --reload --host 0.0.0.0 --port 8000
```

Run the optional Python Content Safety service if you want moderation enforced through Azure AI Content Safety:

```bash
cd server
python3 -m venv .venv
source .venv/bin/activate
pip install fastapi uvicorn python-dotenv requests
uvicorn content_safety_service:app --reload --host 0.0.0.0 --port 8001
```

## Required Environment Variables

Frontend:

- `VITE_API_BASE_URL`
- `VITE_AI_ANALYZE_URL` (defaults to `/api/ai/analyze`)
- `VITE_DEV_AUTH_BYPASS`
- `VITE_DEV_USER_ID`
- `VITE_DEV_USER_NAME`
- `VITE_DEV_USER_EMAIL`
- `VITE_DEBUG_AI_IMAGES` (set `true` to mirror GPT-bound images in Network/Inspect mode)

Backend:

- `DATABASE_URL`
- `AUTH_SESSION_SECRET` (required for local Google OAuth session cookies)
- `GOOGLE_OAUTH_CLIENT_ID` (required for local Google OAuth)
- `GOOGLE_OAUTH_CLIENT_SECRET` (required for local Google OAuth)
- `GOOGLE_OAUTH_REDIRECT_URI` (optional override, defaults to `http://localhost:8080/api/auth/google/callback`)
- `AZURE_STORAGE_CONNECTION_STRING` or `AZURE_STORAGE_ACCOUNT` and `AZURE_STORAGE_ACCESS_KEY`
- `AZURE_STORAGE_CONTAINER`
- `AZURE_OPENAI_API_KEY`
- `AZURE_OPENAI_ENDPOINT`
- `AZURE_OPENAI_API_VERSION`
- `AZURE_OPENAI_DEPLOYMENT` (preferred Azure deployment name)
- `AZURE_OPENAI_MODEL`
- `AZURE_OPENAI_FALLBACK_DEPLOYMENTS` (optional comma-separated retry list)
- `AZURE_VISION_ENDPOINT`
- `AZURE_VISION_KEY`
- `CONTENT_SAFETY_SERVICE_URL` (optional; when unset the Node API skips moderation calls)
- `CONTENT_SAFETY_FAIL_OPEN` (`true` keeps requests flowing if the Python service is down)
- `AZURE_CONTENT_SAFETY_ENDPOINT` (required by the Python moderation service)
- `AZURE_CONTENT_SAFETY_KEY` (required by the Python moderation service)
- `AZURE_CONTENT_SAFETY_API_VERSION` (defaults to `2024-09-01`)
- `AZURE_CONTENT_SAFETY_BLOCK_SEVERITY` (defaults to `4`)
- `AZURE_CONTENT_SAFETY_REVIEW_SEVERITY` (defaults to `2`)
- `STEPWISE_DEBUG_ROUTES` (set `true` to enable `/api/debug/echo-image`)
