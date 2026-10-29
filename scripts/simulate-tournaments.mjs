import nextEnv from '@next/env';
import { createClient } from '@supabase/supabase-js';
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production');
const { createSimulationRun, populateSimulation } = await import('../lib/simulations.js');
const [command, ...args] = process.argv.slice(2);
const option = (name) => args.includes(name) ? args[args.indexOf(name) + 1] : undefined;

try {
  if (!['create', 'fill', 'round', 'status'].includes(command)) throw new Error('Usage: npm run simulate:tournaments -- create --title "Cosmic Gardens" --entries 8 | fill --run UUID | round --run UUID | status --run UUID');
  const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key || !process.env.NEXT_PUBLIC_SUPABASE_URL) throw new Error('Set SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL in .env.local.');
  const supabase = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, key, { auth: { persistSession: false, autoRefreshToken: false } });
  let id = option('--run');
  if (command === 'create') {
    const run = await createSimulationRun(supabase, option('--title') || 'Cosmic Gardens', Number(option('--entries') || 8));
    id = run.id;
    console.log(`Created demo run ${id}; theme ${run.theme_id}. Use fill --run ${id} to resume if needed.`);
  }
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Supply a valid demo run ID with --run.');
  if (command === 'create' || command === 'fill') await populateSimulation(supabase, id, ({ postId }) => console.log(`Saved demo artwork ${postId}.`));
  if (command === 'round') {
    const { error } = await supabase.rpc('admin_simulate_round', { target_run: id });
    if (error) throw new Error(error.message);
    console.log('Recorded fake-user votes and ended the round immediately.');
  }
  const { data: run, error } = await supabase.from('simulation_runs').select('id,theme_id,participants,theme:themes(title)').eq('id', id).single();
  if (error) throw new Error(error.message);
  const { data: tournament, error: bracketError } = await supabase.from('tournaments').select('*').eq('theme_id', run.theme_id).maybeSingle();
  if (bracketError) throw new Error(bracketError.message);
  console.log(JSON.stringify({ run_id: run.id, theme_id: run.theme_id, title: run.theme.title,
    participants: run.participants.length, status: tournament?.status ?? 'awaiting submissions',
    round: tournament?.current_round ?? null, bracket_size: tournament?.bracket_size ?? null,
    champion_post_id: tournament?.champion_post_id ?? null }, null, 2));
} catch (error) { console.error(error.message); process.exitCode = 1; }
