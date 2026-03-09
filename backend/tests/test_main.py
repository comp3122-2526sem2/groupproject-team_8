from __future__ import annotations

import path_setup  # noqa: F401

import unittest
from unittest.mock import patch

from fastapi.testclient import TestClient

from app.main import _parse_bearer_token, app
from tests.helpers import make_settings


class MainTests(unittest.TestCase):
    def test_parse_bearer_token(self) -> None:
        self.assertEqual(_parse_bearer_token("Bearer abc"), "abc")
        self.assertIsNone(_parse_bearer_token("Token abc"))

    def test_healthz(self) -> None:
        client = TestClient(app)
        response = client.get("/healthz")
        self.assertEqual(response.status_code, 200)
        self.assertTrue(response.json()["ok"])

    def test_unauthorized_without_api_key_header(self) -> None:
        settings = make_settings(python_backend_api_key="secret")
        client = TestClient(app)
        with patch("app.main.get_settings", return_value=settings):
            response = client.post("/v1/llm/generate", json={"system": "s", "user": "u"})

        self.assertEqual(response.status_code, 401)
        self.assertEqual(response.json()["error"]["code"], "unauthorized")


if __name__ == "__main__":
    unittest.main()
