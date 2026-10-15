'use client';

import { useEffect } from 'react';
import { startLoading } from '../lib/scene-signal';

// Tells the background scene a page is loading for as long as this is on screen.
export default function SceneLoading() {
  useEffect(() => startLoading(), []);
  return null;
}
