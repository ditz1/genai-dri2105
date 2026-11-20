'use client';

import { createClient } from '../../lib/supabase/client';

let client;

// Removes renders a sheet no longer uses from the member's folder in storage. Nothing waits on it: a file that
// lingers is only wasted space, and deleting the sheet clears its whole folder anyway.
export function discardImages(paths) {
  const unused = paths.filter(Boolean);
  if (!unused.length) return;
  client ??= createClient();
  client.storage.from('generations').remove(unused).then(({ error }) => {
    if (error) console.error('Failed to remove unused renders:', error.message);
  });
}

// Reads an image's pixels at a small size. The bucket allows cross-origin reads, which a canvas needs.
export function imagePixels(url, size = 96) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = size;
        canvas.height = size;
        const context = canvas.getContext('2d', { willReadFrequently: true });
        context.drawImage(image, 0, 0, size, size);
        resolve(context.getImageData(0, 0, size, size).data);
      } catch (error) {
        reject(error);
      }
    };
    image.onerror = () => reject(new Error('The image could not be loaded.'));
    // A separate address from the one <img> tags use, so the browser never reuses a copy fetched without CORS.
    image.src = `${url}?pixels=1`;
  });
}
