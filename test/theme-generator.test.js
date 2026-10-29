import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { fallbackTheme, suggestTheme, themeModel } from '../lib/theme-generator.js';

beforeEach((t) => {
  for (const [key, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (previous === undefined) delete process.env[key];
      else process.env[key] = previous;
    });
  }
});

function respond(t, body, status = 200) {
  return t.mock.method(globalThis, 'fetch', async () => Response.json(body, { status }));
}

function answer(theme) {
  return { success: true, result: { response: theme }, errors: [] };
}

test('missing or blank Cloudflare credentials give setup instructions without a request', async (t) => {
  const request = respond(t, {});
  for (const key of ['CLOUDFLARE_ACCOUNT_ID', 'CLOUDFLARE_API_TOKEN']) {
    for (const value of [undefined, '', '   ']) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
      await assert.rejects(suggestTheme(), /CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set/);
    }
    process.env[key] = 'test-value';
  }
  assert.equal(request.mock.callCount(), 0);
});

test('requests a JSON theme using the existing Cloudflare credentials and recent titles', async (t) => {
  const request = respond(t, answer({ title: ' Cloud Cities ', description: ' Imagine life above the clouds. ' }));
  assert.deepEqual(await suggestTheme(['Woodlands', 'Deep Sea']), {
    title: 'Cloud Cities', description: 'Imagine life above the clouds.', model: themeModel,
  });
  const [url, options] = request.mock.calls[0].arguments;
  assert.equal(url, `https://api.cloudflare.com/client/v4/accounts/test-account/ai/run/${themeModel}`);
  assert.equal(options.method, 'POST');
  assert.equal(options.cache, 'no-store');
  assert.equal(options.headers.Authorization, 'Bearer test-token');
  const body = JSON.parse(options.body);
  assert.match(body.messages[0].content, /Return only a JSON object/);
  assert.match(body.messages[1].content, /\["Woodlands","Deep Sea"\]/);
  assert.equal(body.max_tokens, 256);
  assert.equal(body.response_format.type, 'json_schema');
  assert.deepEqual(body.response_format.json_schema.required, ['title', 'description']);
});

test('accepts a theme returned as a JSON string', async (t) => {
  respond(t, answer(JSON.stringify({ title: 'Cloud Cities', description: 'Imagine life above the clouds.' })));
  assert.equal((await suggestTheme()).title, 'Cloud Cities');
});

for (const [status, message] of [[400, 'Invalid request.'], [403, 'Authentication error.'], [404, 'Model not found.'], [429, 'Quota exceeded.'], [503, 'Service unavailable.']]) {
  test(`reports HTTP ${status} with the model and API reason`, async (t) => {
    respond(t, { success: false, errors: [{ message }] }, status);
    await assert.rejects(suggestTheme(), (error) => {
      assert.ok(error.message.includes(`HTTP ${status}`));
      assert.ok(error.message.includes(themeModel));
      assert.ok(error.message.includes(message));
      return true;
    });
  });
}

test('rejects unsuccessful API envelopes even with HTTP 200', async (t) => {
  respond(t, { success: false, errors: [{ message: "JSON Mode couldn't be met" }] });
  await assert.rejects(suggestTheme(), /JSON Mode couldn't be met/);
});

test('reports non-JSON API errors with the HTTP status', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('Unavailable', { status: 502 }));
  await assert.rejects(suggestTheme(), /HTTP 502/);
});

test('reports invalid response envelopes and missing answers', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('not JSON'));
  await assert.rejects(suggestTheme(), /invalid JSON response/);
  for (const body of [{ success: true }, answer(null), answer('')]) {
    respond(t, body);
    await assert.rejects(suggestTheme(), /did not return a theme/);
  }
});

test('rejects malformed JSON and invalid theme fields', async (t) => {
  respond(t, answer('```json\n{}\n```'));
  await assert.rejects(suggestTheme(), /not valid JSON/);
  for (const theme of [[], { title: 42, description: 'A number.' }, { title: 'Clouds' }, { title: ' ', description: 'Clouds.' }, { title: 'Clouds', description: {} }, { title: 'Clouds', description: ' ' }]) {
    respond(t, answer(theme));
    await assert.rejects(suggestTheme(), /without a valid title and description/);
  }
});

test('keeps theme wording within database limits', async (t) => {
  respond(t, answer({ title: 'x'.repeat(90), description: 'x'.repeat(450) }));
  const theme = await suggestTheme();
  assert.equal(theme.title.length, 80);
  assert.equal(theme.description.length, 400);
});

test('explains request timeouts and network failures', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => { throw new DOMException('Timed out', 'TimeoutError'); });
  await assert.rejects(suggestTheme(), /timed out after 20 seconds/);
  t.mock.method(globalThis, 'fetch', async () => { throw new TypeError('fetch failed'); });
  await assert.rejects(suggestTheme(), /Could not connect to Cloudflare/);
});

test('supports a configured Workers AI text model', async (t) => {
  const previousModel = process.env.CLOUDFLARE_THEME_MODEL;
  t.after(() => {
    if (previousModel === undefined) delete process.env.CLOUDFLARE_THEME_MODEL;
    else process.env.CLOUDFLARE_THEME_MODEL = previousModel;
  });
  process.env.CLOUDFLARE_THEME_MODEL = ' @cf/meta/llama-3.1-8b-instruct ';
  const customized = await import('../lib/theme-generator.js?custom-model');
  const request = respond(t, answer({ title: 'Clouds', description: 'Imagine the sky.' }));
  assert.equal((await customized.suggestTheme()).model, '@cf/meta/llama-3.1-8b-instruct');
  assert.match(request.mock.calls[0].arguments[0], /\/ai\/run\/@cf\/meta\/llama-3\.1-8b-instruct$/);
});

test('built-in themes remain available without credentials', () => {
  const titles = ['Woodlands', 'Fine Art', 'Video Game Characters', 'Deep Sea', 'Retro Future', 'Tiny Worlds', 'Street Food', 'Myths and Legends', 'Weather', 'Architecture'];
  const theme = fallbackTheme(titles.slice(0, -1));
  assert.equal(theme.title, 'Architecture');
  assert.equal(theme.model, null);
  assert.ok(fallbackTheme(titles).title);
});
