// Limits and checks for design sheets, shared by the browser (to stop at a limit) and the server (to enforce it).
import { IMAGE_MODELS } from './models.js';
import { ASPECTS } from './presets.js';
import { supabaseUrl } from '../supabase/env.js';

export const LIMITS = {
  sheets: 30,          // per member; also enforced by a trigger in the database
  shots: 12,
  steps: 10,
  colors: 8,
  styles: 12,
  title: 120,
  brief: 2000,
  styleNotes: 1000,
  shotTitle: 80,
  shotDescription: 600,
  stepName: 60,
  system: 2000,
  template: 4000,
  output: 6000,
  imagePrompt: 2048,
  bytes: 380000,       // the whole sheet as JSON; the table allows 400,000
  // Generation runs on a free daily allowance shared with the rest of the site, so each member gets a slice of it.
  dailyRenders: 30,
  dailyTextSteps: 120,
};

// Rendered images live in the public "generations" bucket, in the member's folder, grouped by sheet.
export const sheetFolder = (userId, sheetId) => `${userId}/studio/${sheetId}`;
export const publicImageUrl = (path) => `${supabaseUrl}/storage/v1/object/public/generations/${path}`;
export const isUuid = (value) => typeof value === 'string' && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value);
// What a path inside the bucket looks like: a member's folder, optional subfolders, and an image file.
export const isImagePath = (value) => typeof value === 'string' && value.length <= 200
  && /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}(\/[\w-]+)+\.(jpg|jpeg|png|webp)$/i.test(value);

class SheetError extends Error {}

function text(value, max, label) {
  if (typeof value !== 'string') throw new SheetError(`${label} is missing.`);
  if (value.length > max) throw new SheetError(`${label} can be at most ${max} characters.`);
  return value;
}

function list(value, max, label) {
  if (!Array.isArray(value)) throw new SheetError(`${label} are missing.`);
  if (value.length > max) throw new SheetError(`A sheet can have at most ${max} ${label.toLowerCase()}.`);
  return value;
}

const id = (value) => {
  if (typeof value !== 'string' || !/^[\w-]{1,40}$/.test(value)) throw new SheetError('The sheet has an invalid id.');
  return value;
};

// Returns a clean copy of a sheet sent by the browser, keeping only known fields, or throws with a message that can
// be shown to the member. Rendered images must sit in this sheet's own folder. The winner a sheet started from is
// set by the server when the sheet is created and never taken from the browser, so `source` is passed in.
export function sanitizeSheet(input, { userId, sheetId, source = null }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new SheetError('The sheet could not be read.');
  const palette = input.palette ?? {};
  const colors = list(palette.colors, LIMITS.colors, 'Colors').map((color) => {
    if (!/^#[0-9a-f]{6}$/i.test(color?.hex ?? '')) throw new SheetError('A palette color is not a valid hex code.');
    return { name: text(color.name, 40, 'A color name'), hex: color.hex.toLowerCase() };
  });
  if (!colors.length) throw new SheetError('The palette needs at least one color.');

  const image = input.image ?? {};
  if (!Object.hasOwn(IMAGE_MODELS, image.model)) throw new SheetError('Unknown image model.');
  if (!Object.hasOwn(ASPECTS, image.aspect)) throw new SheetError('Unknown aspect ratio.');
  if (!Number.isInteger(image.seed) || image.seed < 0 || image.seed >= 2 ** 31) throw new SheetError('Invalid seed.');

  const shots = list(input.shots, LIMITS.shots, 'Portions').map((shot) => ({
    id: id(shot?.id), category: text(shot.category, 40, 'A portion category'),
    title: text(shot.title, LIMITS.shotTitle, 'A portion title'),
    description: text(shot.description, LIMITS.shotDescription, 'A portion description'),
  }));

  const steps = list(input.steps, LIMITS.steps, 'Steps').map((step) => {
    if (!['text', 'image'].includes(step?.kind) || !['once', 'each'].includes(step.scope)) throw new SheetError('A step has an invalid type.');
    if (typeof step.key !== 'string' || !/^[A-Za-z_]\w{0,39}$/.test(step.key)) throw new SheetError('A step has an invalid variable name.');
    return {
      id: id(step.id), key: step.key, name: text(step.name, LIMITS.stepName, 'A step name'), scope: step.scope, kind: step.kind,
      system: text(step.system ?? '', LIMITS.system, 'A system prompt'), template: text(step.template, LIMITS.template, 'A template'),
      ...(step.kind === 'text' && step.vision === true && { vision: true }),
    };
  });
  if (new Set(steps.map((step) => step.id)).size !== steps.length || new Set(shots.map((shot) => shot.id)).size !== shots.length) {
    throw new SheetError('The sheet has duplicate ids.');
  }

  // Outputs of steps or portions that no longer exist are dropped.
  const folder = `${sheetFolder(userId, sheetId)}/`;
  const outputs = {};
  for (const step of steps) {
    const cells = input.outputs?.[step.id];
    if (!cells || typeof cells !== 'object') continue;
    const targets = step.scope === 'once' ? ['_'] : shots.map((shot) => shot.id);
    for (const target of targets) {
      const output = cells[target];
      if (!output || typeof output !== 'object') continue;
      const common = { signature: text(output.signature ?? '', 30000, 'An output'), at: Number(output.at) || 0 };
      if (step.kind === 'text') {
        if (typeof output.value !== 'string') continue;
        (outputs[step.id] ??= {})[target] = { value: text(output.value, LIMITS.output, 'An output'), ...common, ...(output.edited === true && { edited: true }) };
      } else {
        if (!isImagePath(output.imagePath) || !output.imagePath.startsWith(folder)) continue;
        (outputs[step.id] ??= {})[target] = {
          imagePath: output.imagePath, seed: Number.isInteger(output.seed) ? output.seed : null,
          prompt: text(output.prompt ?? '', LIMITS.imagePrompt + 200, 'An image prompt'), ...common,
        };
      }
    }
  }

  const anchor = image.anchor === 'winner' ? (source ? 'winner' : null) : shots.some((shot) => shot.id === image.anchor) ? image.anchor : null;
  const data = {
    title: text(input.title, LIMITS.title, 'The title'),
    brief: text(input.brief, LIMITS.brief, 'The brief'),
    source,
    palette: { name: text(palette.name ?? 'Custom', 60, 'The palette name'), colors, ...(palette.pending === true && source && { pending: true }) },
    styles: list(input.styles, LIMITS.styles, 'Styles').map((style) => text(style, 60, 'A style')),
    styleNotes: text(input.styleNotes, LIMITS.styleNotes, 'The style notes'),
    image: { model: image.model, aspect: image.aspect, lockSeed: image.lockSeed === true, seed: image.seed, anchor },
    shots, steps, outputs,
  };
  if (JSON.stringify(data).length > LIMITS.bytes) throw new SheetError('This sheet has grown too large to save. Shorten some templates or outputs.');
  return data;
}

export const isSheetError = (error) => error instanceof SheetError;

// What the list of sheets shows without loading each whole sheet: a cover image and how far along it is.
export function summarize(data) {
  const step = data.steps.findLast((item) => item.kind === 'image' && item.scope === 'each');
  const renders = step ? data.shots.map((shot) => data.outputs[step.id]?.[shot.id]?.imagePath).filter(Boolean) : [];
  return { cover: renders[0] ?? null, renders: renders.length, portions: data.shots.length };
}
