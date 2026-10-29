'use server';

import { revalidatePath } from 'next/cache';
import { requireAdmin } from '../../lib/admin-auth';
import { isUuid } from '../../lib/admin-catalog';
import { createSimulationRun, populateSimulation } from '../../lib/simulations';

function refreshSimulation(themeId) {
  for (const route of ['/admin', '/posts', '/tournaments', `/tournaments/${themeId}`]) revalidatePath(route);
}

async function fill(supabase, run) {
  try {
    await populateSimulation(supabase, run.id);
    return { message: `All ${run.participants.length} demo submissions are in. The bracket is open; cast votes and end each round below.` };
  } catch (error) {
    return { error: `Demo paused: ${error.message} Existing images are saved; retry missing submissions below.` };
  } finally { refreshSimulation(run.theme_id); }
}

export async function createSimulation(previousState, formData) {
  const { supabase } = await requireAdmin();
  let run;
  try { run = await createSimulationRun(supabase, String(formData.get('title') ?? '').trim(), Number(formData.get('count'))); }
  catch (error) { return { error: error.message }; }
  return fill(supabase, run);
}

export async function resumeSimulation(previousState, formData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('run_id') ?? '');
  if (!isUuid(id)) return { error: 'Choose a valid demo run.' };
  const { data: run } = await supabase.from('simulation_runs').select('*').eq('id', id).single();
  if (!run) return { error: 'Demo run could not be found.' };
  return fill(supabase, run);
}

export async function simulateRound(previousState, formData) {
  const { supabase } = await requireAdmin();
  const id = String(formData.get('run_id') ?? '');
  if (!isUuid(id)) return { error: 'Choose a valid demo run.' };
  const { data: run } = await supabase.from('simulation_runs').select('theme_id').eq('id', id).single();
  if (!run) return { error: 'Demo run could not be found.' };
  const { error } = await supabase.rpc('admin_simulate_round', { target_run: id });
  if (error) return { error: error.message };
  refreshSimulation(run.theme_id);
  return { message: 'Fake-user votes recorded and the current round ended immediately.' };
}
