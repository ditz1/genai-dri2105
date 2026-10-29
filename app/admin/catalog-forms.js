'use client';

import { useActionState } from 'react';
import { catalogs } from '../../lib/admin-catalog';
import { saveCatalogRecord, saveGenerationSettings, saveSignupSettings } from './catalog-actions';
import { confirmFirst } from './controls';

export function ActionStatus({ state }) {
  return state.error ? <p className="error" role="alert">{state.error}</p>
    : state.message ? <p className="meta" role="status">{state.message}</p> : null;
}

export function CatalogForm({ kind, record = {}, providers = [] }) {
  const [state, action, pending] = useActionState(saveCatalogRecord, {});
  return (
    <form action={action} className="admin-form">
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="id" value={record.id ?? ''} />
      {catalogs[kind].fields.map((field) => {
        let value = record[field.name] ?? field.defaultValue ?? '';
        if (field.name === 'parameters' && typeof value === 'object') value = JSON.stringify(value, null, 2);
        const choices = field.source ? providers.map((provider) => [provider.id, provider.name]) : field.choices;
        return <label key={field.name}>
          {field.type === 'checkbox'
            ? <span><input type="checkbox" name={field.name} defaultChecked={Boolean(value)} /> {field.label}</span>
            : <>{field.label}{choices
              ? <select name={field.name} defaultValue={value || choices[0]?.[0]} required>{choices.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select>
              : field.type === 'textarea'
                ? <textarea name={field.name} rows={field.name === 'parameters' ? 4 : 3} defaultValue={value} maxLength={field.maxLength} required={!field.optional} />
                : <input type={field.type ?? 'text'} name={field.name} defaultValue={value} maxLength={field.maxLength} placeholder={field.placeholder} required={!field.optional} />}</>}
        </label>;
      })}
      <div className="votes">
        <button disabled={pending}>{pending ? 'Saving…' : record.id ? 'Save changes' : 'Add record'}</button>
        {record.id && <button className="secondary" name="operation" value="delete" formNoValidate disabled={pending}
          onClick={confirmFirst('Delete this record? Records in active use cannot be deleted.')}>Delete</button>}
      </div>
      <ActionStatus state={state} />
    </form>
  );
}

export function GenerationSettingsForm({ settings, models, providers }) {
  const [state, action, pending] = useActionState(saveGenerationSettings, {});
  const usable = models.filter((model) => model.enabled && providers.some((p) => p.id === model.provider_id && p.enabled && p.adapter === 'cloudflare'));
  return <form action={action} className="admin-form">
    <div className="form-row">
      {['image', 'theme'].map((kind) => <label key={kind}>{kind === 'image' ? 'Image model' : 'Theme model'}
        <select name={`${kind}_model_id`} defaultValue={settings[`${kind}_model_id`]} required>
          {usable.filter((model) => model.capability === kind).map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}
        </select>
      </label>)}
    </div>
    <label>Image prompt prefix (optional)<textarea name="image_prompt_prefix" rows={2} maxLength={500} defaultValue={settings.image_prompt_prefix} /></label>
    <label>Extra theme instructions (optional)<textarea name="theme_instructions" rows={3} maxLength={1000} defaultValue={settings.theme_instructions} /></label>
    <button disabled={pending}>{pending ? 'Saving…' : 'Save generation settings'}</button>
    <ActionStatus state={state} />
  </form>;
}

export function SignupSettingsForm({ restricted }) {
  const [state, action, pending] = useActionState(saveSignupSettings, {});
  return <form action={action} className="admin-form">
    <label><span><input type="checkbox" name="restrict_signups" defaultChecked={restricted} /> Restrict new signups to the domains or email addresses below</span></label>
    <p className="meta">Existing members can still sign in. When enabled, an empty set of lists blocks all new accounts.</p>
    <button disabled={pending}>{pending ? 'Saving…' : 'Save signup policy'}</button>
    <ActionStatus state={state} />
  </form>;
}
