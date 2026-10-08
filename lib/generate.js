// Text-to-image through Cloudflare Workers AI, whose free daily allowance covers this model.
export const imageModel = '@cf/black-forest-labs/flux-1-schnell';

export async function generateImage(prompt) {
  const accountId = process.env.CLOUDFLARE_ACCOUNT_ID;
  const token = process.env.CLOUDFLARE_API_TOKEN;
  if (!accountId || !token) throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN are not set.');

  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${imageModel}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt, steps: 4 }),
    signal: AbortSignal.timeout(45000),
  });
  const body = await response.json().catch(() => null);
  // The image comes back as a base64-encoded JPEG.
  const image = body?.result?.image;
  if (!response.ok || !image) throw new Error(body?.errors?.[0]?.message ?? `Workers AI responded with ${response.status}.`);
  return { bytes: Buffer.from(image, 'base64'), contentType: 'image/jpeg', extension: 'jpg' };
}
