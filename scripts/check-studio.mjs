// Runs the design-sheet chain for one tournament winner straight against Workers AI, without signing in and without
// saving anything: no sheet, no history rows, no files in storage. It walks the same steps the studio does (read the
// winner, imagine its world, write the art direction, then design and render portions) and prints each result.
//
//   npm run check:studio                      the most recent winner, one portion
//   npm run check:studio -- --theme 12        a specific tournament
//   npm run check:studio -- --portions 5      render more of the starter set
//   npm run check:studio -- --out ./renders   where to write the images (default: a temporary folder)
//   npm run check:studio -- --palette "#254333,#a9b36d,#e9db79"
//       the palette to use; the studio reads it from the winning image in the browser, which a script can't do
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';

nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { cellStatus, cleanModelText, newProject, ONCE, plan, shouldRun } = await import('../lib/studio/chain.js');
const { loadImage, renderImage, runTextStep } = await import('../lib/studio/cloudflare.js');
const { nameColor } = await import('../lib/studio/palette.js');
const { getChampionSource } = await import('../lib/studio/sheets.js');

const option = (name) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

try {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must be set in .env.local.');
  // The publishable key sees what a signed-out visitor sees, which includes every finished bracket and its winner.
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let themeId = option('theme');
  if (!themeId) {
    const { data } = await supabase.from('tournaments').select('theme_id').eq('status', 'finished').not('champion_post_id', 'is', null)
      .order('started_at', { ascending: false }).limit(1).maybeSingle();
    themeId = data?.theme_id;
  }
  const source = await getChampionSource(supabase, themeId);
  if (!source) throw new Error(themeId ? `Tournament ${themeId} has no winning image.` : 'No tournament has a winner yet.');
  const count = Math.max(1, Math.min(Number.parseInt(option('portions') ?? '1', 10) || 1, 5));
  const out = option('out') ? resolve(option('out')) : await mkdtemp(join(tmpdir(), 'studio-check-'));
  await mkdir(out, { recursive: true });

  const project = newProject(source);
  project.shots = project.shots.slice(0, count);
  const hexes = (option('palette') ?? '').split(',').map((hex) => hex.trim().toLowerCase()).filter((hex) => /^#[0-9a-f]{6}$/.test(hex));
  if (hexes.length) project.palette = { name: 'Custom', colors: hexes.map((hex) => ({ name: nameColor(hex), hex })) };
  console.log(`Winner of "${source.themeTitle}" by ${source.author}\n  ${source.prompt}\nPalette: ${project.palette.colors.map((color) => `${color.name} ${color.hex}`).join(', ')}\n`);

  // With no database client, nothing is recorded; the member id only matters for files in a member's own folder.
  const context = { supabase: null, userId: source.authorId, themeId: source.themeId, sheetId: 'check' };
  for (const group of plan(project)) {
    const step = project.steps.find((item) => item.id === group.stepId);
    for (const target of group.targets) {
      const cell = cellStatus(project, step, target);
      const label = `${step.name}${target === ONCE ? '' : ` · ${project.shots.find((shot) => shot.id === target).title}`}`;
      if (!shouldRun(cell.status, false)) throw new Error(`${label} cannot run (${cell.status}: ${[...cell.waiting, ...cell.unknown].join(', ')}).`);
      const started = Date.now();
      if (step.kind === 'text') {
        const image = cell.input.image ? await loadImage(supabase, context.userId, cell.input.image) : null;
        const { text, model } = await runTextStep({ ...context, step: step.name, system: cell.input.system, prompt: cell.input.prompt, image });
        (project.outputs[step.id] ??= {})[target] = { value: cleanModelText(text), signature: cell.signature };
        console.log(`── ${label}  (${model}${image ? ', shown the image' : ''}, ${((Date.now() - started) / 1000).toFixed(1)}s)\n${cleanModelText(text)}\n`);
      } else {
        const { reference, ...input } = cell.input;
        const referenceImage = reference ? { ...await loadImage(supabase, context.userId, reference), path: reference } : null;
        const render = await renderImage({ ...context, step: step.name, ...input, reference: referenceImage });
        const file = join(out, `${label.replace(/[^\w]+/g, '-').toLowerCase()}.${render.extension}`);
        await writeFile(file, render.bytes);
        (project.outputs[step.id] ??= {})[target] = { imagePath: file, signature: cell.signature };
        console.log(`── ${label}  (${render.model}, ${input.width}×${input.height}, ${((Date.now() - started) / 1000).toFixed(1)}s)\n${input.prompt}\n→ ${file}\n`);
      }
    }
  }
  console.log('The chain ran end to end. Nothing was saved to the database or to storage.');
} catch (error) {
  console.error(`Design sheet check failed: ${error.message}`);
  process.exitCode = 1;
}
