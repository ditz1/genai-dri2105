// Text-to-image through Cloudflare Workers AI, whose free daily allowance covers this model.
import { defaultImageModel, runGeneration } from './generation.js';
export const imageModel = defaultImageModel;

export async function generateImage(prompt, context = {}) {
  return runGeneration({ ...context, kind: 'image', prompt }, async (config) => {
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set.');

    const finalPrompt = [config.instructions, prompt].filter(Boolean).join('\n');
    const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${config.model}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      cache: 'no-store',
      body: JSON.stringify({ ...config.parameters, prompt: finalPrompt }),
      signal: AbortSignal.timeout(45000),
    });
    if (response.ok && config.outputFormat === 'image-binary') {
      const contentType = response.headers.get('content-type')?.split(';')[0];
      if (!['image/png', 'image/jpeg', 'image/webp'].includes(contentType)) throw new Error('Workers AI did not return an image.');
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!bytes.length || bytes.length > 10485760) throw new Error('Workers AI returned an invalid image size.');
      return { bytes, contentType, extension: contentType === 'image/jpeg' ? 'jpg' : contentType.split('/')[1],
        audit: { content_type: contentType, byte_length: bytes.length } };
    }
    const body = await response.json().catch(() => null);
    // The image comes back as a base64-encoded JPEG.
    const image = body?.result?.image;
    if (!response.ok || body?.success === false || !image) throw new Error(body?.errors?.[0]?.message ?? `Workers AI responded with ${response.status}.`);
    const bytes = Buffer.from(image, 'base64');
    if (!bytes.length || bytes.length > 10485760) throw new Error('Workers AI returned an invalid image size.');
    return { bytes, contentType: 'image/jpeg', extension: 'jpg',
      audit: { content_type: 'image/jpeg', byte_length: bytes.length, usage: body?.result?.usage ?? null } };
  });
}
