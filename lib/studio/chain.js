// The prompt-chain engine behind design sheets. Pure functions only, so the UI, the API routes and the tests share it.
//
// A chain is an ordered list of steps. A step runs once per sheet ("once") or once per portion ("each"), and is
// either a text step (an LLM call whose output becomes the variable {{key}} for later steps) or an image step
// (renders its template into an image prompt). Each output remembers the exact input that produced it, so editing
// any template, setting or upstream output marks everything downstream as stale.
//
// A sheet usually starts from a tournament's winning image (project.source). Its theme and prompt are available to
// every template, text steps can be shown the image itself (step.vision), and renders can use it as a reference.

import { ASPECTS, categoryFraming, PALETTES, STARTER_SHOTS, STYLES, WINNER_SHOTS } from './presets.js';
import { DEFAULT_IMAGE_MODEL, IMAGE_MODELS } from './models.js';

export const ONCE = '_';
// The value of project.image.anchor that means "use the winning image as the style reference".
export const WINNER_ANCHOR = 'winner';
const VAR = /\{\{\s*([a-zA-Z_][\w.]*)\s*\}\}/g;

export const PROJECT_VARS = {
  title: 'Sheet title',
  brief: 'Your world brief or direction',
  styles: 'Selected styles as prompt descriptors',
  styleNotes: 'Your extra style notes',
  palette: 'Palette with names and hex codes',
  paletteNames: 'Palette color names only',
};

export const SOURCE_VARS = {
  theme: 'Title of the tournament theme the winner came from',
  themeDescription: 'Description of that theme',
  winner: 'The prompt that generated the winning image',
};

export const SHOT_VARS = {
  'shot.title': 'Portion title',
  'shot.category': 'Portion category',
  'shot.description': 'Portion description',
  'shot.framing': 'Camera framing for the category',
};

export function newId() {
  return globalThis.crypto.randomUUID().slice(0, 8);
}

export function templateVars(template = '') {
  return [...new Set([...template.matchAll(VAR)].map((match) => match[1]))];
}

export function renderTemplate(template = '', vars) {
  return template.replace(VAR, (_, name) => vars[name] ?? '').replace(/[ \t]+\n/g, '\n').trim();
}

// Image prompts are comma-separated phrases, so an empty variable would leave ", ," behind, and a model's answer
// that ends in a full stop would leave ".," in the middle.
export function tidyImagePrompt(prompt) {
  return prompt.replace(/\.(?=\s*,)/g, '').replace(/\s*,(\s*,)+/g, ',').replace(/^[\s,]+|[\s,]+$/g, '');
}

export function projectVars(project) {
  const styles = project.styles.map((name) => STYLES.find((style) => style.name === name)?.prompt ?? name);
  const source = project.source;
  return {
    title: project.title,
    brief: project.brief,
    styles: styles.join(', '),
    styleNotes: project.styleNotes,
    palette: project.palette.colors.map((color) => `${color.name} (${color.hex})`).join(', '),
    paletteNames: project.palette.colors.map((color) => color.name.toLowerCase()).join(', '),
    ...(source && { theme: source.themeTitle ?? '', themeDescription: source.themeDescription ?? '', winner: source.prompt ?? '' }),
  };
}

function shotVars(shot) {
  return {
    'shot.title': shot.title,
    'shot.category': shot.category,
    'shot.description': shot.description,
    'shot.framing': categoryFraming(shot.category),
  };
}

// Names a step's templates may use: sheet fields, the winner's fields (when the sheet has one), portion fields (for
// per-portion steps), and the keys of earlier text steps. A once step cannot read per-portion outputs because it
// has no single portion to read.
export function availableVars(project, stepIndex) {
  const step = project.steps[stepIndex];
  const names = Object.keys(PROJECT_VARS);
  if (project.source) names.push(...Object.keys(SOURCE_VARS));
  if (step.scope === 'each') names.push(...Object.keys(SHOT_VARS));
  for (const earlier of project.steps.slice(0, stepIndex)) {
    if (earlier.kind === 'text' && (step.scope === 'each' || earlier.scope === 'once')) names.push(earlier.key);
  }
  return names;
}

export function outputOf(project, step, target) {
  return project.outputs[step.id]?.[target];
}

export function targetsOf(project, step) {
  return step.scope === 'once' ? [ONCE] : project.shots.map((shot) => shot.id);
}

export function imageSize(project) {
  const model = IMAGE_MODELS[project.image.model] ?? IMAGE_MODELS[DEFAULT_IMAGE_MODEL];
  if (!model.size) return [1024, 1024];
  return ASPECTS[project.image.aspect] ?? ASPECTS['4:3'];
}

// The style anchor is an image passed to renders as a reference: the winning image, or the portion whose render
// goes to the other portions. Returns WINNER_ANCHOR, a portion id, or null when this cell uses no reference.
export function anchorFor(project, step, target) {
  const model = IMAGE_MODELS[project.image.model];
  const anchor = project.image.anchor;
  if (step.kind !== 'image' || !model?.references || !anchor) return null;
  if (anchor === WINNER_ANCHOR) return project.source?.imagePath ? WINNER_ANCHOR : null;
  if (step.scope !== 'each' || anchor === target) return null;
  if (!project.shots.some((shot) => shot.id === anchor)) return null;
  return anchor;
}

// Everything needed to run one cell (a step for one target), and whether it can run yet.
export function cellInput(project, step, target) {
  const index = project.steps.indexOf(step);
  const allowed = new Set(availableVars(project, index));
  const shot = project.shots.find((item) => item.id === target);
  const vars = { ...projectVars(project), ...(shot && shotVars(shot)) };
  const waiting = [];
  const used = [...templateVars(step.template), ...templateVars(step.system)];
  const deps = [];
  for (const earlier of project.steps.slice(0, index)) {
    if (earlier.kind !== 'text' || !allowed.has(earlier.key)) continue;
    const depTarget = earlier.scope === 'once' ? ONCE : target;
    const output = outputOf(project, earlier, depTarget);
    if (output?.value !== undefined) vars[earlier.key] = output.value;
    if (used.includes(earlier.key)) deps.push([earlier, depTarget]);
  }
  const unknown = used.filter((name) => !allowed.has(name));
  for (const name of used) {
    if (allowed.has(name) && vars[name] === undefined) waiting.push(name);
  }

  const input = step.kind === 'text'
    ? textInput(project, step, vars)
    : imageInput(project, step, target, renderTemplate(step.template, vars), waiting, deps);
  return { input, signature: JSON.stringify(input), unknown, waiting: [...new Set(waiting)], deps };
}

function textInput(project, step, vars) {
  const input = { system: renderTemplate(step.system, vars), prompt: renderTemplate(step.template, vars) };
  // A vision step is shown the winning image alongside its prompt.
  if (step.vision && project.source?.imagePath) input.image = project.source.imagePath;
  return input;
}

// Prepended when a style anchor is used. FLUX.2 treats reference images as something to edit, so without
// this the other portions come out as copies of the anchor.
export const REFERENCE_PREFIX = 'Style reference: image 1 (use its rendering style and colors only). New, unrelated content: ';

function imageInput(project, step, target, prompt, waiting, deps) {
  const model = IMAGE_MODELS[project.image.model] ? project.image.model : DEFAULT_IMAGE_MODEL;
  const [width, height] = imageSize(project);
  const input = { prompt: tidyImagePrompt(prompt), model, width, height };
  if (IMAGE_MODELS[model].seed && project.image.lockSeed) input.seed = project.image.seed;
  const anchor = anchorFor(project, step, target);
  if (anchor === WINNER_ANCHOR) {
    input.prompt = REFERENCE_PREFIX + input.prompt;
    input.reference = project.source.imagePath;
  } else if (anchor) {
    const anchorOutput = outputOf(project, step, anchor);
    if (anchorOutput?.imagePath) {
      input.prompt = REFERENCE_PREFIX + input.prompt;
      input.reference = anchorOutput.imagePath;
    } else waiting.push('style anchor image');
    deps.push([step, anchor]);
  }
  return input;
}

// empty: never run · done: output matches its current input · stale: inputs changed since it ran ·
// blocked: an upstream output is missing · invalid: the template uses a variable that does not exist here.
export function cellStatus(project, step, target) {
  const cell = cellInput(project, step, target);
  const output = outputOf(project, step, target);
  let status = 'done';
  if (cell.unknown.length) status = 'invalid';
  else if (cell.waiting.length) status = 'blocked';
  else if (!output) status = 'empty';
  else if (output.signature !== cell.signature) status = 'stale';
  // An output is also out of date when anything it was built from is, even if that text hasn't changed yet.
  else if (cell.deps.some(([dep, depTarget]) => cellStatus(project, dep, depTarget).status !== 'done')) status = 'stale';
  return { ...cell, output, status };
}

// The cells to visit, grouped by step in chain order. Within an image step a portion used as the style anchor comes
// first, because the other portions use its render. Whether a cell actually runs is decided when it is reached
// (see shouldRun), since upstream cells earlier in the same run change what is ready.
export function plan(project, { onlyTarget, onlyStep } = {}) {
  const groups = [];
  for (const step of project.steps) {
    if (onlyStep && step.id !== onlyStep) continue;
    let targets = targetsOf(project, step);
    if (onlyTarget) targets = targets.filter((target) => target === onlyTarget || target === ONCE);
    const anchor = portionAnchorOf(project, step);
    targets.sort((a, b) => (b === anchor) - (a === anchor));
    if (!targets.length) continue;
    if (anchor && targets[0] === anchor) groups.push({ stepId: step.id, targets: [anchor] }, { stepId: step.id, targets: targets.slice(1) });
    else groups.push({ stepId: step.id, targets });
  }
  return groups.filter((group) => group.targets.length);
}

function portionAnchorOf(project, step) {
  if (project.image.anchor === WINNER_ANCHOR) return null;
  const other = project.shots.find((shot) => shot.id !== project.image.anchor);
  return other && anchorFor(project, step, other.id);
}

export function shouldRun(status, force) {
  if (status === 'invalid' || status === 'blocked') return false;
  return force || status !== 'done';
}

// When a step key changes, references to it in later templates follow.
export function renameKey(steps, from, to) {
  const pattern = new RegExp(`\\{\\{\\s*${from.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\}\\}`, 'g');
  return steps.map((step) => ({
    ...step,
    key: step.key === from ? to : step.key,
    template: step.template.replace(pattern, `{{${to}}}`),
    system: step.system?.replace(pattern, `{{${to}}}`),
  }));
}

export function cleanModelText(text) {
  return String(text ?? '')
    .trim()
    .replace(/^(here(?:'s| is) [^\n:]*:\s*)/i, '')
    .replace(/^["“](.*)["”]$/s, '$1')
    .trim();
}

export function imagePaths(project) {
  return Object.values(project.outputs).flatMap((cells) => Object.values(cells)).map((output) => output.imagePath).filter(Boolean);
}

// The image model has never heard the names a design pass invents, so the prompt has to say what things look like.
const IMAGE_PROMPT_RULES = 'Write one text-to-image prompt of 50 to 80 words as comma-separated phrases. Start with the subject in plain visual words: what it is and its three or four most distinctive features from the design. Never refer to it by an invented name. Then the composition, then the rendering style and lighting, then the palette colors by name. Do not ask for any text, labels, captions or watermarks.';

// The chain for a sheet started from scratch: the brief is the world.
function blankSteps() {
  return [
    {
      id: newId(), key: 'artDirection', name: 'Art direction', scope: 'once', kind: 'text',
      system: 'You are the lead concept artist on a video game. You write clear, visual, specific art direction.',
      template: `Project: {{title}}
World brief: {{brief}}
Rendering style: {{styles}}
Extra style notes: {{styleNotes}}
Color palette: {{palette}}

Write the art direction that every image in this project must follow, in at most 120 words of plain prose (no headings or lists): shape language, materials and surface treatment, lighting, rendering technique, and exactly how the palette is used (dominant, secondary and accent colors, by name).`,
    },
    {
      id: newId(), key: 'design', name: 'Design pass', scope: 'each', kind: 'text',
      system: 'You are a game concept artist designing one asset for a larger set. Stay inside the art direction.',
      template: `Art direction:
{{artDirection}}

World brief: {{brief}}

Design this {{shot.category}}: "{{shot.title}}" — {{shot.description}}

In 2-3 sentences, describe its key visual design: silhouette, distinctive features, materials, and pose or composition.`,
    },
    {
      id: newId(), key: 'imagePrompt', name: 'Image prompt', scope: 'each', kind: 'text',
      system: 'You write prompts for a text-to-image model. You output only the prompt itself.',
      template: `${IMAGE_PROMPT_RULES}

Framing: {{shot.framing}}
Design: {{design}}
Rendering style: {{styles}}
Palette: {{paletteNames}}
Art direction: {{artDirection}}`,
    },
    {
      id: newId(), key: 'render', name: 'Render', scope: 'each', kind: 'image', system: '',
      template: '{{imagePrompt}}, {{styles}}, color palette of {{paletteNames}}, professional concept art, no text',
    },
  ];
}

// The chain for a sheet grown from a tournament winner: read the image's style, imagine the world around it, then
// design and render every portion inside that world.
function winnerSteps() {
  return [
    {
      id: newId(), key: 'winnerStyle', name: 'Read the winner', scope: 'once', kind: 'text', vision: true,
      system: 'You are an art director studying a reference image. You answer with one line only.',
      template: `This image won the "{{theme}}" tournament. It was generated from the prompt: "{{winner}}"

Describe its visual style as one line of 8 to 12 short comma-separated descriptors and nothing else: the medium and rendering technique, shape and line language, texture, lighting, mood. Do not repeat a descriptor. Describe the style only, not the subject, and do not mention any text or lettering. If no image is attached, infer the style from the prompt.`,
    },
    {
      id: newId(), key: 'world', name: 'World', scope: 'once', kind: 'text',
      system: 'You are a game world designer. You write concrete, visual world briefs.',
      template: `Tournament theme: {{theme}} — {{themeDescription}}
The winning image shows: {{winner}}
Its visual style: {{winnerStyle}}
Direction from the creator (may be empty): {{brief}}

Treat the winning image as one moment in a larger world. In at most 90 words of plain prose, describe that world for a game: the setting and era, who and what lives there, the mood, and what the player does. Stay faithful to the image and the theme.`,
    },
    {
      id: newId(), key: 'artDirection', name: 'Art direction', scope: 'once', kind: 'text',
      system: 'You are the lead concept artist on a video game. You write clear, visual, specific art direction.',
      template: `Project: {{title}}
World: {{world}}
Style of the winning image: {{winnerStyle}}
Extra rendering styles (may be empty): {{styles}}
Extra style notes (may be empty): {{styleNotes}}
Color palette, taken from the winning image: {{palette}}

Write the art direction that every image in this project must follow so the set looks like it belongs with the winning image, in at most 120 words of plain prose (no headings or lists): shape language, materials and surface treatment, lighting, rendering technique, and exactly how the palette is used (dominant, secondary and accent colors, by name).`,
    },
    {
      id: newId(), key: 'design', name: 'Design pass', scope: 'each', kind: 'text',
      system: 'You are a game concept artist designing one asset for a larger set. Stay inside the art direction and the world.',
      template: `Art direction:
{{artDirection}}

World: {{world}}

Design this {{shot.category}}: "{{shot.title}}" — {{shot.description}}

In 2-3 sentences, describe its key visual design: what it is in this world, its silhouette, distinctive features, materials, and pose or composition.`,
    },
    {
      id: newId(), key: 'imagePrompt', name: 'Image prompt', scope: 'each', kind: 'text',
      system: 'You write prompts for a text-to-image model. You output only the prompt itself.',
      template: `${IMAGE_PROMPT_RULES}

Framing: {{shot.framing}}
Design: {{design}}
Rendering style: {{winnerStyle}}, {{styles}}
Palette: {{paletteNames}}
Art direction: {{artDirection}}`,
    },
    {
      id: newId(), key: 'render', name: 'Render', scope: 'each', kind: 'image', system: '',
      template: '{{imagePrompt}}, {{winnerStyle}}, {{styles}}, color palette of {{paletteNames}}, professional concept art, no text',
    },
  ];
}

export function defaultSteps(source) {
  return source ? winnerSteps() : blankSteps();
}

export function newStep(kind, scope) {
  return {
    id: newId(), key: kind === 'image' ? 'render' : 'notes', name: kind === 'image' ? 'Render' : 'New step',
    scope, kind, system: '', template: kind === 'image' ? '{{styles}}, color palette of {{paletteNames}}' : '',
  };
}

export function starterShots(source) {
  return (source ? WINNER_SHOTS : STARTER_SHOTS).map((shot) => ({ id: newId(), ...shot }));
}

// A new sheet. With `source` (a tournament's winning image), the title comes from its theme, the style is left for
// the chain to read from the image, and the palette is marked to be taken from the image when the sheet first opens.
export function newProject(source = null) {
  const palette = PALETTES[0];
  const colors = palette.colors.map(([name, hex]) => ({ name, hex }));
  const image = { model: DEFAULT_IMAGE_MODEL, aspect: '4:3', lockSeed: true, seed: 1234, anchor: null };
  const base = { image, shots: starterShots(source), steps: defaultSteps(source), outputs: {} };
  if (source) {
    return {
      title: String(source.themeTitle || 'Untitled').slice(0, 120), brief: '', source,
      palette: { name: palette.name, colors, pending: true },
      styles: [], styleNotes: '', ...base,
    };
  }
  return {
    title: 'Untitled adventure',
    brief: 'A bright fantasy adventure game set in a small kingdom of meadows, forests and old ruins, where a young hero explores, solves puzzles and fights monsters.',
    source: null,
    palette: { name: palette.name, colors },
    styles: ['Hand-painted'],
    styleNotes: 'Readable, chunky silhouettes and slightly exaggerated proportions, like a classic adventure game.',
    ...base,
  };
}
