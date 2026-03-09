# STEM Python Backend

FastAPI backend for AI provider orchestration (OpenAI, Gemini, OpenRouter) with
fallback and deterministic response envelopes.

## Endpoints

- `GET /healthz`
- `POST /v1/llm/generate`
- `POST /v1/llm/embeddings`

Response envelope:

```json
{
  "ok": true,
  "data": {},
  "error": null,
  "meta": { "request_id": "..." }
}
```

## Local Run

1. Install dependencies:

```bash
pip install -r backend/requirements.txt
```

2. Set env vars (same AI vars already used by `web`), plus optional:

- `PYTHON_BACKEND_API_KEY` for internal auth.
- `PYTHON_BACKEND_LOG_PROVIDER_FAILURES=true` (default).

3. Start the service:

```bash
uvicorn app.main:app --app-dir backend --host 0.0.0.0 --port 8001 --reload
```
