from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_frontend_uses_current_converse_lifecycle_contract() -> None:
    app = (PROJECT_ROOT / "static" / "app.js").read_text(encoding="utf-8")

    assert "@dialt/sdk@0.48.1" in app
    assert "url: credential.ws_url" in app
    assert "end_call: true" in app
    assert "silent_mic" in app
    assert "session_end_requested" in app
    assert "session_end" in app
    assert "requestWrapUp" in app
    assert "detail.turn_id" in app
    assert "text_delta" in app
    assert "event.detail.delta" in app
    assert "args.updates" in app
    assert "for (const update of updates)" in app
    assert "recorded: recordedFields" in app
    assert "requestAnimationFrame(renderFields)" in app
