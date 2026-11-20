'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { cellStatus, ONCE } from '../../lib/studio/chain';
import { publicImageUrl } from '../../lib/studio/sheet';
import Thumb from './thumb';

// The finished sheet: the winner it grew from, the world and look the chain settled on, and every portion's render.
export default function BoardView({ project, run, busy, running, errors }) {
  const imageSteps = project.steps.filter((step) => step.kind === 'image' && step.scope === 'each');
  const [stepId, setStepId] = useState(null);
  const [open, setOpen] = useState(null);
  const step = imageSteps.find((item) => item.id === stepId) ?? imageSteps.at(-1);
  const { source } = project;

  const doneCount = step ? project.shots.filter((shot) => cellStatus(project, step, shot.id).output?.imagePath).length : 0;
  // What the chain has written about the whole sheet so far, shown beside the winner.
  const once = (key) => {
    const item = project.steps.find((candidate) => candidate.key === key && candidate.scope === 'once' && candidate.kind === 'text');
    return item ? project.outputs[item.id]?.[ONCE]?.value : null;
  };
  const world = once('world') ?? project.brief;
  const look = once('winnerStyle');

  return (
    <div className="sheet">
      <div className={`sheet-head ${source ? 'with-winner' : ''}`}>
        {source && (
          <figure className="sheet-winner">
            <Thumb path={source.imagePath} alt={source.prompt} />
            <figcaption className="muted small">
              Winner of <Link href={`/tournaments/${source.themeId}`}>{source.themeTitle}</Link>, by <Link href={`/people/${source.authorId}`}>{source.author}</Link>
            </figcaption>
          </figure>
        )}
        <div className="sheet-summary">
          <p className="card-category">Design sheet</p>
          <h1>{project.title || 'Untitled'}</h1>
          {world
            ? <p className="muted">{world}</p>
            : source && <p className="muted">Run the chain to imagine the world around this image and fill the sheet in its style.</p>}
          {look && <p className="muted small"><strong>Look:</strong> {look}</p>}
          <div className="sheet-meta">
            <span className="swatches large">{project.palette.colors.map((color, index) => <i key={index} style={{ background: color.hex }} title={color.name} />)}</span>
            <span className="muted small">{project.palette.colors.map((color) => color.name).join(' · ')}</span>
            {project.styles.length > 0 && <span className="muted small">{project.styles.join(' · ')}</span>}
          </div>
          <div className="sheet-actions">
            {step && project.shots.length > 0 && doneCount === 0 && (
              <button type="button" className="primary" disabled={busy} onClick={() => run()}>{busy ? 'Filling the sheet…' : 'Fill the sheet'}</button>
            )}
            {step && <span className="muted small">{doneCount} of {project.shots.length} rendered</span>}
            {imageSteps.length > 1 && (
              <select value={step.id} onChange={(event) => setStepId(event.target.value)} aria-label="Image step">
                {imageSteps.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
              </select>
            )}
          </div>
        </div>
      </div>

      {!step && <div className="empty-state"><h2>No image step yet</h2><p>Add a per-portion image step to the prompt chain to fill the sheet.</p></div>}
      {step && !project.shots.length && <div className="empty-state"><h2>No portions yet</h2><p>Add characters, environments, items and more under Art direction.</p></div>}

      {step && (
        <div className="sheet-grid">
          {project.shots.map((shot) => (
            <Card key={shot.id} project={project} step={step} shot={shot} run={run} busy={busy}
              running={Object.keys(running).some((key) => key.endsWith(`:${shot.id}`))}
              error={Object.entries(errors).find(([key]) => key.endsWith(`:${shot.id}`))?.[1]}
              onOpen={() => setOpen(shot.id)} />
          ))}
        </div>
      )}

      {open && step && <Lightbox project={project} step={step} shot={project.shots.find((shot) => shot.id === open)} onClose={() => setOpen(null)} />}
    </div>
  );
}

function Card({ project, step, shot, run, busy, running, error, onOpen }) {
  const cell = cellStatus(project, step, shot.id);
  const output = cell.output;
  const stale = output && cell.status !== 'done';
  return (
    <article className={`sheet-card ${running ? 'is-running' : ''}`}>
      <div className="card-media">
        {output?.imagePath ? <Thumb path={output.imagePath} alt={shot.title} onClick={onOpen} /> : (
          <div className="placeholder image-placeholder">{running ? 'Generating…' : 'Not rendered yet'}</div>
        )}
        {running && <div className="card-spinner" aria-label="Generating" />}
        {project.image.anchor === shot.id && <span className="tag anchor on-image">Anchor</span>}
        {stale && !running && <span className="tag stale on-image right">Out of date</span>}
      </div>
      <div className="card-body">
        <span className="card-category">{shot.category}</span>
        <h3>{shot.title || 'Untitled'}</h3>
        <p className="muted small clamp">{shot.description}</p>
        {error && <p className="error small">{error}</p>}
        <div className="card-actions">
          <button type="button" className="ghost small" disabled={busy}
            title="Run this portion through the whole chain again (the shared steps are kept)"
            onClick={() => run({ onlyTarget: shot.id, force: true, label: `Regenerating ${shot.title}` })}>Regenerate</button>
          <button type="button" className="ghost small" disabled={busy || cell.status === 'blocked' || cell.status === 'invalid'}
            title="Same prompt, new random seed"
            onClick={() => run({ onlyStep: step.id, onlyTarget: shot.id, force: true, newSeed: true, label: `New variation of ${shot.title}` })}>Variation</button>
          {stale && (
            <button type="button" className="primary small" disabled={busy}
              onClick={() => run({ onlyTarget: shot.id, label: `Updating ${shot.title}` })}>Update</button>
          )}
        </div>
      </div>
    </article>
  );
}

function Lightbox({ project, step, shot, onClose }) {
  const output = project.outputs[step.id]?.[shot?.id];
  useEffect(() => {
    const close = (event) => event.key === 'Escape' && onClose();
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', close);
    return () => {
      document.body.style.overflow = overflow;
      window.removeEventListener('keydown', close);
    };
  }, [onClose]);
  if (!shot || !output?.imagePath) return null;
  const url = publicImageUrl(output.imagePath);
  const filename = `${project.title}-${shot.title}`.replace(/[^\w-]+/g, '-').toLowerCase();
  // Find the design text written for this portion, if the chain has a step for it.
  const designStep = project.steps.find((item) => item.key === 'design' && item.scope === 'each' && item.kind === 'text');
  const design = designStep && project.outputs[designStep.id]?.[shot.id]?.value;

  return (
    <div className="lightbox" role="dialog" aria-modal="true" aria-label={shot.title} onClick={onClose}>
      <div className="lightbox-inner" onClick={(event) => event.stopPropagation()}>
        <img src={url} alt={shot.title} />
        <aside>
          <span className="muted small">{shot.category}</span>
          <h2>{shot.title}</h2>
          {output.seed !== null && <p className="muted small">Seed {output.seed}</p>}
          {design && <><h4>Design</h4><p className="prompt-text">{design}</p></>}
          <h4>Image prompt</h4>
          <p className="prompt-text">{output.prompt}</p>
          <div className="lightbox-actions">
            {/* Storage sends the file as a download when asked to, which a plain link to another site can't do. */}
            <a className="button primary" href={`${url}?download=${encodeURIComponent(`${filename}.jpg`)}`}>Download</a>
            <button type="button" className="ghost" onClick={onClose}>Close</button>
          </div>
        </aside>
      </div>
    </div>
  );
}
