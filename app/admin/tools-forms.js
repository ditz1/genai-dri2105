'use client';

import { useActionState } from 'react';
import { ActionStatus } from './catalog-forms';
import { uploadMedia } from './media-actions';
import { createSimulation, resumeSimulation, simulateRound } from './simulation-actions';

export function UploadMediaForm({ themes }) {
  const [state, action, pending] = useActionState(uploadMedia, {});
  return <form action={action} className="admin-form">
    <label>Image<input type="file" name="image" accept="image/jpeg,image/png,image/webp" required /></label>
    <label>Prompt<textarea name="prompt" maxLength={500} rows={2} required /></label>
    <label>Caption (optional)<input name="caption" maxLength={300} /></label>
    <label>Theme<select name="theme_id"><option value="">No theme</option>{themes.map((theme) => <option value={theme.id} key={theme.id}>{theme.title}</option>)}</select></label>
    <label><span><input type="checkbox" name="publish" defaultChecked /> Publish immediately</span></label>
    <button disabled={pending}>{pending ? 'Uploading…' : 'Upload image'}</button>
    <ActionStatus state={state} />
  </form>;
}

export function NewSimulationForm() {
  const [state, action, pending] = useActionState(createSimulation, {});
  return <form action={action} className="admin-form">
    <label>Demo theme<input name="title" maxLength={70} defaultValue="Cosmic Gardens" required /></label>
    <label>Fake participants<input type="number" name="count" min={2} max={8} defaultValue={8} required /></label>
    <p className="meta">Generates one artwork for each selected account without an email, then starts a separate bracket once every submission is saved.</p>
    <button disabled={pending}>{pending ? 'Generating demo submissions…' : 'Create demo tournament'}</button>
    <ActionStatus state={state} />
  </form>;
}

export function SimulationControl({ run, tournament }) {
  const action = tournament ? simulateRound : resumeSimulation;
  const [state, submit, pending] = useActionState(action, {});
  if (tournament && tournament.status !== 'running') return <p className="meta">Demo {tournament.status}.</p>;
  return <form action={submit} className="admin-form">
    <input type="hidden" name="run_id" value={run.id} />
    <button disabled={pending}>{pending ? 'Working…' : tournament ? 'Cast demo votes & end current round' : 'Generate missing submissions & start bracket'}</button>
    <ActionStatus state={state} />
  </form>;
}
