'use client';

import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';

const characters = ' .,:;i1tfLCG08@';
const fontStack = '"Helvetica Neue", Helvetica, Arial, "Hiragino Sans", "Hiragino Kaku Gothic ProN", "Noto Sans JP", "Yu Gothic", Meiryo, sans-serif';
const lineHeight = 1.25;
const lineGap = 0.12;
const depth = 0.5;
const layers = 16;

// Draws one line of text into a texture; the front face gets a vertical gradient so it shades like a lit surface.
function createLineTexture(text) {
  const size = 160;
  const padding = 24;
  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  const font = `bold ${size}px ${fontStack}`;
  context.font = font;
  canvas.width = Math.ceil(context.measureText(text).width) + padding * 2;
  canvas.height = Math.ceil(size * 1.15);
  context.font = font;
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0.2, '#ffffff');
  gradient.addColorStop(0.8, '#c4c4c4');
  context.fillStyle = gradient;
  context.fillText(text, canvas.width / 2, canvas.height / 2);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return { texture, aspect: canvas.width / canvas.height };
}

// Each atlas tile contains one character, from sparse to dense.
function createAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = 64 * characters.length;
  canvas.height = 64;
  const context = canvas.getContext('2d');
  context.fillStyle = 'black';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = 'white';
  context.font = 'bold 52px monospace';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  [...characters].forEach((character, index) => {
    context.fillText(character, index * 64 + 32, 34);
  });
  const texture = new THREE.CanvasTexture(canvas);
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
}

export default function AsciiScene({ lines, children }) {
  const mount = useRef(null);
  const [status, setStatus] = useState('loading');

  useEffect(() => {
    const host = mount.current;
    let renderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: false, alpha: false });
    } catch {
      setStatus('error');
      return;
    }

    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.domElement.setAttribute('aria-hidden', 'true');
    host.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x000000);
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 100);
    const group = new THREE.Group();
    scene.add(group);
    // Each line is a stack of textured planes: a bright front and darker copies behind it that read as extruded sides.
    const disposables = [];
    const step = lineHeight + lineGap;
    lines.forEach((line, index) => {
      const { texture, aspect } = createLineTexture(line);
      const geometry = new THREE.PlaneGeometry(lineHeight * aspect, lineHeight);
      const front = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5 });
      const side = new THREE.MeshBasicMaterial({ map: texture, alphaTest: 0.5, color: 0x242424 });
      disposables.push(texture, geometry, front, side);
      const y = ((lines.length - 1) / 2 - index) * step;
      for (let layer = 0; layer < layers; layer += 1) {
        const plane = new THREE.Mesh(geometry, layer === 0 ? front : side);
        plane.position.set(0, y, -layer * depth / (layers - 1));
        group.add(plane);
      }
    });
    const bounds = new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3());

    const target = new THREE.WebGLRenderTarget(1, 1, {
      minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter,
      depthBuffer: true, stencilBuffer: false,
    });
    const atlas = createAtlas();
    const ascii = new THREE.ShaderMaterial({
      depthTest: false,
      depthWrite: false,
      uniforms: {
        image: { value: target.texture },
        atlas: { value: atlas },
        grid: { value: new THREE.Vector2(1, 1) },
        count: { value: characters.length },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: `
        uniform sampler2D image;
        uniform sampler2D atlas;
        uniform vec2 grid;
        uniform float count;
        varying vec2 vUv;
        void main() {
          vec2 cell = floor(vUv * grid);
          vec3 source = texture2D(image, (cell + 0.5) / grid).rgb;
          float luminance = dot(source, vec3(0.299, 0.587, 0.114));
          float level = floor(clamp(pow(luminance, 0.65), 0.0, 1.0) * (count - 1.0));
          vec2 local = fract(vUv * grid);
          float glyph = texture2D(atlas, vec2((level + local.x) / count, local.y)).r;
          vec3 background = vec3(0.051, 0.063, 0.055);
          vec3 ink = mix(vec3(0.34, 0.49, 0.28), vec3(0.79, 0.96, 0.58), clamp(luminance, 0.0, 1.0));
          gl_FragColor = vec4(mix(background, ink, glyph), 1.0);
        }
      `,
    });
    const screen = new THREE.Scene();
    const quadGeometry = new THREE.PlaneGeometry(2, 2);
    screen.add(new THREE.Mesh(quadGeometry, ascii));
    const screenCamera = new THREE.Camera();
    let width = 1;
    let height = 1;
    const updateGrid = () => {
      const columns = Math.max(1, Math.floor(width / 7));
      const rows = Math.max(1, Math.floor(height / 9.8));
      target.setSize(columns, rows);
      ascii.uniforms.grid.value.set(columns, rows);
    };
    const resize = () => {
      width = Math.max(host.clientWidth, 1);
      height = Math.max(host.clientHeight, 1);
      renderer.setSize(width, height);
      camera.aspect = width / height;
      // Fit every line with room for the extruded sides and pointer movement.
      const tangent = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
      camera.position.z = 1.08 * Math.max(bounds.y / 2 / tangent, bounds.x / 2 / (tangent * camera.aspect)) + depth;
      camera.updateProjectionMatrix();
      updateGrid();
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    const pointer = new THREE.Vector2();
    const move = (event) => {
      const bounds = host.getBoundingClientRect();
      pointer.set((event.clientX - bounds.left) / width * 2 - 1, (event.clientY - bounds.top) / height * 2 - 1);
    };
    const leave = () => pointer.set(0, 0);
    host.addEventListener('pointermove', move);
    host.addEventListener('pointerleave', leave);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const contextLost = (event) => {
      event.preventDefault();
      renderer.setAnimationLoop(null);
      setStatus('error');
    };
    renderer.domElement.addEventListener('webglcontextlost', contextLost);

    let previous = 0;
    let time = 0;
    renderer.setAnimationLoop((now) => {
      const delta = previous ? Math.min((now - previous) / 1000, 0.05) : 0;
      previous = now;
      if (!reducedMotion.matches) {
        time += delta;
        const ease = 1 - Math.exp(-4 * delta);
        group.rotation.y += (-0.2 + Math.sin(time * 0.5) * 0.24 + pointer.x * 0.35 - group.rotation.y) * ease;
        group.rotation.x += (-0.08 + Math.cos(time * 0.4) * 0.07 + pointer.y * 0.18 - group.rotation.x) * ease;
        group.rotation.z = -0.025 + Math.sin(time * 0.3) * 0.018;
      }
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(null);
      renderer.render(screen, screenCamera);
    });
    group.rotation.set(-0.08, -0.2, -0.025);
    setStatus('ready');

    return () => {
      renderer.setAnimationLoop(null);
      observer.disconnect();
      host.removeEventListener('pointermove', move);
      host.removeEventListener('pointerleave', leave);
      renderer.domElement.removeEventListener('webglcontextlost', contextLost);
      disposables.forEach((item) => item.dispose());
      quadGeometry.dispose();
      ascii.dispose();
      atlas.dispose();
      target.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [lines]);

  return (
    <main aria-label="Interactive ASCII rendering of 3D text saying hello world">
      <h1 className="sr-only">hello world</h1>
      {children}
      <div className="canvas-host" ref={mount} />
      {status === 'error' && <p className="sr-only" role="status">WebGL is unavailable. Enable hardware acceleration and reload to see the 3D text.</p>}
    </main>
  );
}
