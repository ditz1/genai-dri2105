import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { cellStatus, newProject, ONCE } from '../lib/studio/chain.js';
import { checkQuota, loadImage, QuotaError, renderImage, runTextStep } from '../lib/studio/cloudflare.js';
import { extractPalette, nameColor } from '../lib/studio/palette.js';
import { isImagePath, LIMITS, sanitizeSheet, sheetFolder, summarize } from '../lib/studio/sheet.js';

const userId = '11111111-2222-3333-4444-555555555555';
const sheetId = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const winner = {
  themeId: 12, themeTitle: 'Enchanted Terrariums', themeDescription: 'Whole worlds under glass.', postId: 'post-1', authorId: 'user-1',
  author: 'Ada Lovelace', prompt: 'a tiny robot tending orchids', caption: null, model: 'flux', imagePath: `99999999-2222-3333-4444-555555555555/winner.jpg`,
};
const clean = (data, source = null) => sanitizeSheet(data, { userId, sheetId, source });

beforeEach((t) => {
  for (const [key, value] of Object.entries({ CLOUDFLARE_ACCOUNT_ID: 'test-account', CLOUDFLARE_API_TOKEN: 'test-token' })) {
    const previous = process.env[key];
    process.env[key] = value;
    t.after(() => { if (previous === undefined) delete process.env[key]; else process.env[key] = previous; });
  }
});

// Stands in for the Supabase client: records history rows and answers the queries the studio makes.
function database({ used = 0, posted = true } = {}) {
  const events = [];
  return {
    events,
    from(table) {
      const filters = [];
      const query = {
        select() { return query; },
        eq(column, value) { filters.push([column, value]); return query; },
        neq() { return query; }, not() { return query; },
        gte() { return Promise.resolve({ count: used, error: null, filters }); },
        insert(row) { events.push({ table, row }); return query; },
        async single() { return { data: { id: 'request-id' } }; },
        async maybeSingle() { return { data: table === 'posts' && posted ? { id: 'post-1' } : null }; },
      };
      return query;
    },
    async rpc(name, args) { events.push({ name, args }); return { error: null }; },
  };
}

function pixels(...areas) {
  return Uint8ClampedArray.from(areas.flatMap(([r, g, b, count]) => Array.from({ length: count }, () => [r, g, b, 255]).flat()));
}

test('a new sheet passes the server check unchanged, with or without a winner', () => {
  for (const source of [null, winner]) {
    const project = newProject(source);
    const data = clean(project, source);
    assert.deepEqual(data, { ...project, source });
    assert.deepEqual(summarize(data), { cover: null, renders: 0, portions: project.shots.length });
  }
});

test("the winner a sheet started from can't be swapped by the browser", () => {
  const project = newProject(winner);
  project.source = { ...winner, imagePath: `${userId}/private-draft.jpg`, prompt: 'something else' };
  assert.deepEqual(clean(project, winner).source, winner);
  // A blank sheet stays blank, and can't claim a winner as its style anchor.
  const blank = { ...newProject(), source: winner, image: { ...newProject().image, anchor: 'winner' } };
  const data = clean(blank);
  assert.equal(data.source, null);
  assert.equal(data.image.anchor, null);
});

test('renders are kept only when they sit in the sheet\'s own folder, and stale outputs are dropped', () => {
  const project = newProject(winner);
  const render = project.steps.at(-1);
  const [first, second, third] = project.shots.map((shot) => shot.id);
  const folder = sheetFolder(userId, sheetId);
  project.outputs[render.id] = {
    [first]: { imagePath: `${folder}/one.jpg`, seed: 7, prompt: 'a hero', signature: 's', at: 1 },
    [second]: { imagePath: `${winner.imagePath}`, seed: 7, prompt: 'not mine', signature: 's', at: 1 },
    [third]: { imagePath: `${userId}/studio/another-sheet/x.jpg`, seed: 7, prompt: 'other sheet', signature: 's', at: 1 },
    gone: { imagePath: `${folder}/orphan.jpg`, seed: 7, prompt: 'removed portion', signature: 's', at: 1 },
  };
  project.outputs.removedStep = { [ONCE]: { value: 'left over', signature: 's', at: 1 } };
  const data = clean(project, winner);
  assert.deepEqual(Object.keys(data.outputs), [render.id]);
  assert.deepEqual(Object.keys(data.outputs[render.id]), [first]);
  assert.deepEqual(summarize(data), { cover: `${folder}/one.jpg`, renders: 1, portions: project.shots.length });
});

test('sheets beyond the limits are refused with a message for the member', () => {
  const project = newProject();
  assert.throws(() => clean({ ...project, title: 'x'.repeat(LIMITS.title + 1) }), /title can be at most 120/);
  assert.throws(() => clean({ ...project, shots: Array.from({ length: LIMITS.shots + 1 }, (_, i) => ({ id: `s${i}`, category: 'Item', title: '', description: '' })) }), /at most 12 portions/);
  assert.throws(() => clean({ ...project, image: { ...project.image, model: 'someone-elses-model' } }), /Unknown image model/);
  assert.throws(() => clean({ ...project, palette: { name: 'x', colors: [{ name: 'Red', hex: 'red' }] } }), /valid hex code/);
  assert.throws(() => clean({ ...project, steps: [{ ...project.steps[0], key: 'two words' }] }), /invalid variable name/);
  assert.throws(() => clean({ ...project, steps: [project.steps[0], project.steps[0]] }), /duplicate ids/);
  assert.throws(() => clean(null), /could not be read/);
});

test('image paths must be a file inside a member folder', () => {
  assert.ok(isImagePath(`${userId}/photo.jpg`));
  assert.ok(isImagePath(`${sheetFolder(userId, sheetId)}/render.jpg`));
  for (const path of ['photo.jpg', `${userId}/../secret.jpg`, `${userId}/a.jpg?x=1`, `https://example.com/${userId}/a.jpg`, `${userId}/a.svg`, 42]) {
    assert.ok(!isImagePath(path), String(path));
  }
});

test('a palette is read from pixels: dominant color first, with a small vivid accent kept', () => {
  const palette = extractPalette(pixels([20, 60, 40, 6000], [200, 210, 120, 3000], [230, 80, 60, 150]));
  assert.equal(palette.length, 3);
  assert.deepEqual(palette, [{ name: 'Dark Green', hex: '#143c28' }, { name: 'Light Olive', hex: '#c8d278' }, { name: 'Red', hex: '#e6503c' }]);
});

test('near-identical colors are not counted twice, and shades that share a name are told apart', () => {
  assert.equal(extractPalette(pixels([100, 100, 100, 500], [102, 101, 100, 500])).length, 1);
  const greens = extractPalette(pixels([40, 100, 56, 600], [50, 130, 70, 400]));
  assert.deepEqual(greens.map((color) => color.name), ['Deep Green', 'Deep Green (lighter)']);
  assert.deepEqual(extractPalette(new Uint8ClampedArray(0)), []);
});

test('colors are named the way an image model would understand them', () => {
  const names = { '#449a9a': 'Teal', '#2d2d2b': 'Charcoal', '#9e6925': 'Brown', '#c1dbb3': 'Light Green', '#192ba9': 'Deep Blue', '#e9db79': 'Light Yellow',
    '#180a09': 'Black', '#e3eae9': 'Off-White', '#f2c14e': 'Yellow', '#ff2e88': 'Pink', '#7a7a7a': 'Grey', '#efd9b4': 'Cream', '#d8c3a0': 'Beige', '#143c28': 'Dark Green' };
  for (const [hex, name] of Object.entries(names)) assert.equal(nameColor(hex), name, hex);
});

test('a text step shown the winner sends the image to the vision model and is recorded as a studio request', async (t) => {
  const db = database();
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { response: 'flat vector poster, soft glow', usage: { neurons: 49 } } }));
  const result = await runTextStep({ supabase: db, userId, themeId: 12, sheetId, step: 'Read the winner', system: 'One line.', prompt: 'Describe it.',
    image: { bytes: Buffer.from('jpeg-bytes'), contentType: 'image/jpeg' } });
  assert.equal(result.text, 'flat vector poster, soft glow');
  const [url, options] = request.mock.calls[0].arguments;
  assert.ok(url.endsWith('/ai/run/@cf/mistralai/mistral-small-3.1-24b-instruct'));
  const body = JSON.parse(options.body);
  assert.equal(body.messages[0].content, 'One line.');
  assert.equal(body.messages[1].content[1].image_url.url, `data:image/jpeg;base64,${Buffer.from('jpeg-bytes').toString('base64')}`);
  const row = db.events[0].row;
  assert.deepEqual([row.kind, row.user_id, row.theme_id, row.prompt], ['text', userId, 12, 'Describe it.']);
  assert.deepEqual([row.input.source, row.input.sheet, row.input.step, row.input.vision], ['studio', sheetId, 'Read the winner', true]);
  // History keeps the answer but never the image or the credentials.
  assert.equal(db.events.at(-1).args.response_output.text, 'flat vector poster, soft glow');
  assert.ok(!JSON.stringify(db.events).includes(Buffer.from('jpeg-bytes').toString('base64')));
  assert.ok(!JSON.stringify(db.events).includes('test-token'));
});

test('a text step without an image uses the text model with a plain prompt', async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { choices: [{ message: { content: 'A drifting garden world.' } }] } }));
  const result = await runTextStep({ supabase: database(), userId, sheetId, step: 'World', system: '', prompt: 'Describe the world.' });
  assert.equal(result.text, 'A drifting garden world.');
  const [url, options] = request.mock.calls[0].arguments;
  assert.ok(url.endsWith('/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast'));
  assert.deepEqual(JSON.parse(options.body).messages, [{ role: 'user', content: 'Describe the world.' }]);
});

test('a render sends size, seed and the reference image to FLUX.2 and records the request', async (t) => {
  const db = database();
  const request = t.mock.method(globalThis, 'fetch', async () => Response.json({ success: true, result: { image: Buffer.from('render-bytes').toString('base64') } }));
  const image = await renderImage({ supabase: db, userId, themeId: 12, sheetId, step: 'Render', prompt: 'a hero', model: 'flux-2-klein-4b', width: 1024, height: 768, seed: 7,
    reference: { bytes: Buffer.from('winner-bytes'), contentType: 'image/jpeg', path: winner.imagePath } });
  assert.equal(image.bytes.toString(), 'render-bytes');
  assert.equal(image.extension, 'jpg');
  const [url, options] = request.mock.calls[0].arguments;
  assert.ok(url.endsWith('/ai/run/@cf/black-forest-labs/flux-2-klein-4b'));
  assert.deepEqual([options.body.get('prompt'), options.body.get('width'), options.body.get('height'), options.body.get('seed')], ['a hero', '1024', '768', '7']);
  assert.equal(await options.body.get('input_image_0').text(), 'winner-bytes');
  const row = db.events[0].row;
  assert.deepEqual([row.kind, row.model, row.input.source, row.input.reference], ['image', '@cf/black-forest-labs/flux-2-klein-4b', 'studio', winner.imagePath]);
  assert.equal(db.events.at(-1).args.succeeded, true);
});

test('a failed render is recorded as failed and reported', async (t) => {
  const db = database();
  t.mock.method(globalThis, 'fetch', async () => Response.json({ success: false, errors: [{ message: 'Daily limit reached.' }] }, { status: 429 }));
  await assert.rejects(renderImage({ supabase: db, userId, sheetId, step: 'Render', prompt: 'a hero', model: 'flux-1-schnell' }), /Daily limit reached/);
  assert.equal(db.events.at(-1).args.succeeded, false);
});

test('the daily studio allowance is counted per kind and stops generation when used up', async () => {
  await checkQuota(database({ used: LIMITS.dailyRenders - 1 }), userId, 'image');
  await assert.rejects(checkQuota(database({ used: LIMITS.dailyRenders }), userId, 'image'), (error) => error instanceof QuotaError && /design-sheet renders/.test(error.message));
  await checkQuota(database({ used: LIMITS.dailyRenders }), userId, 'text');
  await assert.rejects(checkQuota(database({ used: LIMITS.dailyTextSteps }), userId, 'text'), QuotaError);
});

test("a step can be shown a posted image or the member's own file, and nothing else", async (t) => {
  const request = t.mock.method(globalThis, 'fetch', async () => new Response(new Uint8Array([255, 216, 255]), { headers: { 'content-type': 'image/jpeg' } }));
  const shown = await loadImage(database(), userId, winner.imagePath);
  assert.deepEqual([shown.contentType, shown.bytes.length], ['image/jpeg', 3]);
  await loadImage(database({ posted: false }), userId, `${sheetFolder(userId, sheetId)}/own.jpg`);
  assert.equal(request.mock.callCount(), 2);
  // Someone else's unposted draft, or anything that isn't a path in the bucket, is never fetched.
  await assert.rejects(loadImage(database({ posted: false }), userId, winner.imagePath), /no longer available/);
  await assert.rejects(loadImage(database(), userId, 'https://example.com/a.jpg'), /no longer available/);
  assert.equal(request.mock.callCount(), 2);
});

test('the default winner chain stays within what a sheet may hold', () => {
  const project = newProject(winner);
  assert.ok(project.steps.length <= LIMITS.steps && project.shots.length <= LIMITS.shots);
  for (const item of project.steps) assert.ok(item.template.length <= LIMITS.template && item.system.length <= LIMITS.system);
  assert.equal(cellStatus(project, project.steps[0], ONCE).status, 'empty');
});
