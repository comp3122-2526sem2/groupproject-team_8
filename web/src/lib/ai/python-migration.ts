import "server-only";

export type PythonBackendMode = "hybrid" | "python_only";

export function isPythonOnlyMode() {
  return resolvePythonBackendMode() === "python_only";
}

export function resolvePythonBackendEnabled(featureFlagValue: string | undefined) {
  if (isPythonOnlyMode()) {
    return true;
  }
  return normalizeBooleanEnv(featureFlagValue, normalizeBooleanEnv(process.env.PYTHON_BACKEND_ENABLED, false));
}

export function resolvePythonBackendStrict() {
  if (isPythonOnlyMode()) {
    return true;
  }
  return normalizeBooleanEnv(process.env.PYTHON_BACKEND_STRICT, false);
}

export function normalizeBooleanEnv(value: string | undefined, fallback: boolean) {
  if (!value) {
    return fallback;
  }
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }
  return fallback;
}

function resolvePythonBackendMode(): PythonBackendMode {
  const value = process.env.PYTHON_BACKEND_MODE?.trim().toLowerCase();
  if (value === "python_only") {
    return "python_only";
  }
  return "hybrid";
}
