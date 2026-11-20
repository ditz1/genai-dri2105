import { checkQuota, loadImage, renderImage } from '../../../../lib/studio/cloudflare';
import { IMAGE_MODELS } from '../../../../lib/studio/models';
import { ASPECTS } from '../../../../lib/studio/presets';
import { failure, notFound, ownSheet, readStudioRequest } from '../../../../lib/studio/request';
import { LIMITS, sheetFolder } from '../../../../lib/studio/sheet';

export const maxDuration = 60;

const SIZES = new Set(Object.values(ASPECTS).map(([width, height]) => `${width}x${height}`));

// Renders one image step of a design sheet's chain and stores the file in the sheet's folder. `reference` is the path
// of a style-reference image: the sheet's winning image or another of its renders.
export async function POST(request) {
  const { response, supabase, user, body } = await readStudioRequest(request, 20000);
  if (response) return response;
  const { prompt, model, width, height, seed, reference } = body;
  if (typeof prompt !== 'string' || !prompt.trim()) return Response.json({ error: 'The image prompt is empty.' }, { status: 400 });
  if (prompt.length > LIMITS.imagePrompt) return Response.json({ error: `Image prompts can be at most ${LIMITS.imagePrompt} characters.` }, { status: 400 });
  if (!Object.hasOwn(IMAGE_MODELS, model)) return Response.json({ error: 'Unknown image model.' }, { status: 400 });
  if (IMAGE_MODELS[model].size && !SIZES.has(`${width}x${height}`)) return Response.json({ error: 'Unsupported image size.' }, { status: 400 });
  if (seed !== undefined && !(Number.isInteger(seed) && seed >= 0 && seed < 2 ** 31)) return Response.json({ error: 'Invalid seed.' }, { status: 400 });
  const sheet = await ownSheet(supabase, user, body.sheetId);
  if (!sheet) return notFound();
  try {
    await checkQuota(supabase, user.id, 'image');
    const referenceImage = reference ? { ...await loadImage(supabase, user.id, reference), path: reference } : null;
    const image = await renderImage({
      supabase, userId: user.id, themeId: sheet.theme_id, sheetId: sheet.id, step: String(body.step ?? '').slice(0, 60),
      prompt: prompt.trim(), model, width, height, seed, reference: referenceImage,
    });
    const path = `${sheetFolder(user.id, sheet.id)}/${crypto.randomUUID()}.${image.extension}`;
    const { error } = await supabase.storage.from('generations').upload(path, image.bytes, { contentType: image.contentType });
    if (error) {
      console.error('Failed to store design sheet render:', error.message);
      return Response.json({ error: 'Could not save that image. Try again.' }, { status: 502 });
    }
    return Response.json({ path });
  } catch (error) {
    return failure(error);
  }
}
