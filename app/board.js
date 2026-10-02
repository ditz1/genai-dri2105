'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import Silhouette, { head, shoulders } from './silhouette';

// Wide screens show one row of three and scroll a row at a time; tall screens show a column of three and scroll a card at a time.
const perView = 3;
const rowGap = 4.6;
// Pixels of page scroll that move the board along by one row or card; the snap stops in the spacer use the same step.
const scrollStep = { wide: 480, tall: 320 };
const tallQuery = '(max-aspect-ratio: 115/100)';
const cardWidth = 1.9;
const cardHeight = 2.6;
const cardDepth = 0.28;
const cameraDistance = 10;
const fieldOfView = 35;
const visibleHeight = 2 * cameraDistance * Math.tan(THREE.MathUtils.degToRad(fieldOfView / 2));
// Below this aspect ratio the cards stack vertically; globals.css switches the detail panel at the same point.
const portraitAspect = 1.15;
const accent = new THREE.Color('#b79cf0');
const fontStack = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
// Box faces in Three.js order: right, left, top, bottom, front, back. The front is tinted white so the texture shows as drawn.
const faceColors = ['#2f3a31', '#2f3a31', '#3a473c', '#222a24', '#ffffff', '#161b17'];
const frontFace = 4;

const fullName = (profile) => `${profile.first_name} ${profile.last_name}`;

// Paints the front of a card: the photo (or a blank silhouette) in a square on top, the name underneath.
function drawFace(context, profile, photo) {
  const { width, height } = context.canvas;
  context.fillStyle = '#161b17';
  context.fillRect(0, 0, width, height);
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  if (photo) {
    const side = Math.min(photo.naturalWidth, photo.naturalHeight);
    context.drawImage(photo, (photo.naturalWidth - side) / 2, (photo.naturalHeight - side) / 2, side, side, 0, 0, width, width);
  } else {
    context.fillStyle = '#1d241f';
    context.fillRect(0, 0, width, width);
    const unit = width / 100;
    context.save();
    context.beginPath();
    context.rect(0, 0, width, width);
    context.clip();
    context.fillStyle = '#2f3a31';
    context.beginPath();
    context.arc(head.x * unit, head.y * unit, head.radius * unit, 0, Math.PI * 2);
    context.ellipse(shoulders.x * unit, shoulders.y * unit, shoulders.radiusX * unit, shoulders.radiusY * unit, 0, 0, Math.PI * 2);
    context.fill();
    context.restore();
  }
  const footer = height - width;
  context.fillStyle = profile.placeholder ? '#8a968a' : '#d8e0d6';
  context.font = `40px ${fontStack}`;
  context.fillText(fullName(profile), width / 2, width + footer * (profile.placeholder ? 0.4 : 0.5), width - 48);
  if (profile.placeholder) {
    context.font = `24px ${fontStack}`;
    context.fillText('SAMPLE', width / 2, width + footer * 0.72);
  }
  context.strokeStyle = '#2f3a31';
  context.lineWidth = 6;
  context.strokeRect(3, 3, width - 6, height - 6);
}

function createCard(profile, geometry) {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = Math.round(512 * cardHeight / cardWidth);
  const context = canvas.getContext('2d');
  drawFace(context, profile, null);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;

  let disposed = false;
  if (profile.avatarUrl) {
    const photo = new Image();
    photo.crossOrigin = 'anonymous';
    photo.onload = () => {
      if (disposed) return;
      drawFace(context, profile, photo);
      texture.needsUpdate = true;
    };
    photo.src = profile.avatarUrl;
  }

  const materials = faceColors.map((color, face) => new THREE.MeshBasicMaterial(face === frontFace ? { map: texture } : { color }));
  const mesh = new THREE.Mesh(geometry, materials);
  mesh.scale.setScalar(0.7);
  return {
    id: profile.id,
    mesh,
    materials,
    baseColors: faceColors.map((color) => new THREE.Color(color)),
    dim: 0,
    glow: 0,
    dispose() {
      disposed = true;
      texture.dispose();
      materials.forEach((material) => material.dispose());
    },
  };
}

// Where a card rests when nothing is selected. `scrolled` is how many rows (wide) or cards (tall) the page has scrolled past.
// `away` is how far the card is from the view, in those same units.
function restingPlace(index, count, scrolled, aspect) {
  const visibleWidth = visibleHeight * aspect;
  if (aspect >= portraitAspect) {
    const row = Math.floor(index / perView);
    const inRow = Math.min(perView, count - row * perView);
    const column = index % perView - (inRow - 1) / 2;
    const spacing = Math.min(3.3, visibleWidth / 3.1);
    return { x: column * spacing, y: (scrolled - row) * rowGap - 0.1, scale: Math.min(1, spacing / 2.4), turn: -column * 0.3, away: Math.abs(row - scrolled) };
  }
  const offset = index - (count > perView ? scrolled + (perView - 1) / 2 : (count - 1) / 2);
  const spacing = visibleHeight * 0.8 / 3;
  return { x: 0, y: -offset * spacing - 0.1, scale: Math.min(spacing / 2.9, visibleWidth * 0.8 / cardWidth), turn: 0, away: Math.abs(offset) - 1 };
}

// Where the selected card sits: beside the detail panel on wide screens, above it on tall ones.
function selectedPlace(aspect) {
  return aspect >= portraitAspect ? { x: -1.5, y: 0, scale: 1.3 } : { x: 0, y: 1, scale: 0.95 };
}

export default function Board({ profiles, userId }) {
  const host = useRef(null);
  const hits = useRef([]);
  const live = useRef({});
  const [selected, setSelected] = useState(null);
  const [hovered, setHovered] = useState(null);
  const [failed, setFailed] = useState(false);

  const [tall, setTall] = useState(false);

  const step = tall ? scrollStep.tall : scrollStep.wide;
  const steps = Math.max(0, tall ? profiles.length - perView : Math.ceil(profiles.length / perView) - 1);
  const open = profiles.find((profile) => profile.id === selected);
  live.current = { profiles, step, steps, selected: open ? selected : null, hovered };

  useEffect(() => {
    const query = window.matchMedia(tallQuery);
    const update = () => setTall(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);

  // Scroll the page so the card at `index` is in view; the board follows the page's scroll position.
  function reveal(index) {
    const at = window.scrollY / step;
    const target = tall ? index - 1 : Math.floor(index / perView);
    if (tall ? Math.abs(at - target) < 1.2 : Math.abs(at - target) < 0.3) return;
    window.scrollTo({ top: Math.min(Math.max(target, 0), steps) * step, behavior: 'smooth' });
  }

  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    } catch {
      setFailed(true);
      return undefined;
    }
    const element = host.current;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    element.appendChild(renderer.domElement);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fieldOfView, 1, 0.1, 50);
    camera.position.z = cameraDistance;
    const geometry = new THREE.BoxGeometry(cardWidth, cardHeight, cardDepth);
    // Cards in the scene, keyed by profile id. They are built as they scroll near the view and dropped once far from it.
    const cards = new Map();
    let scrolled = 0;

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const pointer = { x: 0, y: 0 };
    const size = { width: 1, height: 1 };

    function resize() {
      size.width = element.clientWidth || 1;
      size.height = element.clientHeight || 1;
      renderer.setSize(size.width, size.height);
      camera.aspect = size.width / size.height;
      camera.updateProjectionMatrix();
    }
    function trackPointer(event) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    }
    function drop(id, index) {
      const card = cards.get(id);
      scene.remove(card.mesh);
      card.dispose();
      cards.delete(id);
      if (hits.current[index]) hits.current[index].style.visibility = '';
    }
    const observer = new ResizeObserver(resize);
    observer.observe(element);
    resize();
    window.addEventListener('pointermove', trackPointer);

    const corner = new THREE.Vector3();
    const timer = new THREE.Timer();
    renderer.setAnimationLoop((time) => {
      timer.update(time);
      const ease = reducedMotion ? 1 : 1 - Math.exp(-timer.getDelta() * 8);
      const seconds = timer.getElapsed();
      const { profiles: people, step: stepSize, steps: lastStep, selected: selectedId, hovered: hoveredId } = live.current;
      scrolled += (Math.min(Math.max(window.scrollY / stepSize, 0), lastStep) - scrolled) * ease;

      people.forEach((profile, index) => {
        const isSelected = profile.id === selectedId;
        const rest = restingPlace(index, people.length, scrolled, camera.aspect);
        // Only cards in or next to the view are kept in the scene.
        if (rest.away > 1.5 && !isSelected) {
          if (cards.has(profile.id)) drop(profile.id, index);
          return;
        }
        let card = cards.get(profile.id);
        if (!card) {
          card = createCard(profile, geometry);
          card.mesh.position.set(rest.x, rest.y, -1.5);
          scene.add(card.mesh);
          cards.set(profile.id, card);
        }
        const isHovered = profile.id === hoveredId && !isSelected;
        const place = isSelected ? selectedPlace(camera.aspect) : rest;
        const sway = reducedMotion ? 0 : Math.sin(seconds * 0.8 + index * 1.7);
        const tilt = reducedMotion ? { x: 0, y: 0 } : pointer;
        const { mesh } = card;

        mesh.position.x += (place.x - mesh.position.x) * ease;
        mesh.position.y += (place.y + (isSelected ? 0 : sway * 0.04) - mesh.position.y) * ease;
        mesh.position.z += ((isSelected ? 1.5 : isHovered ? 0.5 : selectedId ? -1 : 0) - mesh.position.z) * ease;
        mesh.scale.setScalar(mesh.scale.x + (place.scale * (isHovered ? 1.05 : 1) - mesh.scale.x) * ease);
        mesh.rotation.y += ((isSelected ? 0.22 : rest.turn + sway * 0.1) + tilt.x * 0.2 - mesh.rotation.y) * ease;
        mesh.rotation.x += ((isSelected ? 0 : 0.06) + tilt.y * 0.12 - mesh.rotation.x) * ease;

        card.dim += ((selectedId && !isSelected ? 0.3 : 1) - card.dim) * ease;
        card.glow += ((isSelected ? 1 : isHovered ? 0.5 : 0) - card.glow) * ease;
        card.materials.forEach((material, face) => {
          material.color.copy(card.baseColors[face]);
          if (face !== frontFace) material.color.lerp(accent, card.glow);
          material.color.multiplyScalar(card.dim);
        });

        // Keep each card's real button over its front face so it can be clicked, hovered, and focused.
        const hit = hits.current[index];
        if (!hit) return;
        mesh.updateMatrixWorld();
        let left = Infinity;
        let top = Infinity;
        let right = -Infinity;
        let bottom = -Infinity;
        for (const sx of [-1, 1]) {
          for (const sy of [-1, 1]) {
            corner.set(sx * cardWidth / 2, sy * cardHeight / 2, cardDepth / 2).applyMatrix4(mesh.matrixWorld).project(camera);
            const x = (corner.x + 1) / 2 * size.width;
            const y = (1 - corner.y) / 2 * size.height;
            left = Math.min(left, x);
            right = Math.max(right, x);
            top = Math.min(top, y);
            bottom = Math.max(bottom, y);
          }
        }
        hit.style.visibility = 'visible';
        hit.style.transform = `translate(${left}px, ${top}px)`;
        hit.style.width = `${right - left}px`;
        hit.style.height = `${bottom - top}px`;
      });
      renderer.render(scene, camera);
    });

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      window.removeEventListener('pointermove', trackPointer);
      live.current.profiles.forEach((profile, index) => {
        if (cards.has(profile.id)) drop(profile.id, index);
      });
      geometry.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  useEffect(() => {
    if (!selected) return undefined;
    const close = (event) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [selected]);

  if (failed) {
    return (
      <ul className="fallback">
        {profiles.map((profile) => (
          <li key={profile.id}>
            {profile.avatarUrl
              ? <img src={profile.avatarUrl} alt="" />
              : <Silhouette className="avatar" />}
            <span>{fullName(profile)}</span>
          </li>
        ))}
      </ul>
    );
  }

  return (
    <div className="stage" onClick={() => setSelected(null)}>
      <div className="canvas-host" ref={host} />
      {/* Gives the page its scroll length, with a snap stop for each card the board can start on. */}
      <div className="scroll-track" aria-hidden="true">
        {Array.from({ length: steps }, (unused, stop) => <div key={stop} style={{ height: step }} />)}
        <div className="scroll-end" />
      </div>
      {profiles.map((profile, index) => (
        <button
          key={profile.id}
          ref={(node) => { hits.current[index] = node; }}
          className="hit"
          type="button"
          aria-label={`${fullName(profile)}${profile.placeholder ? ' (sample)' : ''}`}
          aria-expanded={profile.id === selected}
          onClick={(event) => {
            event.stopPropagation();
            setSelected(profile.id === selected ? null : profile.id);
          }}
          onPointerEnter={() => setHovered(profile.id)}
          onPointerLeave={() => setHovered(null)}
          onFocus={() => {
            setHovered(profile.id);
            reveal(index);
          }}
          onBlur={() => setHovered(null)}
        />
      ))}
      {open && (
        <section className="detail" aria-label={`${fullName(open)}'s profile`} aria-live="polite" onClick={(event) => event.stopPropagation()}>
          <h2>{fullName(open)}</h2>
          {open.placeholder
            ? <p>A sample profile. Real members take these spots as they join.</p>
            : (
              <dl>
                <dt>Member since</dt>
                <dd>{open.joined}</dd>
                <dt>Photo</dt>
                <dd>{open.avatarUrl ? 'Uploaded' : 'Not added yet'}</dd>
              </dl>
            )}
          {open.id === userId && <Link href="/profile">This is you — edit your profile</Link>}
          <button type="button" className="secondary" onClick={() => setSelected(null)}>Close</button>
        </section>
      )}
      {steps > 0 && <p className="hint">Scroll for more</p>}
    </div>
  );
}
