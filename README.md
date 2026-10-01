# Dialt interview demo

A three-minute guided interview using the Dialt Browser SDK. The application defines the
evidence to collect, records all evidence from each answer through one instant client-tool call,
and owns the completion state.

Hosted demo: <https://dialt-interview-demo.ronan-e62.workers.dev>

## Setup

1. Copy `.env.example` to `.env` and set `CONVERSE_API_KEY` to a persistent `ck_` key.
   `CONVERSE_API_BASE_URL` selects the Dialt API origin (default `https://api.dialt.com`; use `https://api.dev.dialt.com` for dev). The server mints session keys there and the browser connects to that origin's `/v1/realtime`.
2. Install dependencies:

   ```sh
   uv sync
   ```

3. Run the app:

   ```sh
   uv run uvicorn interview_demo.web:app --reload --port 8010
   ```

4. Open <http://127.0.0.1:8010> and select **Start interview**.

The persistent API key stays on the backend. The browser receives a short-lived credential bound
to one generated session ID. The interview enables Dialt's managed completion flow so the
assistant can give its final summary and farewell before the session closes cleanly.

## Interview

The demo asks about one recent recurring work task. It gathers four required pieces of evidence:

- your role and context;
- a concrete recent example;
- the hardest part and its consequence;
- what a materially better outcome would look like.

The interview should take about three minutes. It ends with a short summary that you can correct.

## Tests

Run the local test suite:

```sh
uv run pytest
```

## Dialt evals

The `evals/` directory covers five scenarios:

- a rich opening answer;
- terse answers that require clarification;
- a correction to previously recorded evidence;
- refusal of an optional follow-up request;
- an explicit request to stop before the interview is complete.

Run hosted text evals first:

```sh
uv run scripts/run_evals.py --modality text --repetitions 2
```

Then validate the same behavior end to end in voice:

```sh
uv run scripts/run_evals.py --modality voice --repetitions 1
```

Each command prints the Dialt eval dashboard URL and exits nonzero unless the run passes.

## Cloudflare deployment

The Worker in `worker/` serves the static interview and implements the same configuration, health,
and scoped-credential endpoints as the FastAPI app. Store the persistent key as a Worker secret,
then deploy:

```sh
wrangler secret put CONVERSE_API_KEY
wrangler deploy
```

Run both local test suites before deploying:

```sh
uv run pytest
npm test
```
