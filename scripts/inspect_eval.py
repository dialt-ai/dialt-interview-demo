from __future__ import annotations

import argparse
import json
import os
from pathlib import Path

from dialt import EvalsClient
from dotenv import load_dotenv


PROJECT_ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser(description="Print failed attempts from one eval run")
    parser.add_argument("run_id")
    args = parser.parse_args()

    load_dotenv(PROJECT_ROOT / ".env")
    api_key = os.getenv("CONVERSE_API_KEY", "").strip()
    if not api_key:
        raise SystemExit("CONVERSE_API_KEY is required in .env")
    client = EvalsClient(
        api_key,
        base_url=os.getenv("CONVERSE_API_BASE_URL", "https://api.dialt.com"),
    )
    run = client.get_run(args.run_id)
    failures = [
        {
            "case_name": attempt.get("case_name"),
            "repetition": attempt.get("repetition"),
            "transcript": attempt.get("transcript"),
            "checks": attempt.get("checks"),
            "judges": attempt.get("judges"),
            "termination_reason": attempt.get("termination_reason"),
            "error": attempt.get("error"),
        }
        for attempt in run.get("attempts", [])
        if attempt.get("status") != "passed"
    ]
    print(json.dumps(failures, indent=2))


if __name__ == "__main__":
    main()
