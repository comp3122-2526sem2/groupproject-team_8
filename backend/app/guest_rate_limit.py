from __future__ import annotations

from collections import defaultdict
from threading import Lock

from app.config import Settings

_feature_usage: dict[str, dict[str, int]] = defaultdict(dict)
_concurrent_slots: dict[str, int] = defaultdict(int)
_state_lock = Lock()


def _feature_limit(settings: Settings, feature: str) -> int:
    if feature == "chat":
        return settings.guest_chat_limit
    if feature == "quiz":
        return settings.guest_quiz_limit
    if feature == "flashcards":
        return settings.guest_flashcards_limit
    if feature == "blueprint":
        return settings.guest_blueprint_limit
    if feature == "embedding":
        return settings.guest_embedding_limit
    return 0


def check_guest_ai_access(
    settings: Settings,
    sandbox_id: str,
    feature: str,
) -> tuple[bool, str | None]:
    limit = _feature_limit(settings, feature)
    if limit <= 0:
        return False, f"Guest {feature} limit reached."

    with _state_lock:
        used = _feature_usage.get(sandbox_id, {}).get(feature, 0)
    if used >= limit:
        return False, f"Guest {feature} limit reached."
    return True, None


def acquire_guest_ai_slot(settings: Settings, sandbox_id: str) -> bool:
    limit = settings.guest_max_concurrent_ai_requests
    with _state_lock:
        current = _concurrent_slots.get(sandbox_id, 0)
        if current >= limit:
            return False
        _concurrent_slots[sandbox_id] = current + 1
        return True


def release_guest_ai_slot(sandbox_id: str) -> None:
    with _state_lock:
        current = _concurrent_slots.get(sandbox_id, 0)
        if current <= 1:
            _concurrent_slots.pop(sandbox_id, None)
            return
        _concurrent_slots[sandbox_id] = current - 1


def increment_guest_ai_usage(sandbox_id: str, feature: str) -> None:
    with _state_lock:
        per_feature = _feature_usage.setdefault(sandbox_id, {})
        per_feature[feature] = per_feature.get(feature, 0) + 1
