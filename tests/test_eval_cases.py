from pathlib import Path

from dialt import load_cases, validate_case
from scripts.run_evals import batch_contract_error


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def test_all_eval_cases_are_valid_and_cover_expected_scenarios() -> None:
    cases = [validate_case(case) for case in load_cases(PROJECT_ROOT / "evals")]

    assert len(cases) == 5
    assert {case["name"] for case in cases} == {
        "guided interview: batched rich opening answer",
        "guided interview: terse participant",
        "guided interview: participant correction",
        "guided interview: optional question refused",
        "guided interview: explicit early stop",
    }


def test_every_eval_proves_required_fields_are_recorded() -> None:
    for case in load_cases(PROJECT_ROOT / "evals"):
        checks = case["checks"]
        if case["name"] == "guided interview: explicit early stop":
            assert any(
                check["type"] == "tool_called" and check["value"] == "end_call"
                for check in checks
            )
        elif case["name"] == "guided interview: batched rich opening answer":
            assert any(
                check["type"] == "tool_called" and check["value"] == "record_plan_field"
                for check in checks
            )
        else:
            assert {
                check["value"] for check in checks if check["type"] == "fixture_complete"
            } == {"record_plan_field"}
        assert any(check["type"] == "judge" for check in checks)
        assert "missing_required" in case["target"]["instructions"]
        tool = case["target"]["tools"][0]
        assert tool["read_only"] is False
        assert tool["expected_duration"] == "instant"
        assert tool["status_label"] == "interview notes"
        assert case["target"]["end_call"] is True


def test_batch_eval_requires_one_call_containing_every_required_field() -> None:
    valid_attempt = {
        "case_name": "guided interview: batched rich opening answer",
        "events": [{
            "side": "target",
            "type": "tool_call",
            "name": "record_plan_field",
            "args": {"updates": [
                {"field": "participant_context", "value": "Support lead"},
                {"field": "recent_example", "value": "Invoice export incident"},
                {"field": "hardest_part", "value": "Piecing together evidence"},
                {"field": "ideal_outcome", "value": "One incident view"},
            ]},
        }],
    }

    assert batch_contract_error(valid_attempt) is None
    valid_attempt["events"].append(valid_attempt["events"][0])
    assert batch_contract_error(valid_attempt) == (
        "expected at most one batched field call per participant turn"
    )


def test_every_starter_fits_the_voice_greeting_limit() -> None:
    for case in load_cases(PROJECT_ROOT / "evals"):
        validate_case(case, modality="voice")
        assert len(case["starter"]) <= 300, case["name"]
