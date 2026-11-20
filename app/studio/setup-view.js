'use client';

import Link from 'next/link';
import { useState } from 'react';
import { newId, starterShots, WINNER_ANCHOR } from '../../lib/studio/chain';
import { IMAGE_MODELS } from '../../lib/studio/models';
import { nameColor } from '../../lib/studio/palette';
import { ASPECTS, CATEGORIES, PALETTES, STYLES } from '../../lib/studio/presets';
import { LIMITS } from '../../lib/studio/sheet';
import { discardImages } from './storage';
import Thumb from './thumb';

export default function SetupView({ project, update, busy, paletteFromWinner }) {
  const set = (fields) => update((current) => ({ ...current, ...fields }));
  const setImage = (fields) => update((current) => ({ ...current, image: { ...current.image, ...fields } }));
  const { source } = project;

  return (
    <div className="setup">
      {source && <Winner source={source} />}
      <section className={`panel ${source ? 'span-2' : 'span-3'}`}>
        <h2>Concept</h2>
        <label className="field">
          <span>Sheet title</span>
          <input value={project.title} maxLength={LIMITS.title} onChange={(event) => set({ title: event.target.value })} placeholder="Name your world or production" />
        </label>
        <label className="field">
          <span>{source ? 'Your direction (optional)' : 'World brief'}</span>
          <textarea rows={source ? 4 : 3} value={project.brief} maxLength={LIMITS.brief} onChange={(event) => set({ brief: event.target.value })}
            placeholder={source
              ? 'The chain imagines the world around the winning image. Steer it here if you like: the genre, the era, what kind of game this is…'
              : 'What is this world about? Setting, era, mood, story hooks…'} />
        </label>
      </section>

      <PaletteEditor project={project} update={update} busy={busy} paletteFromWinner={paletteFromWinner} />
      <StylePicker project={project} set={set} />
      <Rendering project={project} setImage={setImage} />
      <Portions project={project} update={update} />
    </div>
  );
}

// The tournament winner this sheet grows from. Its theme and prompt feed the chain as {{theme}} and {{winner}}.
function Winner({ source }) {
  return (
    <section className="panel winner">
      <h2>Starting point</h2>
      <Thumb path={source.imagePath} alt={source.prompt} />
      <p className="small">
        Winner of <Link href={`/tournaments/${source.themeId}`}>{source.themeTitle}</Link>, by <Link href={`/people/${source.authorId}`}>{source.author}</Link>
      </p>
      <p className="muted small prompt-text">{source.prompt}</p>
      <p className="note">The chain reads this image&apos;s style, and its theme and prompt are available to every step. Nothing here changes the original post.</p>
    </section>
  );
}

function PaletteEditor({ project, update, busy, paletteFromWinner }) {
  const { palette } = project;
  const setColors = (colors, name = 'Custom') => update((current) => ({ ...current, palette: { name, colors } }));
  const changeColor = (index, fields) => setColors(palette.colors.map((color, i) => (i === index ? { ...color, ...fields } : color)));

  return (
    <section className="panel">
      <h2>Color palette</h2>
      <p className="note">
        {project.source
          ? 'Taken from the winning image when the sheet was started. Every prompt in the chain can use it. Color names matter more to the image model than hex codes.'
          : 'Every prompt in the chain can use the palette. Color names matter more to the image model than hex codes.'}
      </p>
      <div className="palette-presets">
        {project.source && (
          <button type="button" className={`palette-preset ${palette.name === 'From the winner' ? 'active' : ''}`} disabled={busy} onClick={paletteFromWinner}>
            <span className="swatches">
              {(palette.name === 'From the winner' ? palette.colors : []).map((color, index) => <i key={index} style={{ background: color.hex }} />)}
            </span>
            <span>From the winner</span>
          </button>
        )}
        {PALETTES.map((preset) => (
          <button key={preset.name} type="button" className={`palette-preset ${palette.name === preset.name ? 'active' : ''}`}
            onClick={() => setColors(preset.colors.map(([name, hex]) => ({ name, hex })), preset.name)}>
            <span className="swatches">{preset.colors.map(([, hex]) => <i key={hex} style={{ background: hex }} />)}</span>
            <span>{preset.name}</span>
          </button>
        ))}
      </div>
      <div className="palette-colors">
        {palette.colors.map((color, index) => (
          <div className="palette-color" key={index}>
            <label className="swatch-input" style={{ background: color.hex }} title="Pick a color">
              <input type="color" value={color.hex} onChange={(event) => changeColor(index, { hex: event.target.value, name: nameColor(event.target.value) })} />
            </label>
            <input className="color-name" value={color.name} maxLength={40} onChange={(event) => changeColor(index, { name: event.target.value })} aria-label="Color name" />
            <code>{color.hex}</code>
            <button type="button" className="icon" aria-label={`Remove ${color.name}`} disabled={palette.colors.length <= 1}
              onClick={() => setColors(palette.colors.filter((_, i) => i !== index))}>×</button>
          </div>
        ))}
        {palette.colors.length < LIMITS.colors && (
          <button type="button" className="ghost small" onClick={() => {
            const hex = `#${Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0')}`;
            setColors([...palette.colors, { name: nameColor(hex), hex }]);
          }}>+ Add color</button>
        )}
      </div>
    </section>
  );
}

function StylePicker({ project, set }) {
  const [custom, setCustom] = useState('');
  const presetNames = new Set(STYLES.map((style) => style.name));
  const full = project.styles.length >= LIMITS.styles;
  const toggle = (name) => {
    if (project.styles.includes(name)) set({ styles: project.styles.filter((item) => item !== name) });
    else if (!full) set({ styles: [...project.styles, name] });
  };
  const addCustom = () => {
    const value = custom.trim();
    if (value && !project.styles.includes(value) && !full) set({ styles: [...project.styles, value] });
    setCustom('');
  };

  return (
    <section className="panel">
      <h2>Style</h2>
      <p className="note">
        {project.source
          ? 'The chain already takes its style from the winning image. Add styles here only to push the set in another direction.'
          : 'Pick one or more rendering styles, or add your own.'}
      </p>
      <div className="chips">
        {STYLES.map((style) => (
          <button key={style.name} type="button" className={`chip ${project.styles.includes(style.name) ? 'active' : ''}`}
            title={style.prompt} onClick={() => toggle(style.name)}>{style.name}</button>
        ))}
        {project.styles.filter((name) => !presetNames.has(name)).map((name) => (
          <button key={name} type="button" className="chip active custom" title="Remove" onClick={() => toggle(name)}>{name} ×</button>
        ))}
      </div>
      <form className="inline-add" onSubmit={(event) => { event.preventDefault(); addCustom(); }}>
        <input value={custom} maxLength={60} onChange={(event) => setCustom(event.target.value)} placeholder="Custom style, e.g. art deco, ukiyo-e woodblock" />
        <button type="submit" className="ghost" disabled={!custom.trim() || full}>Add</button>
      </form>
      <label className="field">
        <span>Style notes</span>
        <textarea rows={2} value={project.styleNotes} maxLength={LIMITS.styleNotes} onChange={(event) => set({ styleNotes: event.target.value })}
          placeholder="Anything else every image should share: lighting, mood, line weight, references…" />
      </label>
    </section>
  );
}

function Rendering({ project, setImage }) {
  const { image } = project;
  const model = IMAGE_MODELS[image.model];
  return (
    <section className="panel">
      <h2>Rendering</h2>
      <label className="field">
        <span>Image model</span>
        <select value={image.model} onChange={(event) => setImage({ model: event.target.value })}>
          {Object.entries(IMAGE_MODELS).map(([key, item]) => <option key={key} value={key}>{item.label}</option>)}
        </select>
        <small className="note">{model?.note}</small>
      </label>
      {model?.size && (
        <div className="field">
          <span>Aspect ratio</span>
          <div className="segmented">
            {Object.keys(ASPECTS).map((aspect) => (
              <button key={aspect} type="button" className={image.aspect === aspect ? 'active' : ''} onClick={() => setImage({ aspect })}>{aspect}</button>
            ))}
          </div>
        </div>
      )}
      {model?.seed && (
        <div className="field">
          <span>Seed</span>
          <label className="check">
            <input type="checkbox" checked={image.lockSeed} onChange={(event) => setImage({ lockSeed: event.target.checked })} />
            Share one seed across the set
          </label>
          <div className="seed-row">
            <input type="number" aria-label="Seed" min="0" max="2147483647" value={image.seed} disabled={!image.lockSeed}
              onChange={(event) => setImage({ seed: Math.max(0, Math.min(2147483647, Math.floor(Number(event.target.value) || 0))) })} />
            <button type="button" className="ghost small" title="Pick a new random seed" disabled={!image.lockSeed}
              onClick={() => setImage({ seed: Math.floor(Math.random() * 2147483647) })}>Shuffle</button>
          </div>
        </div>
      )}
      {model?.references > 0 && (
        <label className="field">
          <span>Style anchor <em className="muted">(experimental)</em></span>
          <select value={image.anchor ?? ''} onChange={(event) => setImage({ anchor: event.target.value || null })}>
            <option value="">None</option>
            {project.source && <option value={WINNER_ANCHOR}>The winning image</option>}
            {project.shots.map((shot) => <option key={shot.id} value={shot.id}>{shot.title || 'Untitled'} ({shot.category})</option>)}
          </select>
          <small className="note">
            The anchor image goes to the renders as a reference. FLUX.2 follows references closely and tends to redraw them,
            so this suits variations of one design (outfits, poses, times of day). For a set of different subjects, leave it
            off: the style read from the winner, the palette and the shared seed keep the set together.
          </small>
        </label>
      )}
    </section>
  );
}

function Portions({ project, update }) {
  const setShots = (change) => update((current) => ({ ...current, shots: change(current.shots) }));
  const changeShot = (id, fields) => setShots((shots) => shots.map((shot) => (shot.id === id ? { ...shot, ...fields } : shot)));
  const full = project.shots.length >= LIMITS.shots;
  // Removing portions also removes their outputs and stored images.
  const removeShots = (ids) => {
    discardImages(Object.values(project.outputs).flatMap((cells) => ids.map((id) => cells[id]?.imagePath)));
    update((current) => {
      const outputs = Object.fromEntries(Object.entries(current.outputs).map(([stepId, cells]) => (
        [stepId, Object.fromEntries(Object.entries(cells).filter(([target]) => !ids.includes(target)))]
      )));
      return { ...current, shots: current.shots.filter((shot) => !ids.includes(shot.id)), outputs,
        image: ids.includes(current.image.anchor) ? { ...current.image, anchor: null } : current.image };
    });
  };
  const applyStarterSet = () => {
    if (project.shots.length && !window.confirm('Replace all portions (and their outputs) with the starter set?')) return;
    removeShots(project.shots.map((shot) => shot.id));
    setShots(() => starterShots(project.source));
  };
  const move = (index, delta) => setShots((shots) => {
    const next = [...shots];
    const [shot] = next.splice(index, 1);
    next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, shot);
    return next;
  });

  return (
    <section className="panel span-3">
      <div className="panel-head">
        <h2>Portions <span className="tally">{project.shots.length}</span></h2>
        <button type="button" className="ghost small" onClick={applyStarterSet}>Use starter set</button>
      </div>
      <p className="note">
        Each portion is one piece of the sheet, like a character, a place or an item. Per-portion steps in the chain run once for every
        portion, all from the same art direction{project.source ? ' and the same winning image' : ''}.
      </p>
      <div className="shots">
        {project.shots.map((shot, index) => (
          <article className="shot" key={shot.id}>
            <div className="shot-head">
              <select value={shot.category} onChange={(event) => changeShot(shot.id, { category: event.target.value })} aria-label="Category">
                {CATEGORIES.map((category) => <option key={category.name}>{category.name}</option>)}
                {!CATEGORIES.some((category) => category.name === shot.category) && <option>{shot.category}</option>}
              </select>
              {project.image.anchor === shot.id && <span className="tag anchor" title="Style anchor">Anchor</span>}
              <span className="spacer" />
              <button type="button" className="icon" aria-label="Move up" disabled={index === 0} onClick={() => move(index, -1)}>↑</button>
              <button type="button" className="icon" aria-label="Move down" disabled={index === project.shots.length - 1} onClick={() => move(index, 1)}>↓</button>
              <button type="button" className="icon" aria-label={`Remove ${shot.title}`} onClick={() => removeShots([shot.id])}>×</button>
            </div>
            <input className="shot-title" value={shot.title} maxLength={LIMITS.shotTitle} onChange={(event) => changeShot(shot.id, { title: event.target.value })}
              placeholder={`Name this ${shot.category.toLowerCase()}`} aria-label="Title" />
            <textarea rows={3} value={shot.description} maxLength={LIMITS.shotDescription} onChange={(event) => changeShot(shot.id, { description: event.target.value })}
              placeholder="What should this piece show?" aria-label="Description" />
          </article>
        ))}
        <div className="add-shot">
          <span className="muted small">{full ? `A sheet holds up to ${LIMITS.shots} portions` : 'Add a portion'}</span>
          <div className="chips">
            {CATEGORIES.map((category) => (
              <button key={category.name} type="button" className="chip" disabled={full}
                onClick={() => setShots((shots) => [...shots, { id: newId(), category: category.name, title: '', description: '' }])}>
                + {category.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
