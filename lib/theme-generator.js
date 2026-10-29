// Text generation shares the Workers AI credentials used for image generation.
import { runGeneration } from './generation.js';
export const themeModel = process.env.CLOUDFLARE_THEME_MODEL?.trim() || '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

// Used when AI is not configured or fails, so there is always a theme available.
const fallbackThemes = [
  { title: 'Woodlands', description: 'Forests, clearings and the creatures that live among the trees.' },
  { title: 'Fine Art', description: 'Reimagine anything as if a great painter had made it.' },
  { title: 'Video Game Characters', description: 'Heroes, villains and sidekicks from a game that does not exist yet.' },
  { title: 'Deep Sea', description: 'Whatever glows, drifts or hides far below the surface.' },
  { title: 'Retro Future', description: 'Tomorrow as people in the past imagined it.' },
  { title: 'Tiny Worlds', description: 'Whole scenes small enough to fit in your hand.' },
  { title: 'Street Food', description: 'Stalls, carts and the dishes people line up for.' },
  { title: 'Myths and Legends', description: 'Gods, monsters and heroes from any tradition.' },
  { title: 'Weather', description: 'Storms, fog, heat waves and the first snow.' },
  { title: 'Architecture', description: 'Buildings real or impossible, inside or out.' },
];

export function fallbackTheme(recentTitles = []) {
  const unused = fallbackThemes.filter((theme) => !recentTitles.includes(theme.title));
  const pool = unused.length ? unused : fallbackThemes;
  return { ...pool[Math.floor(Math.random() * pool.length)], model: null };
}

// Returns { title, description, model }. Recent titles are passed along so themes don't repeat.
export async function suggestTheme(recentTitles = [], context = {}) {
  return runGeneration({ ...context, kind: 'theme', prompt: `Suggest a tournament theme. Avoid recent themes: ${JSON.stringify(recentTitles)}.` }, async (config) => {
    const themeModel = config.model;
    const accountId = process.env.CLOUDFLARE_ACCOUNT_ID?.trim();
    const token = process.env.CLOUDFLARE_API_TOKEN?.trim();
    if (!accountId || !token) {
      throw new Error('CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN must be set in .env.local or your deployment environment variables.');
    }

    const prompt = [
      'You pick a theme for a community where members make AI-generated images and then vote on them in a bracket tournament.',
      'Suggest one theme: broad enough that people can take it in very different directions, specific enough to inspire an image.',
      'Examples of the right size: "Woodlands", "Fine Art", "Video Game Character", "Underwater Cities".',
      'Give a title of one to four words and a one-sentence description that invites ideas without prescribing one.',
      'Return only a JSON object with string fields "title" and "description".',
      config.instructions,
    ].join('\n');

    let response;
    try {
      response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${themeModel}`, {
        method: 'POST',
        cache: 'no-store',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: prompt },
            { role: 'user', content: recentTitles.length
              ? `Suggest a fresh theme. Do not repeat or closely echo these recent themes: ${JSON.stringify(recentTitles)}.`
              : 'Suggest a fresh theme.' },
          ],
          ...config.parameters,
          response_format: {
            type: 'json_schema',
            json_schema: {
              type: 'object',
              properties: { title: { type: 'string' }, description: { type: 'string' } },
              required: ['title', 'description'],
              additionalProperties: false,
            },
          },
        }),
        signal: AbortSignal.timeout(20000),
      });
    } catch (error) {
      if (error.name === 'TimeoutError' || error.name === 'AbortError') {
        throw new Error('Cloudflare theme generation timed out after 20 seconds. Try again.', { cause: error });
      }
      throw new Error('Could not connect to Cloudflare Workers AI. Check the server network connection.', { cause: error });
    }
    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false) {
      const detail = body?.errors?.[0]?.message || response.statusText || 'Request failed.';
      throw new Error(`Cloudflare theme request failed (HTTP ${response.status}, model ${themeModel}): ${detail}`);
    }
    if (!body) throw new Error('Cloudflare returned an invalid JSON response.');

    // JSON mode can return either a parsed object or a JSON string in result.response.
    let theme = body.result?.response;
    if (theme == null || theme === '') throw new Error('Cloudflare did not return a theme.');
    try {
      if (typeof theme === 'string') theme = JSON.parse(theme);
    } catch {
      throw new Error('Cloudflare returned a theme that was not valid JSON. Try again.');
    }
    if (typeof theme?.title !== 'string' || !theme.title.trim()
      || typeof theme?.description !== 'string' || !theme.description.trim()) {
      throw new Error('Cloudflare returned a theme without a valid title and description. Try again.');
    }
    const title = theme.title.trim().slice(0, 80);
    const description = theme.description.trim().slice(0, 400);
    return { title, description, audit: { title, description, usage: body.result?.usage ?? null } };
  });
}
