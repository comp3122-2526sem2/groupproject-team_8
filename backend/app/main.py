from __future__ import annotations

from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse

from app.blueprints import generate_blueprint
from app.chat import generate_chat
from app.chat_workspace import (
    ChatWorkspaceError,
    archive_session,
    create_session,
    list_messages,
    list_participants,
    list_sessions,
    rename_session,
    send_message,
)
from app.classes import ClassDomainError, create_class, join_class
from app.config import get_settings
from app.flashcards import generate_flashcards
from app.materials import dispatch_material_job, process_material_jobs
from app.providers import generate_embeddings_with_fallback, generate_with_fallback
from app.quiz import generate_quiz
from app.schemas import (
    ApiEnvelope,
    ApiError,
    BlueprintGenerateRequest,
    ClassCreateRequest,
    ClassJoinRequest,
    ChatWorkspaceMessageSendRequest,
    ChatWorkspaceMessagesListRequest,
    ChatWorkspaceParticipantsRequest,
    ChatWorkspaceSessionArchiveRequest,
    ChatWorkspaceSessionCreateRequest,
    ChatWorkspaceSessionRenameRequest,
    ChatWorkspaceSessionsListRequest,
    ChatGenerateRequest,
    EmbeddingsRequest,
    FlashcardsGenerateRequest,
    GenerateRequest,
    MaterialDispatchRequest,
    MaterialProcessRequest,
    QuizGenerateRequest,
)

app = FastAPI(title="STEM Learning Python Backend", version="0.1.0")


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    request_id = request.headers.get("x-request-id") or str(uuid4())
    request.state.request_id = request_id
    response = await call_next(request)
    response.headers["x-request-id"] = request_id
    return response


def _auth_error_response(request: Request) -> JSONResponse | None:
    settings = get_settings()
    expected_api_key = settings.python_backend_api_key
    if not expected_api_key:
        if settings.python_backend_allow_unauthenticated_requests:
            return None
        return JSONResponse(
            status_code=503,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(
                    message="Python backend authentication is misconfigured.",
                    code="backend_auth_misconfigured",
                ),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )

    header_key = request.headers.get("x-api-key")
    bearer = _parse_bearer_token(request.headers.get("authorization"))
    if header_key == expected_api_key or bearer == expected_api_key:
        return None

    return JSONResponse(
        status_code=401,
        content=ApiEnvelope(
            ok=False,
            error=ApiError(message="Unauthorized", code="unauthorized"),
            meta={"request_id": request.state.request_id},
        ).model_dump(),
    )


@app.get("/healthz")
async def healthz(request: Request):
    return ApiEnvelope(
        ok=True,
        data={"status": "ok"},
        meta={"request_id": request.state.request_id},
    ).model_dump()


@app.post("/v1/llm/generate")
async def generate(request: Request, payload: GenerateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_with_fallback(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="provider_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/llm/embeddings")
async def embeddings(request: Request, payload: EmbeddingsRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_embeddings_with_fallback(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="provider_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/materials/dispatch")
async def dispatch_materials(request: Request, payload: MaterialDispatchRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = dispatch_material_job(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="dispatch_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/materials/process")
async def process_materials(request: Request, payload: MaterialProcessRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = process_material_jobs(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="material_process_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/classes/create")
async def create_class_route(request: Request, payload: ClassCreateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = create_class(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="class_create_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/classes/join")
async def join_class_route(request: Request, payload: ClassJoinRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = join_class(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ClassDomainError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="class_join_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/blueprints/generate")
async def generate_blueprints(request: Request, payload: BlueprintGenerateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_blueprint(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="blueprint_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/quiz/generate")
async def generate_quizzes(request: Request, payload: QuizGenerateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_quiz(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="quiz_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/flashcards/generate")
async def generate_flashcards_route(request: Request, payload: FlashcardsGenerateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_flashcards(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="flashcards_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/generate")
async def generate_chat_route(request: Request, payload: ChatGenerateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = generate_chat(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result.model_dump(),
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/participants")
async def list_chat_workspace_participants_route(request: Request, payload: ChatWorkspaceParticipantsRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = list_participants(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/list")
async def list_chat_workspace_sessions_route(request: Request, payload: ChatWorkspaceSessionsListRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = list_sessions(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/create")
async def create_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionCreateRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = create_session(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/rename")
async def rename_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionRenameRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = rename_session(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/sessions/archive")
async def archive_chat_workspace_session_route(request: Request, payload: ChatWorkspaceSessionArchiveRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = archive_session(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/messages/list")
async def list_chat_workspace_messages_route(request: Request, payload: ChatWorkspaceMessagesListRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = list_messages(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


@app.post("/v1/chat/workspace/messages/send")
async def send_chat_workspace_message_route(request: Request, payload: ChatWorkspaceMessageSendRequest):
    unauthorized = _auth_error_response(request)
    if unauthorized:
        return unauthorized

    settings = get_settings()
    try:
        result = send_message(settings, payload)
        return ApiEnvelope(
            ok=True,
            data=result,
            meta={"request_id": request.state.request_id},
        ).model_dump()
    except ChatWorkspaceError as error:
        return JSONResponse(
            status_code=error.status_code,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=error.message, code=error.code),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )
    except RuntimeError as error:
        return JSONResponse(
            status_code=502,
            content=ApiEnvelope(
                ok=False,
                error=ApiError(message=str(error), code="chat_workspace_error"),
                meta={"request_id": request.state.request_id},
            ).model_dump(),
        )


def _parse_bearer_token(header: str | None) -> str | None:
    if not header:
        return None
    prefix = "bearer "
    if not header.lower().startswith(prefix):
        return None
    return header[len(prefix) :].strip() or None
