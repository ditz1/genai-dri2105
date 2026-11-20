import { checkQuota, loadImage, runTextStep } from '../../../../lib/studio/cloudflare';
import { failure, notFound, ownSheet, readStudioRequest } from '../../../../lib/studio/request';

export const maxDuration = 60;

// Runs one text step of a design sheet's chain. With `image`, the step is shown that image (the sheet's winner).
export async function POST(request) {
  const { response, supabase, user, body } = await readStudioRequest(request, 60000);
  if (response) return response;
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim() : '';
  const system = typeof body.system === 'string' ? body.system.trim() : '';
  if (!prompt) return Response.json({ error: 'The prompt is empty.' }, { status: 400 });
  if (prompt.length + system.length > 16000) return Response.json({ error: 'The prompt is too long.' }, { status: 400 });
  const sheet = await ownSheet(supabase, user, body.sheetId);
  if (!sheet) return notFound();
  try {
    await checkQuota(supabase, user.id, 'text');
    const image = body.image ? await loadImage(supabase, user.id, body.image) : null;
    const { text } = await runTextStep({
      supabase, userId: user.id, themeId: sheet.theme_id, sheetId: sheet.id,
      step: String(body.step ?? '').slice(0, 60), system, prompt, image,
    });
    return Response.json({ text });
  } catch (error) {
    return failure(error);
  }
}
