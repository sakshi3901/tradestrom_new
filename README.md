# Tradestrom

Tradestrom is a full-stack access-managed web application with:

- `web`: Next.js App Router app (authentication, UI, protected routes)
- `api`: Go (Gin) service (access checks, user management, MySQL)

## Architecture

- Users authenticate with Google OAuth via NextAuth in `web`.
- Next.js checks access through `api` using server-side requests only.
- All Go API routes except `/health` require `X-Internal-Secret`.
- Browser never calls Go directly; it calls Next.js route handlers under `/api/admin/*`.

## Project Structure

- `/web`
  - `app/`
  - `middleware.js`
  - `lib/api.js`
  - `lib/auth.js`
- `/api`
  - `main.go`
  - `routes/`
  - `handlers/`
  - `db/`
  - `models/`

## Prerequisites

- Node.js 18+
- Go 1.22+
- MySQL 8+
- Google OAuth credentials

## Environment Variables

### Web (`/web/.env`)

Copy `/web/.env.example` to `/web/.env` and set values:

- `NEXTAUTH_URL`
- `NEXTAUTH_SECRET`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GO_API_BASE_URL` (example: `http://localhost:8080`)
- `INTERNAL_API_SECRET` (must match API)

### API (`/api/.env`)

Copy `/api/.env.example` to `/api/.env` and set values:

- `PORT` (default `8080`)
- `MYSQL_DSN` (example: `"tradestrom:tradestrom@tcp(127.0.0.1:3306)/tradestrom?parseTime=true"`)
- `INTERNAL_API_SECRET` (must match web)
- `ZERODHA_API_KEY` (Kite Connect API key)
- `ZERODHA_API_SECRET` (Kite Connect API secret)
- `ACCESSTOKEN` (Kite access token; update daily)

Note: NIFTY chart candles are read from Zerodha. `ACCESSTOKEN` is re-read from `/api/.env` on requests, so updating it daily does not require a restart.

## MySQL Schema

Schema is auto-applied on API startup from `/api/db/schema.sql`:

- `users`
  - `id`, `email` (unique), `name`, `role` (`admin|client`), `has_access`, `created_by`, `created_at`, `updated_at`
- `audit_logs`
  - `id`, `actor_email`, `action`, `target_email`, `created_at`

## Run Locally

### 1. Start API

```bash
cd /Users/tcitech/Desktop/Tradestrom/api
# load env vars, then:
go run .
```

### 2. Start Web

```bash
cd /Users/tcitech/Desktop/Tradestrom/web
npm install
npm run dev
```

Open `http://localhost:3000`.

## Bootstrap First Admin

Before anyone can use `/admin`, grant your first admin via the internal API:

```bash
curl -X POST "http://localhost:8080/v1/access/grant" \
  -H "Content-Type: application/json" \
  -H "X-Internal-Secret: <INTERNAL_API_SECRET>" \
  -H "X-Actor-Email: system@gmail.com" \
  -d '{"email":"your-email@gmail.com","role":"admin"}'
```

## Core Endpoints (Go)

- `GET /health`
- `GET /v1/access/check?email=`
- `GET /v1/users?role=admin|client`
- `POST /v1/access/grant`
- `POST /v1/access/revoke`

All `/v1/*` endpoints require `X-Internal-Secret`.

## Security Rules Enforced

- Gmail-only addresses for access management
- `/home` requires live `has_access = true` verification
- `/admin/*` requires live `role = admin` verification
- Go API credentials are server-side env vars only
- Browser traffic to Go API is blocked by architecture (Next.js proxy only)
