'use client';

import { usePathname } from 'next/navigation';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { accentFor } from '../lib/route-theme';
import { isLoading } from '../lib/scene-signal';

const background = '#0d100e';
// Shapes and stars drift toward the camera through a tunnel this deep, wrapping around when they pass it.
const near = 4;
const far = -60;
const depth = near - far;
const spread = { x: 22, y: 13 };
const idleSpeed = 0.7;
const loadingSpeed = 30;
const restingFov = 45;

const random = (min, max) => min + Math.random() * (max - min);
const wrap = (z) => ((((z - far) % depth) + depth) % depth) + far;

// Random positions, spins and sizes for `count` floating shapes. Nothing sits right behind the middle of the
// screen, where most of the page's text is.
function scatter(count) {
  return Array.from({ length: count }, () => {
    let x;
    let y;
    do {
      x = random(-spread.x, spread.x);
      y = random(-spread.y, spread.y);
    } while (Math.abs(x) < 4 && Math.abs(y) < 2.5);
    return {
      position: new THREE.Vector3(x, y, random(far, near)),
      rotation: new THREE.Euler(random(0, Math.PI), random(0, Math.PI), 0),
      spin: new THREE.Vector3(random(-0.6, 0.6), random(-0.6, 0.6), random(-0.3, 0.3)),
      scale: random(0.5, 1.4),
    };
  });
}

// A field of low-poly shapes and stars behind every page. It drifts with the pointer and scroll, takes on the
// current section's color, and rushes forward while a page is loading.
export default function Scene() {
  const host = useRef(null);
  const pathname = usePathname();
  const route = useRef({ accent: accentFor(pathname), changedAt: 0 });

  useEffect(() => {
    route.current = { accent: accentFor(pathname), changedAt: performance.now() };
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
    scene.fog = new THREE.Fog(background, 6, 52);
    const camera = new THREE.PerspectiveCamera(restingFov, 1, 0.1, 80);
    const field = new THREE.Group();
    scene.add(field);
    scene.add(new THREE.HemisphereLight('#ffffff', '#1d241f', 0.9));
    const sun = new THREE.DirectionalLight('#ffffff', 1.4);
    sun.position.set(4, 6, 8);
    scene.add(sun);

    const accent = new THREE.Color(route.current.accent);
    const targetAccent = new THREE.Color();
    const solidColor = new THREE.Color();
    const solid = new THREE.MeshStandardMaterial({ flatShading: true, roughness: 0.55, metalness: 0.15 });
    const wire = new THREE.MeshBasicMaterial({ wireframe: true, transparent: true, opacity: 0.4 });
    const geometries = [
      new THREE.IcosahedronGeometry(0.6, 0),
      new THREE.OctahedronGeometry(0.6, 0),
      new THREE.TorusGeometry(0.45, 0.16, 5, 10),
      new THREE.IcosahedronGeometry(0.8, 1),
    ];
    const groups = [
      { mesh: new THREE.InstancedMesh(geometries[0], solid, 28) },
      { mesh: new THREE.InstancedMesh(geometries[1], solid, 28) },
      { mesh: new THREE.InstancedMesh(geometries[2], solid, 20) },
      { mesh: new THREE.InstancedMesh(geometries[3], wire, 20) },
    ];
    groups.forEach((group) => {
      group.items = scatter(group.mesh.count);
      group.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      field.add(group.mesh);
    });

    const starCount = 700;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions.set([random(-spread.x * 1.6, spread.x * 1.6), random(-spread.y * 1.6, spread.y * 1.6), random(far, near)], i * 3);
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const starBase = starPositions.slice();
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({ size: 0.07, color: '#c9d2c7', transparent: true, opacity: 0.75 }));
    field.add(stars);

    const pointer = { x: 0, y: 0 };
    const dummy = new THREE.Object3D();
    let travel = 0;
    let speed = idleSpeed;
    let last = performance.now();
    let frame;

    function resize() {
      const width = window.innerWidth;
      const height = window.innerHeight;
      renderer.setSize(width, height);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
    }
    function trackPointer(event) {
      pointer.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.y = (event.clientY / window.innerHeight) * 2 - 1;
    }

    function render(now) {
      frame = requestAnimationFrame(render);
      // A frame's timestamp can be slightly older than the last one recorded, so the step is never negative.
      const dt = Math.min(Math.max((now - last) / 1000, 0), 0.05);
      last = Math.max(last, now);
      if (document.hidden) return;

      // Loading holds the field at full speed; arriving on a new page gives it a short push that settles back.
      const sinceRoute = Math.max(0, (now - route.current.changedAt) / 1000);
      const push = sinceRoute < 1.2 ? (1 - sinceRoute / 1.2) ** 2 * 18 : 0;
      const target = reducedMotion ? 0 : isLoading() ? loadingSpeed : idleSpeed + push;
      speed += (target - speed) * (1 - Math.exp(-dt * 5));
      travel += speed * dt;

      accent.lerp(targetAccent.set(route.current.accent), 1 - Math.exp(-dt * 3));
      solidColor.copy(accent).multiplyScalar(0.32);
      solid.color.copy(solidColor);
      wire.color.copy(accent);

      const fov = restingFov + Math.min(speed / loadingSpeed, 1) * 30;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      if (!reducedMotion) {
        camera.position.x += (pointer.x * 1.4 - camera.position.x) * (1 - Math.exp(-dt * 2));
        camera.position.y += (-pointer.y * 0.9 - camera.position.y) * (1 - Math.exp(-dt * 2));
        field.rotation.z = window.scrollY * -0.00025;
      }
      camera.lookAt(0, 0, -20);

      const t = now / 1000;
      groups.forEach(({ mesh, items }) => {
        items.forEach((item, index) => {
          dummy.position.set(item.position.x, item.position.y, wrap(item.position.z + travel));
          const spin = reducedMotion ? 0 : t;
          dummy.rotation.set(item.rotation.x + item.spin.x * spin, item.rotation.y + item.spin.y * spin, item.spin.z * spin);
          dummy.scale.setScalar(item.scale);
          dummy.updateMatrix();
          mesh.setMatrixAt(index, dummy.matrix);
        });
        mesh.instanceMatrix.needsUpdate = true;
      });
      for (let i = 0; i < starCount; i += 1) starPositions[i * 3 + 2] = wrap(starBase[i * 3 + 2] + travel * 1.5);
      starGeometry.attributes.position.needsUpdate = true;

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
      geometries.forEach((geometry) => geometry.dispose());
      starGeometry.dispose();
      stars.material.dispose();
      solid.dispose();
      wire.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, []);

  return <div className="scene" ref={host} aria-hidden="true" />;
}
