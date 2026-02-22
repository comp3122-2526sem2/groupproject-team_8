# Deployment Guide (Supabase + Vercel)

This runbook deploys the project with two environments:

- `staging` for preview validation
- `production` for live traffic

## 1. Prerequisites

- Node.js 20+
- pnpm 10+
- Supabase CLI (`npx supabase --version`)
- Vercel project connected to this repository

## 2. Create Supabase projects

Create two Supabase projects from the dashboard:

- `stem-learning-platform-staging`
- `stem-learning-platform-production`

For each project, configure:

- Auth email confirmation: enabled
- Phone auth provider: disabled
- Database extensions: `pgcrypto` and `vector` (created by migration)

## 3. Apply migrations to staging

Set your staging context and push schema:

```bash
export SUPABASE_DB_PASSWORD="<staging-db-password>"
npx supabase link --project-ref <STAGING_PROJECT_REF>
npx supabase db push
```

## 4. Apply migrations to production

Set your production context and push schema:

```bash
export SUPABASE_DB_PASSWORD="<production-db-password>"
npx supabase link --project-ref <PRODUCTION_PROJECT_REF>
npx supabase db push
```

## 5. Configure Vercel project

In Vercel project settings:

- Root directory: `web`
- Install command: `pnpm install`
- Build command: `pnpm build`

This repository includes `web/vercel.json` with a daily cron schedule for:

- `GET /api/materials/process` (Vercel cron requests use `GET`)

For Hobby plans, Vercel cron is limited to daily execution, so queued materials can wait up to 24 hours before processing. On Pro, update the schedule to `*/5 * * * *` for near-real-time material processing.

## 6. Configure environment variables

Set these in Vercel for both Preview (staging Supabase) and Production (production Supabase):

### Required Supabase

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
- `SUPABASE_SECRET_KEY`

Legacy fallback names (optional):

- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

### Required AI (OpenRouter-first)

- `AI_PROVIDER_DEFAULT=openrouter`
- `OPENROUTER_API_KEY`
- `OPENROUTER_MODEL`
- `OPENROUTER_EMBEDDING_MODEL`
- `OPENROUTER_VISION_MODEL`

### Recommended AI metadata

- `OPENROUTER_SITE_URL`
- `OPENROUTER_APP_NAME`
- `OPENROUTER_BASE_URL` (optional; defaults to OpenRouter API)

### Job and extraction settings

- `CRON_SECRET` (required to protect `/api/materials/process`)
- `EMBEDDING_DIM=1536`
- `VISION_PAGE_CONCURRENCY=3`
- `MATERIAL_JOB_MAX_ATTEMPTS=5`

## 7. Cron authentication

`/api/materials/process` enforces `CRON_SECRET` when it is set.

Accepted auth formats:

- `Authorization: Bearer <CRON_SECRET>`
- `x-cron-secret: <CRON_SECRET>`

Ensure your scheduler sends one of these. If using Vercel Cron, configure secret-based auth with `CRON_SECRET`.

## 8. Deployment flow

- Pull requests -> Preview deployment (staging env vars)
- Merge to `main` -> Production deployment (production env vars)

## 9. Post-deploy smoke tests

- Register teacher and student accounts
- Teacher creates class and uploads a material
- Material processing reaches `ready` status
- Blueprint generation succeeds
- Student joins class and accesses at least one assignment

## 10. Rollback

- App rollback: promote previous Vercel deployment
- Database rollback: restore from Supabase backup/PITR or forward-fix with a new migration
- Emergency pause: remove cron schedule or rotate `CRON_SECRET`
