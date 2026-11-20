'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { cellStatus, cleanModelText, imagePaths, ONCE, plan, shouldRun } from '../../lib/studio/chain';
import { extractPalette } from '../../lib/studio/palette';
import { publicImageUrl } from '../../lib/studio/sheet';
import { deleteSheet } from './actions';
import BoardView from './board-view';
import ChainView from './chain-view';
import Menu from './menu';
import SetupView from './setup-view';
import { discardImages, imagePixels } from './storage';

const TABS = [['setup', 'Art direction'], ['chain', 'Prompt chain'], ['board', 'Design sheet']];

async function send(method, path, body, options) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), ...options });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw Object.assign(new Error(json.error ?? `Request failed (${response.status}).`), { code: json.code });
  return json;
}

async function pool(items, size, worker) {
  const queue = [...items];
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, async () => {
    while (queue.length) await worker(queue.shift());
  }));
}

const cellKey = (stepId, target) => `${stepId}:${target}`;

// The editor for one design sheet: its state, saving, and the runner that walks the chain. The sheet is saved to the
// member's account a moment after every change.
export default function Studio({ sheetId, initial }) {
  const [project, setProject] = useState(initial);
  const projectRef = useRef(initial);
  // A sheet with a winner or with results opens on the sheet itself; a blank one starts with its art direction.
  const [tab, setTab] = useState(initial.source || Object.keys(initial.outputs).length ? 'board' : 'setup');
  const [running, setRunning] = useState({});
  const [errors, setErrors] = useState({});
  const [progress, setProgress] = useState(null);
  const [notice, setNotice] = useState('');
  const [saveState, setSaveState] = useState({ status: 'saved' });
  const [deleting, startDelete] = useTransition();
  const busy = useRef(false);
  const cancelled = useRef(false);
  const saver = useRef({ busy: false, again: false, last: JSON.stringify({ data: initial }) });
  const saveUrl = `/api/studio/sheets/${sheetId}`;

  // The ref is the source of truth so a running chain always reads the latest outputs.
  const update = useCallback((change) => {
    const next = change(projectRef.current);
    projectRef.current = next;
    setProject(next);
  }, []);

  // One save at a time, so an older save can never land after a newer one.
  const save = useCallback(async () => {
    const state = saver.current;
    if (state.busy) {
      state.again = true;
      return;
    }
    const body = { data: projectRef.current };
    const serialized = JSON.stringify(body);
    if (serialized === state.last) return;
    state.busy = true;
    setSaveState({ status: 'saving' });
    try {
      await send('PATCH', saveUrl, body);
      state.last = serialized;
      setSaveState({ status: 'saved' });
    } catch (error) {
      setSaveState({ status: 'error', message: error.message });
    } finally {
      state.busy = false;
      if (state.again) {
        state.again = false;
        save();
      }
    }
  }, [saveUrl]);

  useEffect(() => {
    const timer = setTimeout(save, 700);
    return () => clearTimeout(timer);
  }, [project, save]);

  // Save right away when the tab is hidden or closed, or the member moves to another page, so the last edit is never
  // lost to the delay above.
  useEffect(() => {
    const onHide = () => document.visibilityState === 'hidden' && save();
    const onLeave = () => {
      const serialized = JSON.stringify({ data: projectRef.current });
      if (serialized === saver.current.last) return;
      // A request that outlives the page may carry at most 64 KB.
      fetch(saveUrl, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: serialized, keepalive: serialized.length < 60000 }).catch(() => {});
    };
    window.addEventListener('pagehide', onLeave);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      window.removeEventListener('pagehide', onLeave);
      document.removeEventListener('visibilitychange', onHide);
      save();
    };
  }, [save, saveUrl]);

  // The palette comes from the winning image's own pixels: the first time the sheet opens, and again on request.
  const paletteFromWinner = useCallback(async () => {
    const path = projectRef.current.source?.imagePath;
    if (!path) return;
    try {
      const colors = extractPalette(await imagePixels(publicImageUrl(path)));
      if (!colors.length) throw new Error('No colors found.');
      update((current) => ({ ...current, palette: { name: 'From the winner', colors } }));
    } catch {
      update((current) => ({ ...current, palette: { name: current.palette.name, colors: current.palette.colors } }));
      setNotice("The winning image's colors could not be read, so the palette is a preset. Pick or edit one under Art direction.");
    }
  }, [update]);

  const palettePending = useRef(Boolean(initial.palette.pending && initial.source));
  useEffect(() => {
    if (!palettePending.current) return;
    palettePending.current = false;
    paletteFromWinner();
  }, [paletteFromWinner]);

  const setOutput = useCallback((stepId, target, output) => {
    update((current) => ({ ...current, outputs: { ...current.outputs, [stepId]: { ...current.outputs[stepId], [target]: output } } }));
  }, [update]);

  async function runCell(step, target, cell, { newSeed = false } = {}) {
    const key = cellKey(step.id, target);
    setRunning((current) => ({ ...current, [key]: true }));
    setErrors(({ [key]: _, ...rest }) => rest);
    try {
      if (step.kind === 'text') {
        const { text } = await send('POST', '/api/studio/text', { ...cell.input, sheetId, step: step.name });
        setOutput(step.id, target, { value: cleanModelText(text), signature: cell.signature, at: Date.now() });
      } else {
        const seed = cell.input.seed !== undefined && !newSeed ? cell.input.seed : Math.floor(Math.random() * 2 ** 31);
        const { path } = await send('POST', '/api/studio/image', { ...cell.input, seed, sheetId, step: step.name });
        const previous = projectRef.current.outputs[step.id]?.[target]?.imagePath;
        setOutput(step.id, target, { imagePath: path, seed, prompt: cell.input.prompt, signature: cell.signature, at: Date.now() });
        if (previous && !imagePaths(projectRef.current).includes(previous)) discardImages([previous]);
      }
    } catch (error) {
      // Out of allowance or signed out: nothing else in this run can succeed either.
      if (error.code === 'quota' || error.code === 'auth') {
        cancelled.current = true;
        setNotice(error.message);
      }
      setErrors((current) => ({ ...current, [key]: error.message }));
    } finally {
      setRunning(({ [key]: _, ...rest }) => rest);
    }
  }

  // Runs the chain (or part of it) in order. Text steps run three at a time and image steps two at a time.
  async function run({ onlyStep, onlyTarget, force = false, newSeed = false, label = 'Running chain' } = {}) {
    if (busy.current) return;
    busy.current = true;
    cancelled.current = false;
    const groups = plan(projectRef.current, { onlyStep, onlyTarget });
    const total = groups.reduce((sum, group) => sum + group.targets.length, 0);
    let done = 0;
    setProgress({ done, total, label });
    try {
      for (const group of groups) {
        if (cancelled.current) break;
        const kind = projectRef.current.steps.find((step) => step.id === group.stepId)?.kind;
        await pool(group.targets, kind === 'image' ? 2 : 3, async (target) => {
          const step = projectRef.current.steps.find((item) => item.id === group.stepId);
          // Re-running one portion never re-runs the shared, once-per-sheet steps.
          const forceThis = force && !(onlyTarget && onlyTarget !== ONCE && target === ONCE);
          if (step && !cancelled.current) {
            const cell = cellStatus(projectRef.current, step, target);
            if (shouldRun(cell.status, forceThis)) await runCell(step, target, cell, { newSeed });
          }
          setProgress({ done: ++done, total, label });
        });
      }
    } finally {
      busy.current = false;
      setProgress(null);
      save();
    }
  }

  function removeSheet() {
    if (busy.current || !window.confirm(`Delete "${project.title || 'Untitled'}" and its images?`)) return;
    const form = new FormData();
    form.set('id', sheetId);
    startDelete(() => deleteSheet(form));
  }

  const working = Boolean(progress) || deleting;
  const actions = { update, setOutput, run, running, errors, busy: working, paletteFromWinner };

  return (
    <main className="studio">
      <header className="studio-bar">
        <Link className="studio-back" href="/studio">← Sheets</Link>
        <div className="studio-name">
          <span className="brand-mark" aria-hidden="true">
            {project.palette.colors.slice(0, 4).map((color, index) => <i key={index} style={{ background: color.hex }} />)}
          </span>
          <strong>{project.title || 'Untitled'}</strong>
          <span className={`save-state save-${saveState.status}`} role="status">
            {saveState.status === 'saving' ? 'Saving…' : saveState.status === 'error' ? 'Not saved' : 'Saved'}
          </span>
        </div>
        <nav className="tabs" aria-label="Views">
          {TABS.map(([id, label]) => (
            <button key={id} type="button" className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>{label}</button>
          ))}
        </nav>
        <div className="run-controls">
          {progress ? (
            <>
              <span className="progress-label">{progress.label}</span>
              <div className="progress" role="progressbar" aria-label={progress.label} aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}>
                <span style={{ width: `${(progress.done / Math.max(progress.total, 1)) * 100}%` }} />
              </div>
              <span className="muted small">{progress.done}/{progress.total}</span>
              <button type="button" className="ghost" onClick={() => { cancelled.current = true; }}>Stop</button>
            </>
          ) : (
            <>
              <button type="button" className="ghost" disabled={deleting} onClick={() => run({ force: true, label: 'Re-running everything' })} title="Run every step again, even ones that are up to date">Re-run all</button>
              <button type="button" className="primary" disabled={deleting} onClick={() => { setTab((current) => (current === 'setup' ? 'board' : current)); run(); }} title="Run every step that is new or out of date">Run chain</button>
            </>
          )}
          <Menu label="Sheet actions" trigger={<span aria-hidden="true">•••</span>} items={[
            ...(project.source ? [{ label: 'Take the palette from the winner', onSelect: paletteFromWinner, disabled: working }] : []),
            { label: 'Delete sheet', onSelect: removeSheet, danger: true, disabled: working },
          ]} />
        </div>
      </header>

      {saveState.status === 'error' && (
        <div className="banner" role="alert">
          <span>Your latest changes are not saved: {saveState.message}</span>
          <span className="spacer" />
          <button type="button" className="ghost small" onClick={save}>Try again</button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          <span>{notice}</span>
          <span className="spacer" />
          <button type="button" className="icon" aria-label="Dismiss" onClick={() => setNotice('')}>×</button>
        </div>
      )}

      <div className="view">
        {tab === 'setup' && <SetupView project={project} {...actions} />}
        {tab === 'chain' && <ChainView project={project} {...actions} />}
        {tab === 'board' && <BoardView project={project} {...actions} />}
      </div>
    </main>
  );
}
