'use client';

import { useRef, useState } from 'react';
import {
  availableVars, cellStatus, defaultSteps, newStep, ONCE, PROJECT_VARS, renameKey, SHOT_VARS, SOURCE_VARS, targetsOf, templateVars,
} from '../../lib/studio/chain';
import { LIMITS } from '../../lib/studio/sheet';
import { discardImages } from './storage';
import Thumb from './thumb';

const STATUS_LABEL = { done: 'Up to date', stale: 'Out of date', empty: 'Not run', blocked: 'Waiting', invalid: 'Fix template' };
const RESERVED = { ...PROJECT_VARS, ...SOURCE_VARS };
const stepImages = (project, stepIds) => stepIds.flatMap((id) => Object.values(project.outputs[id] ?? {}).map((output) => output.imagePath));

export default function ChainView({ project, update, run, busy, ...rest }) {
  const setSteps = (change) => update((current) => ({ ...current, steps: change(current.steps) }));
  const full = project.steps.length >= LIMITS.steps;

  const removeStep = (step) => {
    if (!window.confirm(`Remove the step "${step.name}" and its outputs?`)) return;
    discardImages(stepImages(project, [step.id]));
    update((current) => {
      const { [step.id]: _, ...outputs } = current.outputs;
      return { ...current, steps: current.steps.filter((item) => item.id !== step.id), outputs };
    });
  };

  const resetChain = () => {
    if (!window.confirm('Replace the chain with the default steps? Current outputs are cleared.')) return;
    discardImages(stepImages(project, project.steps.map((step) => step.id)));
    update((current) => ({ ...current, steps: defaultSteps(current.source), outputs: {} }));
  };

  const move = (index, delta) => setSteps((steps) => {
    const next = [...steps];
    const [step] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, step);
    return next;
  });

  return (
    <div className="chain">
      <div className="chain-intro">
        <p>
          Each step fills its template with <code>{'{{variables}}'}</code>, then sends it to a model. A text step&apos;s output becomes a
          variable for the steps after it. <strong>Per-portion</strong> steps run once for each portion, and <strong>once</strong> steps run
          once for the whole sheet. Edit any template or output and everything downstream is marked out of date, ready to re-run.
          {project.source && <> This chain starts from the winning image: <code>{'{{theme}}'}</code> and <code>{'{{winner}}'}</code> carry its theme and prompt, and a step can be shown the image itself.</>}
        </p>
        <button type="button" className="ghost small" disabled={busy} onClick={resetChain}>Reset to default chain</button>
      </div>

      <ol className="steps">
        {project.steps.map((step, index) => (
          <StepCard key={step.id} project={project} step={step} index={index} update={update} setSteps={setSteps}
            run={run} busy={busy} move={move} remove={removeStep} {...rest} />
        ))}
      </ol>

      <div className="add-step">
        <button type="button" className="ghost" disabled={full} onClick={() => setSteps((steps) => [...steps, uniqueKey(newStep('text', 'each'), steps)])}>+ Text step</button>
        <button type="button" className="ghost" disabled={full} onClick={() => setSteps((steps) => [...steps, uniqueKey(newStep('image', 'each'), steps)])}>+ Image step</button>
        {full && <span className="muted small">A chain holds up to {LIMITS.steps} steps.</span>}
      </div>
    </div>
  );
}

function uniqueKey(step, steps) {
  let key = step.key;
  for (let n = 2; steps.some((item) => item.key === key); n += 1) key = `${step.key}${n}`;
  return { ...step, key };
}

function StepCard({ project, step, index, setSteps, run, busy, move, remove, running, errors, setOutput }) {
  const [showSystem, setShowSystem] = useState(false);
  const templateRef = useRef(null);
  const allowed = availableVars(project, index);
  const unknown = [...templateVars(step.template), ...templateVars(step.system)].filter((name) => !allowed.includes(name));
  const change = (fields) => setSteps((steps) => steps.map((item) => (item.id === step.id ? { ...item, ...fields } : item)));
  const targets = targetsOf(project, step);
  const statuses = targets.map((target) => cellStatus(project, step, target).status);
  const pending = statuses.filter((status) => status !== 'done').length;

  const changeKey = (value) => {
    const key = value.replace(/[^\w]/g, '').slice(0, 40);
    if (!key || /^\d/.test(key) || project.steps.some((item) => item.id !== step.id && item.key === key) || key in RESERVED) return;
    setSteps((steps) => renameKey(steps, step.key, key));
  };

  const insert = (name) => {
    const textarea = templateRef.current;
    const token = `{{${name}}}`;
    const start = textarea?.selectionStart ?? step.template.length;
    const end = textarea?.selectionEnd ?? step.template.length;
    change({ template: step.template.slice(0, start) + token + step.template.slice(end) });
    requestAnimationFrame(() => {
      textarea?.focus();
      textarea?.setSelectionRange(start + token.length, start + token.length);
    });
  };

  return (
    <li className={`step step-${step.kind}`}>
      <div className="step-head">
        <span className="step-index">{index + 1}</span>
        <input className="step-name" value={step.name} size={Math.max(6, step.name.length + 1)} maxLength={LIMITS.stepName}
          onChange={(event) => change({ name: event.target.value })} aria-label="Step name" />
        <span className={`tag kind-${step.kind}`}>{step.kind === 'text' ? 'Text' : 'Image'}</span>
        <select value={step.scope} onChange={(event) => change({ scope: event.target.value })} aria-label="Runs">
          <option value="once">Once</option>
          <option value="each">Per portion</option>
        </select>
        {step.kind === 'text' && (
          <label className="key-field" title="Later steps use this step's output as this variable">
            <span>{'{{'}</span>
            <input defaultValue={step.key} key={step.key} onBlur={(event) => { changeKey(event.target.value); event.target.value = step.key; }}
              onKeyDown={(event) => event.key === 'Enter' && event.currentTarget.blur()} aria-label="Output variable" />
            <span>{'}}'}</span>
          </label>
        )}
        {step.kind === 'text' && project.source && (
          <label className="check small" title="Send the winning image to a vision model along with this prompt">
            <input type="checkbox" checked={Boolean(step.vision)} onChange={(event) => change({ vision: event.target.checked })} />
            Sees the winning image
          </label>
        )}
        <div className="step-actions">
          <button type="button" className="icon" aria-label="Move step up" disabled={index === 0 || busy} onClick={() => move(index, -1)}>↑</button>
          <button type="button" className="icon" aria-label="Move step down" disabled={index === project.steps.length - 1 || busy} onClick={() => move(index, 1)}>↓</button>
          <button type="button" className="icon" aria-label="Remove step" disabled={busy} onClick={() => remove(step)}>×</button>
          <button type="button" className="ghost small" disabled={busy || !targets.length} onClick={() => run({ onlyStep: step.id, force: pending === 0, label: `Running ${step.name}` })}>
            {pending ? `Run ${pending}` : 'Re-run step'}
          </button>
        </div>
      </div>

      {step.kind === 'text' && (
        showSystem || step.system ? (
          <label className="field">
            <span>System prompt</span>
            <textarea rows={2} value={step.system} maxLength={LIMITS.system} onChange={(event) => change({ system: event.target.value })} placeholder="Role and rules for the model" />
          </label>
        ) : <button type="button" className="link small" onClick={() => setShowSystem(true)}>+ System prompt</button>
      )}

      <label className="field">
        <span>{step.kind === 'text' ? 'Prompt template' : 'Image prompt template'}</span>
        <textarea ref={templateRef} className="template" rows={Math.min(12, Math.max(3, step.template.split('\n').length + 1))}
          value={step.template} maxLength={LIMITS.template} onChange={(event) => change({ template: event.target.value })} spellCheck={false} />
      </label>
      <div className="var-chips">
        {allowed.map((name) => (
          <button key={name} type="button" className={`var ${project.steps.some((item) => item.key === name) ? 'from-step' : name in SOURCE_VARS ? 'from-winner' : ''}`}
            title={PROJECT_VARS[name] ?? SOURCE_VARS[name] ?? SHOT_VARS[name] ?? 'Output of an earlier step'} onClick={() => insert(name)}>{name}</button>
        ))}
      </div>
      {unknown.length > 0 && (
        <p className="warn">Not available here: {unknown.map((name) => <code key={name}>{`{{${name}}}`}</code>)}. Variables must come from the sheet, the portion, or an earlier text step{step.scope === 'once' ? ' that also runs once' : ''}.</p>
      )}

      <div className={`outputs ${step.scope === 'once' ? 'single' : ''}`}>
        {targets.length === 0 && <p className="muted small">Add portions in Art direction to run this step.</p>}
        {targets.map((target) => (
          <OutputCell key={target} project={project} step={step} target={target} run={run} busy={busy}
            running={running[`${step.id}:${target}`]} error={errors[`${step.id}:${target}`]} setOutput={setOutput} />
        ))}
      </div>
    </li>
  );
}

function OutputCell({ project, step, target, run, busy, running, error, setOutput }) {
  const [showInput, setShowInput] = useState(false);
  const cell = cellStatus(project, step, target);
  const shot = project.shots.find((item) => item.id === target);
  const output = cell.output;
  const status = running ? 'running' : cell.status;

  return (
    <div className={`cell status-${status}`}>
      <div className="cell-head">
        <div className="cell-heading">
          <span className="cell-title" title={target === ONCE ? undefined : shot?.title}>{target === ONCE ? 'Whole sheet' : shot?.title || 'Untitled'}</span>
          <span className="cell-sub">
            {target === ONCE ? 'Runs once for the set' : shot?.category}
            {project.image.anchor === target && step.kind === 'image' && <span className="tag anchor">Anchor</span>}
          </span>
        </div>
        <span className={`pill pill-${status}`}>{running ? 'Running…' : STATUS_LABEL[status]}</span>
      </div>

      {step.kind === 'text' ? (
        output ? (
          <textarea className="output-text" rows={step.scope === 'once' ? 5 : 6} value={output.value} maxLength={LIMITS.output}
            onChange={(event) => setOutput(step.id, target, { ...output, value: event.target.value, edited: true })} />
        ) : <p className="placeholder">{cell.status === 'blocked' ? `Waiting for ${cell.waiting.join(', ')}` : 'No output yet'}</p>
      ) : (
        output?.imagePath ? <Thumb path={output.imagePath} alt={shot?.title} /> : (
          <div className="placeholder image-placeholder">{cell.status === 'blocked' ? `Waiting for ${cell.waiting.join(', ')}` : 'No image yet'}</div>
        )
      )}

      {error && <p className="error">{error}</p>}
      {output?.edited && <p className="muted small">Edited by hand</p>}

      <div className="cell-actions">
        <button type="button" className="link small" onClick={() => setShowInput((value) => !value)}>{showInput ? 'Hide input' : 'Show input'}</button>
        <span className="spacer" />
        <button type="button" className="ghost small" disabled={busy || cell.status === 'blocked' || cell.status === 'invalid'}
          onClick={() => run({ onlyStep: step.id, onlyTarget: target, force: true, label: `Running ${step.name}` })}>
          {output ? 'Re-run' : 'Run'}
        </button>
      </div>
      {showInput && (
        <pre className="input-preview">
          {step.kind === 'text'
            ? [cell.input.system && `SYSTEM\n${cell.input.system}`, `PROMPT\n${cell.input.prompt}`, cell.input.image && 'IMAGE\nThe winning image'].filter(Boolean).join('\n\n')
            : `${cell.input.prompt}\n\n${cell.input.width}×${cell.input.height} · ${cell.input.model}${cell.input.seed !== undefined ? ` · seed ${cell.input.seed}` : ''}${cell.input.reference ? ' · with style anchor' : ''}`}
        </pre>
      )}
    </div>
  );
}
