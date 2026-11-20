// Takes a color palette from an image's pixels, so a design sheet can start from the colors of a winning image.
// Pure functions: the browser supplies the pixels (see app/studio/studio.js) and the tests supply their own.

const toHex = (r, g, b) => `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;
// Green differences are the most visible and blue the least.
const distance = (a, b) => 2 * (a[0] - b[0]) ** 2 + 4 * (a[1] - b[1]) ** 2 + 3 * (a[2] - b[2]) ** 2;
const luminance = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;

// Hue names by the angle where each one ends. Orange and yellow have darker everyday names, handled below.
const HUES = [[12, 'Red'], [40, 'Orange'], [64, 'Yellow'], [90, 'Lime'], [165, 'Green'], [200, 'Teal'], [250, 'Blue'], [285, 'Purple'], [325, 'Magenta'], [347, 'Pink'], [360, 'Red']];

// A plain name an image model understands, such as "Deep Teal", "Light Yellow" or "Charcoal". Image models follow
// color words far better than hex codes, so the name says what the color looks like rather than being exact.
export function describeColor([r, g, b]) {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const chroma = max - min;
  const lightness = (max + min) / 510;
  if (chroma < 24) {
    if (lightness < 0.14) return 'Black';
    if (lightness < 0.3) return 'Charcoal';
    if (lightness < 0.42) return 'Dark Grey';
    if (lightness < 0.62) return 'Grey';
    if (lightness < 0.85) return 'Light Grey';
    return lightness < 0.95 ? 'Off-White' : 'White';
  }
  const saturation = chroma / (255 * (1 - Math.abs(2 * lightness - 1)));
  let hue = max === r ? ((g - b) / chroma) % 6 : max === g ? (b - r) / chroma + 2 : (r - g) / chroma + 4;
  hue = (hue * 60 + 360) % 360;
  let name = HUES.find(([end]) => hue < end)[1];
  let tone = lightness < 0.24 ? 'Dark' : lightness < 0.4 ? 'Deep' : lightness > 0.82 ? 'Pale' : lightness > 0.66 ? 'Light' : saturation < 0.3 ? 'Muted' : '';
  // Dark orange is brown, dull yellow-green is olive, and washed-out warm colors are cream or beige.
  if (name === 'Orange' && lightness < 0.45) { name = 'Brown'; tone = lightness < 0.24 ? 'Dark' : ''; }
  else if ((name === 'Yellow' && lightness < 0.42) || (name === 'Lime' && saturation < 0.55)) { name = 'Olive'; tone = lightness < 0.3 ? 'Dark' : lightness > 0.55 ? 'Light' : ''; }
  else if ((name === 'Orange' || name === 'Yellow') && lightness > 0.66 && chroma < 90) return lightness > 0.82 ? 'Cream' : 'Beige';
  else if (name === 'Red' && lightness > 0.66) return lightness > 0.82 ? 'Pale Pink' : 'Pink';
  return tone ? `${tone} ${name}` : name;
}

// The same, for a hex code such as the one a color picker gives.
export function nameColor(hex) {
  const value = parseInt(hex.replace('#', ''), 16);
  return describeColor([(value >> 16) & 255, (value >> 8) & 255, value & 255]);
}

// `pixels` is RGBA bytes, as returned by canvas getImageData. Returns up to `count` colors as { name, hex }, the one
// covering the most of the image first. Colors are chosen to be distinct, so a small vivid accent still makes it in.
export function extractPalette(pixels, count = 5) {
  // Group pixels into coarse buckets (4 bits per channel) and keep each bucket's true average color.
  const buckets = new Map();
  let total = 0;
  for (let i = 0; i + 3 < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    const key = ((pixels[i] >> 4) << 8) | ((pixels[i + 1] >> 4) << 4) | (pixels[i + 2] >> 4);
    const bucket = buckets.get(key) ?? [0, 0, 0, 0];
    bucket[0] += pixels[i]; bucket[1] += pixels[i + 1]; bucket[2] += pixels[i + 2]; bucket[3] += 1;
    buckets.set(key, bucket);
    total += 1;
  }
  if (!total) return [];
  const colors = [...buckets.values()].map(([r, g, b, n]) => ({ rgb: [r / n, g / n, b / n], n }));

  // Start from the most common color, then keep adding the color that is both common and unlike those chosen.
  const centers = [colors.reduce((best, color) => (color.n > best.n ? color : best)).rgb];
  const candidates = colors.filter((color) => color.n >= total * 0.002);
  while (centers.length < count) {
    let best = null;
    let bestScore = 0;
    for (const color of candidates) {
      const score = Math.sqrt(color.n) * Math.min(...centers.map((center) => distance(center, color.rgb)));
      if (score > bestScore) { best = color; bestScore = score; }
    }
    // Stop when what is left is too close to a chosen color to count as a different one.
    if (!best || Math.min(...centers.map((center) => distance(center, best.rgb))) < 1500) break;
    centers.push(best.rgb);
  }

  // Settle each chosen color on the average of the pixels nearest to it, and measure how much of the image it covers.
  let clusters = centers.map((rgb) => ({ rgb, n: 0 }));
  for (let round = 0; round < 4; round += 1) {
    const sums = clusters.map(() => [0, 0, 0, 0]);
    for (const color of colors) {
      let nearest = 0;
      for (let i = 1; i < clusters.length; i += 1) {
        if (distance(clusters[i].rgb, color.rgb) < distance(clusters[nearest].rgb, color.rgb)) nearest = i;
      }
      const sum = sums[nearest];
      sum[0] += color.rgb[0] * color.n; sum[1] += color.rgb[1] * color.n; sum[2] += color.rgb[2] * color.n; sum[3] += color.n;
    }
    clusters = clusters.map((cluster, i) => (sums[i][3] ? { rgb: sums[i].slice(0, 3).map((value) => value / sums[i][3]), n: sums[i][3] } : cluster));
  }
  clusters = clusters.filter((cluster) => cluster.n > 0).sort((a, b) => b.n - a.n);

  // Two colors can earn the same name; the less common one says how it differs from the other.
  const seen = new Map();
  return clusters.map((cluster) => {
    let name = describeColor(cluster.rgb);
    const first = seen.get(name);
    if (first) name = `${name} (${luminance(cluster.rgb) >= luminance(first) ? 'lighter' : 'darker'})`;
    else seen.set(name, cluster.rgb);
    return { name, hex: toHex(...cluster.rgb) };
  });
}
