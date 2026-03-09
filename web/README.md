# STEM Learning Platform (Web)

This is the Next.js application for the STEM Learning Platform.

## Requirements

- Node.js 20+
- pnpm

## Setup

1. Copy `web/.env.example` to `web/.env.local` and fill in keys.
2. From the repo root, install dependencies:

```bash
pnpm install
```

3. Run the dev server:

```bash
pnpm dev
```

## Core Features (WIP)

- Auth with Supabase
- Class creation and join code enrollment
- Materials upload with PDF/DOCX/PPTX extraction
- Course blueprint generation (AI powered)
- AI powered learning activities

## Notes

- Database migrations live in `supabase/` at the repo root.
- Run Supabase migrations before testing class creation.
- New accounts must choose an immutable account type at signup (`teacher` or `student`).
- Enable Supabase Auth email confirmation so users must verify email before protected access.
- Set `NEXT_PUBLIC_SITE_URL` to the canonical app origin for the active environment.
- In hosted Supabase, configure `Auth -> URL Configuration` with the same Site URL plus localhost and preview redirect URLs.
- Update Supabase email templates to use the SSR auth callback:
  - Confirm signup: `{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=email`
  - Recovery: `{{ .RedirectTo }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery`
- Disable Supabase phone auth provider (phone-based auth is intentionally out of scope).
- Ensure the `materials` storage bucket exists for uploads.
- Configure at least one AI provider with both a chat model and an embedding model.
- Optional migration adapter: set `PYTHON_BACKEND_ENABLED=true` and `PYTHON_BACKEND_URL` to route
  AI generation/embedding calls through the Python backend while preserving existing Next flows.
- Full migration gate: set `PYTHON_BACKEND_MODE=python_only` to enforce Python backend usage across
  AI generation paths, class create/join, class chat workspace, and material dispatch (with strict fallback behavior).
- Optional class workflow adapter: set `PYTHON_BACKEND_CLASSES_ENABLED=true` to route class create/join
  through Python endpoints in hybrid mode.
- Optional chat workspace adapter: set `PYTHON_BACKEND_CHAT_WORKSPACE_ENABLED=true` to route class chat
  workspace session/message list/send operations through Python endpoints in hybrid mode.
- Default background ingestion backend is `MATERIAL_WORKER_BACKEND=supabase`, which enqueues jobs through Supabase `pgmq`.
- Supabase Cron dispatches the `material-worker` Edge Function (configured by migration and Vault secrets).
- `POST /api/materials/process` is a legacy fallback worker path when `MATERIAL_WORKER_BACKEND=legacy`.
- `POST /api/materials/process` proxies to Python `/v1/materials/process` when `PYTHON_BACKEND_MODE=python_only`.
- For full staging + production rollout steps, see `../DEPLOYMENT.md`.
