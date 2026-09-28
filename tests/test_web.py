from __future__ import annotations

import json

import httpx
import pytest

from interview_demo import web


@pytest.mark.asyncio
async def test_health_reports_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("CONVERSE_API_KEY", raising=False)

    assert await web.health() == {"ok": True, "configured": False}


@pytest.mark.asyncio
async def test_session_key_exchange_stays_on_backend(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("CONVERSE_API_KEY", "ck_server_secret")
    monkeypatch.setenv("CONVERSE_API_BASE_URL", "https://example.test")
    captured: dict = {}

    class FakeClient:
        def __init__(self, **_kwargs: object) -> None:
            pass

        async def __aenter__(self) -> "FakeClient":
            return self

        async def __aexit__(self, *_args: object) -> None:
            return None

        async def post(self, url: str, **kwargs: object) -> httpx.Response:
            captured.update(url=url, **kwargs)
            request = httpx.Request("POST", url)
            return httpx.Response(
                201,
                request=request,
                content=json.dumps(
                    {
                        "api_key": "sk_browser_safe",
                        "session_id": kwargs["json"]["session_id"],
                        "expires_in": 7800,
                    }
                ),
            )

    monkeypatch.setattr(web.httpx, "AsyncClient", FakeClient)
    result = await web.create_session()

    assert captured["url"] == "https://example.test/v1/session-keys"
    assert captured["headers"] == {"Authorization": "Bearer ck_server_secret"}
    assert result["api_key"] == "sk_browser_safe"
    assert result["session_id"].startswith("short-interview-")
    assert "ck_server_secret" not in result.values()
