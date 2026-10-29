import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { generateImage } from '../lib/generate.js';
import { suggestTheme } from '../lib/theme-generator.js';

beforeEach((t) => {
  for (const [key, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' })) {
    const previous = process.env[key]; process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
});

function database({ capability = 'image', outputFormat = 'image-base64', parameters = { steps: 4 }, instructions = '', enabled = true, modelKey = '@cf/test/selected-model' } = {}) {
  const events = [];
  return {
    events,
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; },
        insert(row) { events.push({ table, row }); return query; },
        async single() {
          if (table === 'app_settings') return { data: { image_model_id: 'image-id', theme_model_id: 'theme-id', image_prompt_prefix: instructions, theme_instructions: instructions } };
          if (table === 'llm_models') return { data: { model_key: modelKey, capability, output_format: outputFormat, parameters, enabled, provider: { name: 'Configured provider', adapter: 'cloudflare', enabled: true } } };
          return { data: { id: 'request-id' } };
        },
      };
      return query;
    },
    async rpc(name, args) { events.push({ name, args }); return { error: null }; },
  };
}

test('image generation uses the database-selected model, parameters and prompt prefix', async (t) => {
  const db = database({ instructions: 'Watercolor style' });
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { image: Buffer.from('image-bytes').toString('base64') } }));
  const result = await generateImage('A garden', { supabase: db, userId: 'fake-user', themeId: 100 });
  assert.equal(result.model, '@cf/test/selected-model');
  assert.equal(result.requestId, 'request-id');
  const [url, options] = request.mock.calls[0].arguments;
  assert.ok(url.endsWith('/ai/run/@cf/test/selected-model'));
  assert.deepEqual(JSON.parse(options.body), { prompt: 'Watercolor style\nA garden', steps: 4 });
  assert.equal(db.events[0].row.user_id, 'fake-user');
  assert.equal(db.events[0].row.prompt, 'A garden');
  const completion = db.events.find((e) => e.name === 'complete_generation_request');
  assert.equal(completion.args.succeeded, true);
  assert.equal(completion.args.response_output.byte_length, 11);
  assert.ok(!JSON.stringify(db.events).includes('test-token'));
  assert.ok(!JSON.stringify(db.events).includes(Buffer.from('image-bytes').toString('base64')));
});
test('binary image models store image metadata and preserve the returned file type', async (t) => {
  const db = database({ outputFormat: 'image-binary', parameters: { num_steps: 20 } });
  t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([137, 80, 78, 71]), { headers: { 'content-type': 'image/png' } }));
  const result = await generateImage('A garden', { supabase: db });
  assert.equal(result.extension, 'png');
  assert.equal(result.contentType, 'image/png');
  assert.equal(result.bytes.length, 4);
});
test('theme generation uses the selected model and records the structured response', async (t) => {
  const db = database({ capability: 'theme', outputFormat: 'json', parameters: { max_tokens: 512 }, instructions: 'Favor whimsical scenes.' });
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { response: { title: 'Sky Gardens', description: 'Imagine a garden above the clouds.' } } }));
  const result = await suggestTheme(['Deep Sea'], { supabase: db });
  assert.equal(result.model, '@cf/test/selected-model');
  const body = JSON.parse(request.mock.calls[0].arguments[1].body);
  assert.equal(body.max_tokens, 512);
  assert.match(body.messages[0].content, /Favor whimsical scenes/);
  assert.equal(db.events.at(-1).args.response_output.title, 'Sky Gardens');
});
test('provider failures are preserved in history and returned to the caller', async (t) => {
  const db = database();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, errors: [{ message: 'Daily limit reached.' }] }, { status: 429 }));
  await assert.rejects(generateImage('A garden', { supabase: db }), /Daily limit reached/);
  const completion = db.events.at(-1);
  assert.equal(completion.args.succeeded, false);
  assert.equal(completion.args.failure, 'Daily limit reached.');
});
test('an unavailable active model fails before sending a provider request', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not be reached'); });
  await assert.rejects(generateImage('A garden', { supabase: database({ enabled: false }) }), /enabled Cloudflare image model/);
  assert.equal(request.mock.callCount(), 0);
});
test('model IDs cannot redirect requests to another account API endpoint', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => { throw new Error('should not be reached'); });
  await assert.rejects(generateImage('A garden', { supabase: database({ modelKey: '@cf/../../other-endpoint' }) }), /Cloudflare model IDs/);
  assert.equal(request.mock.callCount(), 0);
});
