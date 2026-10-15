// Suggests the day's image theme through the Gemini API.
export const themeModel = process.env.GEMINI_MODEL || 'gemini-3.8-flash';

// Used when Gemini is not configured or fails, so a day never goes without a theme.
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
export async function suggestTheme(recentTitles = []) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY is not set.');

  const prompt = [
    'You pick the daily theme for a community where members make AI-generated images and then vote on them in a bracket tournament.',
    'Suggest one theme: broad enough that people can take it in very different directions, specific enough to inspire an image.',
    'Examples of the right size: "Woodlands", "Fine Art", "Video Game Character", "Underwater Cities".',
    'Give a title of one to four words and a one-sentence description that invites ideas without prescribing one.',
    recentTitles.length ? `Do not repeat or closely echo these recent themes: ${recentTitles.join('; ')}.` : '',
  ].join('\n');

  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${themeModel}:generateContent`, {
    method: 'POST',
    headers: { 'x-goog-api-key': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ parts: [{ text: prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: {
          type: 'OBJECT',
          properties: { title: { type: 'STRING' }, description: { type: 'STRING' } },
          required: ['title', 'description'],
        },
      },
    }),
    signal: AbortSignal.timeout(20000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error?.message ?? `Gemini responded with ${response.status}.`);

  const text = body?.candidates?.[0]?.content?.parts?.find((part) => part.text)?.text;
  const theme = JSON.parse(text ?? 'null');
  const title = String(theme?.title ?? '').trim().slice(0, 80);
  const description = String(theme?.description ?? '').trim().slice(0, 400);
  if (!title) throw new Error('Gemini did not return a theme.');
  return { title, description, model: themeModel };
}
