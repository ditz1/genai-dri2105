import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableVars, cellStatus, cleanModelText, newProject, ONCE, plan, renameKey, shouldRun, tidyImagePrompt, WINNER_ANCHOR,
} from '../lib/studio/chain.js';

const step = (project, key) => project.steps.find((item) => item.key === key);
const winner = {
  themeId: 12, themeTitle: 'Enchanted Terrariums', themeDescription: 'Whole worlds under glass.', postId: 'post-1',
  authorId: 'user-1', author: 'Ada Lovelace', prompt: 'a tiny robot tending orchids in a glass dome', caption: null,
  model: '@cf/black-forest-labs/flux-1-schnell', imagePath: '11111111-2222-3333-4444-555555555555/winner.jpg',
};
// Marks every text step before `until` as run, the way the studio does after each model call.
function fill(project, until) {
  for (const item of project.steps) {
    if (item.key === until) return;
    const targets = item.scope === 'once' ? [ONCE] : project.shots.map((shot) => shot.id);
    project.outputs[item.id] = Object.fromEntries(targets.map((target) => [target, { value: `${item.key} text`, signature: cellStatus(project, item, target).signature }]));
  }
}

test('a fresh project starts with art direction ready and everything downstream waiting', () => {
  const project = newProject();
  assert.equal(cellStatus(project, step(project, 'artDirection'), ONCE).status, 'empty');
  const shot = project.shots[1].id;
  const design = cellStatus(project, step(project, 'design'), shot);
  assert.equal(design.status, 'blocked');
  assert.deepEqual(design.waiting, ['artDirection']);
});

test('outputs feed later steps and editing them makes downstream stale', () => {
  const project = newProject();
  const art = step(project, 'artDirection');
  const design = step(project, 'design');
  const shot = project.shots[1].id;
  project.outputs[art.id] = { [ONCE]: { value: 'Chunky shapes.', signature: cellStatus(project, art, ONCE).signature } };
  const ready = cellStatus(project, design, shot);
  assert.equal(ready.status, 'empty');
  assert.match(ready.input.prompt, /Chunky shapes\./);
  assert.match(ready.input.prompt, /"House"/);
  project.outputs[design.id] = { [shot]: { value: 'A keeper.', signature: ready.signature } };
  assert.equal(cellStatus(project, design, shot).status, 'done');
  project.outputs[art.id][ONCE].value = 'Spiky shapes.';
  assert.equal(cellStatus(project, design, shot).status, 'stale');
  assert.equal(cellStatus(project, art, ONCE).status, 'done');
});

test('once steps cannot read per-portion outputs or portion fields', () => {
  const project = newProject();
  project.steps.push({ id: 'x', key: 'summary', name: 'Summary', scope: 'once', kind: 'text', system: '', template: '{{design}} {{shot.title}}' });
  const vars = availableVars(project, project.steps.length - 1);
  assert.ok(vars.includes('artDirection'));
  assert.ok(!vars.includes('design'));
  assert.equal(cellStatus(project, project.steps.at(-1), ONCE).status, 'invalid');
});

test('image renders wait for a portion used as the style anchor and include it in their input', () => {
  const project = newProject();
  project.image.anchor = project.shots[0].id;
  const render = step(project, 'render');
  const [anchor, other] = project.shots.map((shot) => shot.id);
  fill(project, 'render');
  assert.equal(cellStatus(project, render, anchor).status, 'empty');
  assert.deepEqual(cellStatus(project, render, other).waiting, ['style anchor image']);
  project.outputs[render.id] = { [anchor]: { imagePath: 'me/studio/sheet/a.jpg', signature: cellStatus(project, render, anchor).signature } };
  const cell = cellStatus(project, render, other);
  assert.equal(cell.status, 'empty');
  assert.equal(cell.input.reference, 'me/studio/sheet/a.jpg');
  assert.equal(cell.input.seed, 1234);
  assert.match(cell.input.prompt, /^Style reference: .*imagePrompt text, /);

  const groups = plan(project, { onlyStep: render.id });
  assert.deepEqual(groups[0].targets, [anchor]);
  assert.equal(groups[1].targets.length, project.shots.length - 1);
});

test('portions get framing for their category, including retired category names', () => {
  const project = newProject();
  project.outputs[step(project, 'artDirection').id] = { [ONCE]: { value: 'x', signature: '' } };
  project.shots[0].category = 'Prop';
  assert.match(cellStatus(project, step(project, 'imagePrompt'), project.shots[0].id).input.prompt, /single item or collectible concept/);
});

test('renaming a step key updates later templates', () => {
  const project = newProject();
  const steps = renameKey(project.steps, 'design', 'look');
  assert.equal(steps[1].key, 'look');
  assert.match(steps[2].template, /\{\{look\}\}/);
  assert.doesNotMatch(steps[2].template, /\{\{design\}\}/);
});

test('model text is cleaned and run rules skip finished cells unless forced', () => {
  assert.equal(cleanModelText('Here is the prompt:\n"a fox, low poly"'), 'a fox, low poly');
  assert.equal(shouldRun('done', false), false);
  assert.equal(shouldRun('done', true), true);
  assert.equal(shouldRun('blocked', true), false);
  assert.equal(shouldRun('stale', false), true);
});

test('editing an early output marks every later step stale, not just the next one', () => {
  const project = newProject();
  const shot = project.shots[0].id;
  for (const key of ['artDirection', 'design', 'imagePrompt', 'render']) {
    const item = step(project, key);
    const target = item.scope === 'once' ? ONCE : shot;
    const cell = cellStatus(project, item, target);
    project.outputs[item.id] = { [target]: item.kind === 'text' ? { value: `${key} text`, signature: cell.signature } : { imagePath: 'img', signature: cell.signature } };
  }
  assert.equal(cellStatus(project, step(project, 'render'), shot).status, 'done');
  project.outputs[step(project, 'artDirection').id][ONCE].value = 'changed';
  assert.equal(cellStatus(project, step(project, 'render'), shot).status, 'stale');
});

test('a sheet grown from a winner takes its title, theme and prompt from it and waits to read its palette', () => {
  const project = newProject(winner);
  assert.equal(project.title, 'Enchanted Terrariums');
  assert.equal(project.source.postId, 'post-1');
  assert.equal(project.palette.pending, true);
  assert.deepEqual(project.styles, []);
  assert.deepEqual(project.steps.map((item) => item.key), ['winnerStyle', 'world', 'artDirection', 'design', 'imagePrompt', 'render']);
  assert.ok(project.shots.some((shot) => shot.category === 'Character') && project.shots.some((shot) => shot.category === 'Environment'));
});

test("the first step is shown the winning image and is the only one that can run at the start", () => {
  const project = newProject(winner);
  const read = cellStatus(project, step(project, 'winnerStyle'), ONCE);
  assert.equal(read.status, 'empty');
  assert.equal(read.input.image, winner.imagePath);
  assert.match(read.input.prompt, /won the "Enchanted Terrariums" tournament/);
  assert.match(read.input.prompt, /a tiny robot tending orchids/);
  assert.deepEqual(cellStatus(project, step(project, 'world'), ONCE).waiting, ['winnerStyle']);

  // Untick "sees the winning image" and the step falls back to the prompt alone, which changes its input.
  step(project, 'winnerStyle').vision = false;
  const blind = cellStatus(project, step(project, 'winnerStyle'), ONCE);
  assert.equal(blind.input.image, undefined);
  assert.notEqual(blind.signature, read.signature);
});

test("the winner's style and world reach every portion's design and render", () => {
  const project = newProject(winner);
  fill(project, 'design');
  const shot = project.shots[0].id;
  const design = cellStatus(project, step(project, 'design'), shot);
  assert.equal(design.status, 'empty');
  assert.match(design.input.prompt, /World: world text/);
  fill(project, 'render');
  const render = cellStatus(project, step(project, 'render'), shot);
  // No extra styles are selected, so the prompt must not be left with an empty ", ," where they would go.
  assert.equal(render.input.prompt, 'imagePrompt text, winnerStyle text, color palette of meadow green, sky blue, warm stone, roof red, hero gold, professional concept art, no text');
  assert.equal(render.input.reference, undefined);

  // Changing what the chain read from the winner makes every render out of date.
  project.outputs[step(project, 'render').id] = { [shot]: { imagePath: 'img', signature: render.signature } };
  assert.equal(cellStatus(project, step(project, 'render'), shot).status, 'done');
  project.outputs[step(project, 'winnerStyle').id][ONCE].value = 'flat vector poster';
  assert.equal(cellStatus(project, step(project, 'render'), shot).status, 'stale');
});

test('the winning image can be the style anchor for every render without any portion going first', () => {
  const project = newProject(winner);
  project.image.anchor = WINNER_ANCHOR;
  fill(project, 'render');
  const render = step(project, 'render');
  for (const shot of project.shots) {
    const cell = cellStatus(project, render, shot.id);
    assert.equal(cell.status, 'empty');
    assert.equal(cell.input.reference, winner.imagePath);
    assert.match(cell.input.prompt, /^Style reference: /);
  }
  assert.equal(plan(project, { onlyStep: render.id }).length, 1);

  // FLUX.1 schnell takes no reference images, and a blank sheet has no winner to use.
  project.image.model = 'flux-1-schnell';
  assert.equal(cellStatus(project, render, project.shots[0].id).input.reference, undefined);
  const blank = newProject();
  blank.image.anchor = WINNER_ANCHOR;
  fill(blank, 'render');
  assert.equal(cellStatus(blank, step(blank, 'render'), blank.shots[0].id).input.reference, undefined);
});

test('winner variables only exist on sheets that have a winner', () => {
  assert.ok(availableVars(newProject(winner), 0).includes('winner'));
  const blank = newProject();
  assert.ok(!availableVars(blank, 0).includes('winner'));
  blank.steps[0].template += ' {{winner}}';
  assert.equal(cellStatus(blank, blank.steps[0], ONCE).status, 'invalid');
});

test('image prompts drop the gaps left by empty variables', () => {
  assert.equal(tidyImagePrompt('a fox, , low poly,  , no text'), 'a fox, low poly, no text');
  assert.equal(tidyImagePrompt(', a fox, '), 'a fox');
  assert.equal(tidyImagePrompt('a fox in a meadow., flat vector., no text'), 'a fox in a meadow, flat vector, no text');
});
