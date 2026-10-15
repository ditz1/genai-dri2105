'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { accentFor } from '../lib/route-theme';
import { isLoading } from '../lib/scene-signal';

const background = '#0d100e';
// The board wraps around at its edges, so the camera can glide over it forever; fog hides where it repeats.
const cols = 120;
const rows = 96;
const cellCount = cols * rows;
const cameraHeight = 22;
const cameraBack = -24;
const lookAhead = 10;
const restingFov = 50;
// Generations per second, and cells per second the camera glides, at rest and while a page is loading.
const idle = { generations: 1.2, glide: 0.2 };
const loading = { generations: 32, glide: 14 };

// Small patterns that keep the board alive: gliders and spaceships travel, the rest burst into long-lived chaos.
const patterns = [
  [[1, 0], [2, 1], [0, 2], [1, 2], [2, 2]],
  [[1, 0], [2, 0], [0, 1], [1, 1], [1, 2]],
  [[1, 0], [3, 1], [0, 2], [1, 2], [4, 2], [5, 2], [6, 2]],
  [[1, 0], [4, 0], [0, 1], [0, 2], [4, 2], [0, 3], [1, 3], [2, 3], [3, 3]],
  [[0, 0], [1, 0], [2, 0], [4, 0], [0, 1], [3, 2], [4, 2], [1, 3], [2, 3], [4, 3], [0, 4], [2, 4], [4, 4]],
];

const wrapCol = (col) => ((col % cols) + cols) % cols;
const wrapRow = (row) => ((row % rows) + rows) % rows;

// An endless Game of Life behind every page, with each live cell drawn as a small sphere. It takes on the current
// section's color, runs much faster while a page is loading, and sows new life on every navigation.
export default function Scene() {
  const host = useRef(null);
  const pathname = usePathname();
  const route = useRef({ accent: accentFor(pathname), changedAt: 0, seeded: true });

  useEffect(() => {
    route.current = { accent: accentFor(pathname), changedAt: performance.now(), seeded: false };
  }, [pathname]);

  useEffect(() => {
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
    } catch {
      return undefined;
    }
    const element = host.current;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    element.appendChild(renderer.domElement);

    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const scene = new THREE.Scene();
    scene.fog = new THREE.Fog(background, 24, 70);
    const camera = new THREE.PerspectiveCamera(restingFov, 1, 0.1, 120);
    camera.up.set(0, 0, 1);
    scene.add(new THREE.HemisphereLight('#ffffff', '#1d241f', 0.8));
    const sun = new THREE.DirectionalLight('#ffffff', 1.6);
    sun.position.set(-6, -10, 20);
    scene.add(sun);

    // Cell state: alive now, how many generations it has been alive, and how big its sphere is drawn.
    let cells = new Uint8Array(cellCount);
    let next = new Uint8Array(cellCount);
    const age = new Uint16Array(cellCount);
    const size = new Float32Array(cellCount);

    function place(pattern, col, row) {
      const flipX = Math.random() < 0.5;
      const flipY = Math.random() < 0.5;
      const swap = Math.random() < 0.5;
      pattern.forEach(([x, y]) => {
        const dx = flipX ? -x : x;
        const dy = flipY ? -y : y;
        cells[wrapRow(row + (swap ? dx : dy)) * cols + wrapCol(col + (swap ? dy : dx))] = 1;
      });
    }
    function soup(col, row, radius = 3, density = 0.45) {
      for (let y = -radius; y <= radius; y += 1) {
        for (let x = -radius; x <= radius; x += 1) {
          if (Math.random() < density) cells[wrapRow(row + y) * cols + wrapCol(col + x)] = 1;
        }
      }
    }
    function sow(col, row, count, spread) {
      for (let i = 0; i < count; i += 1) {
        const c = col + Math.round((Math.random() - 0.5) * spread);
        const r = row + Math.round((Math.random() - 0.5) * spread * 0.6);
        if (Math.random() < 0.35) soup(c, r);
        else place(patterns[Math.floor(Math.random() * patterns.length)], c, r);
      }
    }
    for (let i = 0; i < cellCount; i += 1) cells[i] = Math.random() < 0.22 ? 1 : 0;

    // One generation on the wrapped board. Returns how many cells are alive afterwards.
    function step() {
      let population = 0;
      for (let row = 0; row < rows; row += 1) {
        const up = wrapRow(row - 1) * cols;
        const here = row * cols;
        const down = wrapRow(row + 1) * cols;
        for (let col = 0; col < cols; col += 1) {
          const left = col === 0 ? cols - 1 : col - 1;
          const right = col === cols - 1 ? 0 : col + 1;
          const neighbors = cells[up + left] + cells[up + col] + cells[up + right]
            + cells[here + left] + cells[here + right]
            + cells[down + left] + cells[down + col] + cells[down + right];
          const index = here + col;
          const alive = cells[index] ? neighbors === 2 || neighbors === 3 : neighbors === 3;
          next[index] = alive ? 1 : 0;
          population += next[index];
          age[index] = alive ? Math.min(age[index] + 1, 999) : 0;
        }
      }
      [cells, next] = [next, cells];
      return population;
    }

    const accent = new THREE.Color(route.current.accent);
    const targetAccent = new THREE.Color();
    const young = new THREE.Color();
    const old = new THREE.Color();
    const white = new THREE.Color('#ffffff');
    const geometry = new THREE.IcosahedronGeometry(0.36, 1);
    const material = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.45, metalness: 0.2 });
    const spheres = new THREE.InstancedMesh(geometry, material, cellCount);
    spheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    spheres.setColorAt(0, white);
    spheres.instanceColor.setUsage(THREE.DynamicDrawUsage);
    spheres.frustumCulled = false;
    scene.add(spheres);
    const matrices = spheres.instanceMatrix.array;
    const colors = spheres.instanceColor.array;

    const pointer = { x: 0, y: 0, moved: false, lastSeed: 0 };
    const ray = new THREE.Vector3();
    let glide = 0;
    let generations = idle.generations;
    let glideSpeed = idle.glide;
    let pendingSteps = 0;
    let sinceSown = 0;
    let last = performance.now();
    let frame;

    // The board cell under a point on screen (in -1..1 coordinates), found where the camera's ray meets the board.
    function cellAt(x, y) {
      ray.set(x, y, 0.5).unproject(camera).sub(camera.position).normalize();
      if (ray.z >= -0.01) return null;
      const distance = -camera.position.z / ray.z;
      const worldX = camera.position.x + ray.x * distance;
      const worldY = camera.position.y + ray.y * distance;
      return { col: wrapCol(Math.round(worldX + cols / 2)), row: wrapRow(Math.round(worldY + rows / 2 + glide)) };
    }

    function resize() {
      renderer.setSize(window.innerWidth, window.innerHeight);
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
    }
    function trackPointer(event) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
      pointer.moved = true;
    }

    function render(now) {
      frame = requestAnimationFrame(render);
      // A frame's timestamp can be slightly older than the last one recorded, so the step is never negative.
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = Math.max(last, now);
      if (document.hidden) return;

      // Loading runs the board at full speed; arriving on a new page gives it a push that settles back.
      const sinceRoute = Math.max(0, (now - route.current.changedAt) / 1000);
      const push = sinceRoute < 1.4 ? (1 - sinceRoute / 1.4) ** 2 : 0;
      const rush = isLoading() ? 1 : push * 0.6;
      const ease = 1 - Math.exp(-dt * 5);
      generations += ((reducedMotion ? 0 : idle.generations + (loading.generations - idle.generations) * rush) - generations) * ease;
      glideSpeed += ((reducedMotion ? 0 : idle.glide + (loading.glide - idle.glide) * rush) - glideSpeed) * ease;
      glide += glideSpeed * dt;

      camera.fov += (restingFov + rush * 22 - camera.fov) * ease;
      if (!reducedMotion) camera.position.x += (pointer.x * 3 - camera.position.x) * (1 - Math.exp(-dt * 2));
      camera.position.y = cameraBack;
      camera.position.z = cameraHeight - Math.min(window.scrollY * 0.004, 4);
      camera.lookAt(camera.position.x * 0.5, lookAhead, 0);
      camera.updateProjectionMatrix();

      // New life where the viewer is looking on each navigation, and a faint trail behind the pointer.
      if (!route.current.seeded) {
        route.current.seeded = true;
        const center = cellAt(0, 0.1);
        if (center) sow(center.col, center.row, 6, 40);
      }
      if (pointer.moved && !reducedMotion && now - pointer.lastSeed > 90) {
        pointer.moved = false;
        pointer.lastSeed = now;
        const under = cellAt(pointer.x, -pointer.y);
        if (under) {
          for (let i = 0; i < 3; i += 1) {
            cells[wrapRow(under.row + Math.round(Math.random() * 2 - 1)) * cols + wrapCol(under.col + Math.round(Math.random() * 2 - 1))] = 1;
          }
        }
      }

      pendingSteps += generations * dt;
      for (let i = 0; i < 4 && pendingSteps >= 1; i += 1) {
        pendingSteps -= 1;
        const population = step();
        // Left alone, a board settles into sparse still lifes and blinkers, so new patterns are sown somewhere
        // whenever fewer than 8% of cells are alive. That keeps it near 8% alive and always changing.
        sinceSown += 1;
        if (population < cellCount * 0.08 && sinceSown > 6) {
          sinceSown = 0;
          sow(Math.floor(Math.random() * cols), Math.floor(Math.random() * rows), 3, 30);
        }
      }
      pendingSteps = Math.min(pendingSteps, 1);

      accent.lerp(targetAccent.set(route.current.accent), 1 - Math.exp(-dt * 3));
      young.copy(accent).lerp(white, 0.2);
      old.copy(accent).multiplyScalar(0.45);

      // Spheres grow in as cells are born and shrink away as they die, gently at rest and snappily when the board
      // is running fast. Only visible ones are drawn.
      const grow = 1 - Math.exp(-dt * Math.max(2.5, generations * 1.5));
      let drawn = 0;
      for (let row = 0; row < rows; row += 1) {
        const y = wrapRow(row - Math.floor(glide)) - rows / 2 - (glide % 1);
        for (let col = 0; col < cols; col += 1) {
          const index = row * cols + col;
          size[index] += (cells[index] - size[index]) * grow;
          const scale = size[index];
          if (scale < 0.03) continue;
          const offset = drawn * 16;
          matrices[offset] = scale;
          matrices[offset + 5] = scale;
          matrices[offset + 10] = scale;
          matrices[offset + 12] = col - cols / 2;
          matrices[offset + 13] = y;
          matrices[offset + 14] = scale * 0.36;
          matrices[offset + 15] = 1;
          const t = Math.min(age[index] / 14, 1);
          colors[drawn * 3] = young.r + (old.r - young.r) * t;
          colors[drawn * 3 + 1] = young.g + (old.g - young.g) * t;
          colors[drawn * 3 + 2] = young.b + (old.b - young.b) * t;
          drawn += 1;
        }
      }
      spheres.count = drawn;
      spheres.instanceMatrix.needsUpdate = true;
      spheres.instanceColor.needsUpdate = true;

      renderer.render(scene, camera);
    }

    resize();
    window.addEventListener('resize', resize);
    window.addEventListener('pointermove', trackPointer);
    frame = requestAnimationFrame(render);
    element.dataset.ready = 'true';

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener('resize', resize);
      window.removeEventListener('pointermove', trackPointer);
      geometry.dispose();
      material.dispose();
      spheres.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="scene" ref={host} aria-hidden="true" />;
}
