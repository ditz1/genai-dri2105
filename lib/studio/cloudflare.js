// Server-only Workers AI calls for design-sheet steps. They use the same Cloudflare credentials as the rest of the
// site, are recorded in the admin's generation history like every other request, and count toward a daily allowance.
import { runGeneration } from '../generation.js';
import { IMAGE_MODELS, TEXT_MODEL, VISION_MODEL } from './models.js';
import { isImagePath, LIMITS, publicImageUrl } from './sheet.js';

const provider = 'Cloudflare Workers AI';
const maxImageBytes = 10485760;

export class QuotaError extends Error {}

async function run(model, body, headers = {}) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
  const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
  if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set.');
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, ...headers },
    body,
    cache: 'no-store',
    signal: AbortSignal.timeout(55000),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok || json?.success === false) {
    throw new Error(json?.errors?.[0]?.message ?? `Workers AI responded with ${response.status}.`);
  }
  return json?.result;
}

// Studio requests from the last 24 hours that did not fail, counted from the member's own generation history.
export async function checkQuota(supabase, userId, kind) {
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { count, error } = await supabase
    .from('generation_requests')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('kind', kind)
    .eq('input->>source', 'studio')
    .neq('status', 'failed')
    .gte('created_at', since);
  if (error) throw new Error('Could not check your daily allowance. Try again.');
  const limit = kind === 'image' ? LIMITS.dailyRenders : LIMITS.dailyTextSteps;
  if (count >= limit) {
    throw new QuotaError(`You have used today's ${limit} ${kind === 'image' ? 'design-sheet renders' : 'design-sheet text steps'}. Try again tomorrow.`);
  }
}

// An image a step may be shown: one of the member's own files, or any image that has been posted (those are public).
export async function loadImage(supabase, userId, path) {
  const unavailable = 'That reference image is no longer available.';
  if (!isImagePath(path)) throw new Error(unavailable);
  if (!path.startsWith(`${userId}/`)) {
    const { data } = await supabase.from('posts').select('id').eq('image_path', path).not('posted_at', 'is', null).maybeSingle();
    if (!data) throw new Error(unavailable);
  }
  const response = await fetch(publicImageUrl(path), { cache: 'no-store', signal: AbortSignal.timeout(15000) });
  const contentType = response.headers.get('content-type')?.split(';')[0];
  if (!response.ok || !['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) throw new Error(unavailable);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (!bytes.length || bytes.length > maxImageBytes) throw new Error(unavailable);
  return { bytes, contentType };
}

// One text step. `image` ({ bytes, contentType }) is shown to a vision model along with the prompt.
export async function runTextStep({ supabase, userId, themeId, sheetId, step, system, prompt, image }) {
  const model = image
    ? process.env.CLOUDFLARE_VISION_MODEL?.trim() || VISION_MODEL
    : process.env.CLOUDFLARE_TEXT_MODEL?.trim() || TEXT_MODEL;
  // Reading an image should give a steady answer; the writing steps are allowed more range.
  const parameters = { max_tokens: 400, temperature: image ? 0.3 : 0.7 };
  const config = { model, provider, input: { source: 'studio', sheet: sheetId, step, system, parameters, vision: Boolean(image) } };
  return runGeneration({ supabase, kind: 'text', prompt, userId, themeId, config }, async () => {
    const content = image
      ? [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: `data:${image.contentType};base64,${image.bytes.toString('base64')}` } }]
      : prompt;
    const messages = [...(system ? [{ role: 'system', content: system }] : []), { role: 'user', content }];
    const result = await run(model, JSON.stringify({ messages, ...parameters }), { 'Content-Type': 'application/json' });
    // Older models answer with `response`; newer ones use the OpenAI chat-completion shape.
    const text = result?.response ?? result?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('The text model returned an empty response.');
    return { text, audit: { text, usage: result?.usage ?? null } };
  });
}

// One render. `reference` ({ bytes, contentType, path }) is passed to FLUX.2 as a style reference.
export async function renderImage({ supabase, userId, themeId, sheetId, step, prompt, model: modelKey, width, height, seed, reference }) {
  const model = IMAGE_MODELS[modelKey];
  if (!model) throw new Error('Unknown image model.');
  const useReference = Boolean(reference && model.references);
  const config = { model: model.id, provider, input: {
    source: 'studio', sheet: sheetId, step, output_format: 'image-base64',
    parameters: model.multipart ? { width, height, seed } : { steps: 6 }, reference: useReference ? reference.path : null,
  } };
  return runGeneration({ supabase, kind: 'image', prompt, userId, themeId, config }, async () => {
    let result;
    if (model.multipart) {
      const form = new FormData();
      form.append('prompt', prompt);
      form.append('width', String(width));
      form.append('height', String(height));
      if (Number.isInteger(seed)) form.append('seed', String(seed));
      if (useReference) form.append('input_image_0', new Blob([reference.bytes], { type: reference.contentType }), 'reference-0');
      result = await run(model.id, form);
    } else {
      result = await run(model.id, JSON.stringify({ prompt, steps: 6 }), { 'Content-Type': 'application/json' });
    }
    if (typeof result?.image !== 'string' || !result.image) throw new Error('The image model did not return an image.');
    const bytes = Buffer.from(result.image, 'base64');
    if (!bytes.length || bytes.length > maxImageBytes) throw new Error('Workers AI returned an invalid image size.');
    return { bytes, contentType: 'image/jpeg', extension: 'jpg', audit: { content_type: 'image/jpeg', byte_length: bytes.length, usage: result.usage ?? null } };
  });
}
