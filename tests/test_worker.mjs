import assert from 'node:assert/strict';
import test from 'node:test';

import worker, { publicConfig } from '../worker/index.js';


test('public config matches the guided interview contract', () => {
  const config = publicConfig();

  assert.equal(config.required_fields.length, 4);
  assert.equal(config.tool.name, 'record_plan_field');
  assert.equal(config.tool.status_label, 'interview notes');
  assert.deepEqual(config.tool.parameters.required, ['updates']);
  assert.equal(config.tool.parameters.properties.updates.type, 'array');
  assert.equal(config.tool.parameters.properties.updates.minItems, 1);
  assert.match(config.instructions, /immediately call end_call/);
  assert.match(config.instructions, /one record_plan_field call/);
});


test('health reports whether the Converse key is configured', async () => {
  const configured = await worker.fetch(
    new Request('https://example.test/api/health'),
    {CONVERSE_API_KEY: 'ck_test'},
  );
  const missing = await worker.fetch(
    new Request('https://example.test/api/health'),
    {},
  );

  assert.deepEqual(await configured.json(), {ok: true, configured: true});
  assert.deepEqual(await missing.json(), {ok: true, configured: false});
});


test('session exchange keeps the persistent key in the Worker', async () => {
  const originalFetch = globalThis.fetch;
  let upstream;
  globalThis.fetch = async (url, options) => {
    upstream = {url, options};
    return Response.json(
      {api_key: 'scoped_key', session_id: JSON.parse(options.body).session_id, expires_in: 7800},
      {status: 201},
    );
  };

  try {
    const response = await worker.fetch(
      new Request('https://example.test/api/session', {method: 'POST'}),
      {
        CONVERSE_API_KEY: 'ck_worker_secret',
        CONVERSE_API_BASE_URL: 'https://api.dialt.com',
      },
    );
    const body = await response.json();

    assert.equal(response.status, 201);
    assert.equal(upstream.url, 'https://api.dialt.com/v1/session-keys');
    assert.equal(upstream.options.headers.Authorization, 'Bearer ck_worker_secret');
    assert.match(body.session_id, /^short-interview-[a-f0-9]{16}$/);
    assert.equal(body.api_key, 'scoped_key');
    assert.ok(!Object.values(body).includes('ck_worker_secret'));
  } finally {
    globalThis.fetch = originalFetch;
  }
});


test('legacy static paths are rewritten to the asset root', async () => {
  let assetUrl;
  const response = await worker.fetch(
    new Request('https://example.test/static/app.js'),
    {
      ASSETS: {
        fetch: async request => {
          assetUrl = request.url;
          return new Response('asset');
        },
      },
    },
  );

  assert.equal(await response.text(), 'asset');
  assert.equal(assetUrl, 'https://example.test/app.js');
});
