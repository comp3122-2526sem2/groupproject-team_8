import "server-only";

export function resolvePythonBackendEnabled() {
  return Boolean(process.env.PYTHON_BACKEND_URL?.trim());
}

export function resolvePythonBackendStrict() {
  return resolvePythonBackendEnabled();
}
