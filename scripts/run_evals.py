from __future__ import annotations

import argparse
import os
from pathlib import Path

from dialt import EvalsClient, EvalsError, load_cases, validate_case
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]
BATCH_CASE_NAME = "guided interview: batched rich opening answer"
BATCH_REQUIRED_FIELDS = {
    "participant_context",
    "recent_example",
    "hardest_part",
    "ideal_outcome",
}


def batch_contract_error(attempt: dict) -> str | None:
    if attempt.get("case_name") != BATCH_CASE_NAME:
        return None
    calls = [
        event
        for event in attempt.get("events", [])
        if event.get("side") == "target"
        and event.get("type") == "tool_call"
        and event.get("name") == "record_plan_field"
    ]
    if not calls:
        return "expected at least one batched field call"
    turn_ids = [str(call.get("id") or "").split("-fc", 1)[0] for call in calls]
    if len(turn_ids) != len(set(turn_ids)):
        return "expected at most one batched field call per participant turn"
    for call in calls:
        updates = call.get("args", {}).get("updates")
        if not isinstance(updates, list) or not updates:
            return "a field call did not contain a non-empty updates array"
    updates = calls[0]["args"]["updates"]
    fields = {
        update.get("field")
        for update in updates
        if isinstance(update, dict)
        and isinstance(update.get("value"), str)
        and update["value"].strip()
    }
    missing = sorted(BATCH_REQUIRED_FIELDS - fields)
    if missing:
        return f"the batched field call omitted: {', '.join(missing)}"
    return None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Run the guided interview eval suite")
    parser.add_argument("--modality", choices=("text", "voice"), default="text")
    parser.add_argument("--repetitions", type=int, default=1)
    return parser.parse_args()


def main() -> None:
    load_dotenv(PROJECT_ROOT / ".env")
    args = parse_args()
    api_key = os.getenv("CONVERSE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("CONVERSE_API_KEY is required in .env")

    documents = [
        validate_case(document, modality=args.modality)
        for document in load_cases(PROJECT_ROOT / "evals")
    ]
    client = EvalsClient(
        api_key,
        base_url=os.getenv("CONVERSE_API_BASE_URL", "https://api.dialt.com"),
    )
    try:
        cases = client.upsert_cases(documents)
        run = client.start_run(
            [case["id"] for case in cases],
            modality=args.modality,
            repetitions=args.repetitions,
        )
        print(f"Dashboard: {client.dashboard_url(run['id'])}")
        run = client.wait(run["id"])
    except (EvalsError, TimeoutError) as exc:
        raise SystemExit(str(exc)) from None

    contract_errors = []
    for attempt in run.get("attempts", []):
        reason = attempt.get("termination_reason") or ""
        print(f"{attempt['status']:<9} {attempt['case_name']} {reason}")
        error = batch_contract_error(attempt)
        if error:
            contract_errors.append(error)
            print(f"          batch contract: {error}")
    print(f"Run status: {run['status']}")
    if run.get("status") != "passed" or contract_errors:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
