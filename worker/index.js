import plan from '../interview_plan.json' with {type: 'json'};


const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
};


function requiredFields() {
  return plan.fields
    .filter(field => field.required !== false)
    .map(field => String(field.key));
}


function buildInstructions() {
  const evidence = plan.fields.map(field => {
    const requirement = field.required === false ? 'optional' : 'required';
    return `- ${field.key} (${requirement}): ${field.description}`;
  }).join('\n');
  return [
    `You are conducting ${plan.name}.`,
    `Objective: ${plan.objective}`,
    '',
    'Collect the evidence below through a concise, natural conversation. Choose the order based on what the participant says. Ask only one question at a time. Clarify vague or very short answers, but do not ask a follow-up when the participant has already supplied the evidence. Do not read the field list aloud. Whenever an answer sufficiently supports one or more fields, make one record_plan_field call containing all supported fields in the updates array. Batch all supported fields from the participant\'s latest answer into that one call. Update a field if later evidence changes it. Treat a refusal to answer respectfully and do not pressure the participant. Do not claim the interview is complete until every required field has been recorded. Treat the tool\'s missing_required and complete result as the authoritative completion state. When complete is true, do not ask another evidence-gathering question; proceed to the completion flow. If the participant asks to stop or end the interview at any point, stop gathering evidence and immediately call end_call with a brief respectful farewell, even if required fields are still missing. Never say goodbye or imply that the session has ended without calling end_call. After the normal completion flow, also use end_call for the final farewell. Keep the interview to about three minutes.',
    '',
    `Evidence:\n${evidence}`,
    '',
    `Once complete: ${plan.completion}`,
  ].join('\n');
}


function buildTool() {
  return {
    name: 'record_plan_field',
    description: 'Record or correct every supported piece of evidence from the participant\'s latest answer in one call. Submit all field updates together. The result reports missing_required and complete; follow that state before asking another question.',
    parameters: {
      type: 'object',
      properties: {
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: plan.fields.length,
          description: 'All supported or corrected fields from the participant\'s latest answer.',
          items: {
            type: 'object',
            properties: {
              field: {
                type: 'string',
                enum: plan.fields.map(field => String(field.key)),
              },
              value: {
                type: 'string',
                description: 'Concise evidence in the participant\'s own terms.',
              },
            },
            required: ['field', 'value'],
            additionalProperties: false,
          },
        },
      },
      required: ['updates'],
      additionalProperties: false,
    },
    read_only: false,
    expected_duration: 'instant',
    status_label: 'interview notes',
  };
}


export function publicConfig() {
  return {
    name: plan.name,
    greeting: plan.greeting,
    instructions: buildInstructions(),
    fields: plan.fields,
    required_fields: requiredFields(),
    tool: buildTool(),
  };
}


// The realtime endpoint lives on the same API origin that mints the session key, so a deployment
// pointed at another Dialt environment connects to that environment too.
export function realtimeUrl(baseUrl) {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === 'http:' ? 'ws:' : 'wss:';
  url.pathname = '/v1/realtime';
  url.search = '';
  return url.toString();
}


function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {status, headers: JSON_HEADERS});
}


async function createSession(env) {
  const apiKey = String(env.CONVERSE_API_KEY || '').trim();
  if (!apiKey) {
    return jsonResponse({detail: 'CONVERSE_API_KEY is not configured on the server.'}, 503);
  }

  const baseUrl = String(env.CONVERSE_API_BASE_URL || 'https://api.dialt.com').replace(/\/$/, '');
  const sessionId = `short-interview-${crypto.randomUUID().replaceAll('-', '').slice(0, 16)}`;
  let response;
  try {
    response = await fetch(`${baseUrl}/v1/session-keys`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({session_id: sessionId}),
    });
  } catch {
    return jsonResponse({detail: 'Could not reach the Dialt credential service.'}, 502);
  }

  const text = await response.text();
  if (!response.ok) {
    let detail = 'Dialt rejected the session credential request.';
    try {
      const body = JSON.parse(text);
      detail = body.error || body.detail || detail;
    } catch {
      // Keep the safe generic message for a non-JSON upstream response.
    }
    return jsonResponse({detail: String(detail)}, response.status);
  }
  return jsonResponse({...JSON.parse(text), ws_url: realtimeUrl(baseUrl)}, response.status);
}


async function serveAsset(request, env, pathname) {
  if (!env.ASSETS) return new Response('Asset binding is unavailable.', {status: 503});
  if (!pathname.startsWith('/static/')) return env.ASSETS.fetch(request);

  const assetUrl = new URL(request.url);
  assetUrl.pathname = pathname.slice('/static'.length);
  return env.ASSETS.fetch(new Request(assetUrl, request));
}


export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/config') {
      return jsonResponse(publicConfig());
    }
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return jsonResponse({ok: true, configured: Boolean(String(env.CONVERSE_API_KEY || '').trim())});
    }
    if (request.method === 'POST' && url.pathname === '/api/session') {
      return createSession(env);
    }
    if (url.pathname.startsWith('/api/')) {
      return jsonResponse({detail: 'Not found.'}, 404);
    }
    return serveAsset(request, env, url.pathname);
  },
};
