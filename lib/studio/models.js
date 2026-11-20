// Workers AI models used by the design-sheet studio. Shared by the UI (to show what each image model supports) and
// the API routes. Text steps use TEXT_MODEL; steps that look at the winning image use VISION_MODEL.

export const TEXT_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
export const VISION_MODEL = '@cf/mistralai/mistral-small-3.1-24b-instruct';

export const IMAGE_MODELS = {
  'flux-2-klein-4b': {
    label: 'FLUX.2 klein 4B',
    note: 'Fast. Supports seeds, sizes and a style-reference image.',
    id: '@cf/black-forest-labs/flux-2-klein-4b',
    multipart: true, seed: true, size: true, references: 4,
  },
  'flux-2-klein-9b': {
    label: 'FLUX.2 klein 9B',
    note: 'Higher quality, uses more of the daily free allowance.',
    id: '@cf/black-forest-labs/flux-2-klein-9b',
    multipart: true, seed: true, size: true, references: 4,
  },
  'flux-1-schnell': {
    label: 'FLUX.1 schnell',
    note: 'The model behind most tournament entries. Square images only, no seed or references.',
    id: '@cf/black-forest-labs/flux-1-schnell',
    multipart: false, seed: false, size: false, references: 0,
  },
};

export const DEFAULT_IMAGE_MODEL = 'flux-2-klein-4b';
