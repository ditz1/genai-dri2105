// Built-in palettes, styles and portion categories. Everything here is plain data shared by the UI and tests.

export const PALETTES = [
  { name: 'Storybook Meadow', colors: [['Meadow Green', '#5a9e4b'], ['Sky Blue', '#7ec4e8'], ['Warm Stone', '#d8c3a0'], ['Roof Red', '#c8553d'], ['Hero Gold', '#f2c14e']] },
  { name: 'Teal & Rust', colors: [['Abyss Teal', '#12343b'], ['Sea Glass', '#2d6e6e'], ['Pale Jade', '#6fb3a8'], ['Rust', '#c56b3c'], ['Parchment', '#e8d5b5']] },
  { name: 'Ember Forest', colors: [['Pine Shadow', '#1f2d24'], ['Moss', '#3e5c3a'], ['Ember', '#c4622d'], ['Amber', '#e8a33d'], ['Bone', '#f2e3c6']] },
  { name: 'Neon Noir', colors: [['Midnight', '#0d0b1e'], ['Ultraviolet', '#2a1b5c'], ['Hot Magenta', '#ff2e88'], ['Electric Cyan', '#19d3f2'], ['Haze White', '#f5f3ff']] },
  { name: 'Desert Ruins', colors: [['Umber', '#5b3a29'], ['Terracotta', '#a0643b'], ['Sandstone', '#d9a066'], ['Bleached Sand', '#efd9b4'], ['Dusty Sky', '#6f8f9c']] },
  { name: 'Arctic Dawn', colors: [['Frost', '#e8f1f5'], ['Glacier', '#a9cbe0'], ['Ice Blue', '#5b8fb9'], ['Deep Fjord', '#2d4a6b'], ['Dawn Pink', '#f2b5a7']] },
  { name: 'Volcanic', colors: [['Obsidian', '#1a1110'], ['Oxblood', '#4a1c1a'], ['Lava Red', '#b3261e'], ['Molten Orange', '#f06c26'], ['Sulfur', '#ffd166']] },
  { name: 'Pastel Dream', colors: [['Blush', '#f7d6e0'], ['Mint', '#b8e0d2'], ['Pale Sage', '#d6eadf'], ['Lilac', '#eac4d5'], ['Powder Blue', '#95b8d1']] },
  { name: 'Ink & Paper', colors: [['Ink Black', '#111111'], ['Graphite', '#3a3a3a'], ['Ash Grey', '#7a7a7a'], ['Silver', '#c9c9c9'], ['Rice Paper', '#f4f1ea']] },
];

// Each style has the descriptor that is actually sent to the models.
export const STYLES = [
  { name: 'Low poly', prompt: 'low poly 3D, faceted flat-shaded geometry' },
  { name: 'Semi-realistic', prompt: 'semi-realistic, stylized proportions with realistic materials' },
  { name: 'Realistic', prompt: 'photorealistic, physically based materials, cinematic realism' },
  { name: 'Hand-painted', prompt: 'stylized hand-painted textures, visible brush strokes' },
  { name: 'Painterly', prompt: 'painterly digital painting, loose expressive brushwork' },
  { name: 'Cel-shaded', prompt: 'cel-shaded, bold outlines, flat color bands' },
  { name: 'Anime-inspired', prompt: 'anime-inspired illustration, clean linework' },
  { name: 'Pixel art', prompt: 'detailed pixel art, limited palette, crisp pixels' },
  { name: 'Voxel', prompt: 'voxel art, cubic blocks' },
  { name: 'Isometric', prompt: 'isometric view, diorama' },
  { name: 'Watercolor', prompt: 'watercolor, soft washes, paper texture' },
  { name: 'Ink & line', prompt: 'ink line art, cross-hatching' },
  { name: 'Gouache', prompt: 'gouache illustration, matte opaque paint' },
  { name: 'Claymation', prompt: 'claymation, sculpted clay, fingerprint texture' },
  { name: 'Dark fantasy', prompt: 'dark fantasy, moody, dramatic chiaroscuro' },
  { name: 'Retro sci-fi', prompt: 'retro-futurist sci-fi, 1970s paperback illustration' },
];

// Portion categories are the usual building blocks of a game world. Each has framing words that keep its
// image readable as a concept piece. Older projects may use a retired category; LEGACY_CATEGORIES maps it.
export const CATEGORIES = [
  { name: 'Character', framing: 'full-body character concept, front three-quarter view, neutral standing pose, plain neutral background' },
  { name: 'Creature', framing: 'full-body creature or enemy concept, side three-quarter view, plain neutral background' },
  { name: 'Building', framing: 'building concept, exterior three-quarter view, whole structure in frame, clear silhouette, plain background' },
  { name: 'Environment', framing: 'wide establishing shot environment concept, readable paths and landmarks, strong depth and atmosphere' },
  { name: 'Weapon', framing: 'single weapon concept, isolated object, side view, whole weapon in frame, plain neutral background' },
  { name: 'Item', framing: 'single item or collectible concept, isolated object, centered, plain neutral background' },
  { name: 'Vehicle', framing: 'vehicle or mount concept, three-quarter view, plain neutral background' },
  { name: 'Key art', framing: 'cinematic key art, dramatic wide composition' },
];

export const LEGACY_CATEGORIES = { Prop: 'Item', Architecture: 'Building' };

export function categoryFraming(name) {
  const category = CATEGORIES.find((item) => item.name === (LEGACY_CATEGORIES[name] ?? name));
  return category?.framing ?? '';
}

// A general starter set: one of each core game asset.
export const STARTER_SHOTS = [
  { category: 'Character', title: 'Hero', description: 'The young adventurer the player controls, ready to set out with a simple tunic, satchel and boots.' },
  { category: 'Building', title: 'House', description: 'A cozy village house with a chimney, a wooden door and a small garden out front.' },
  { category: 'Environment', title: 'Overworld', description: 'Rolling fields and a forest edge, with a dirt path leading toward distant ruins on a hill.' },
  { category: 'Weapon', title: 'Sword', description: 'The hero\'s trusty sword, with a simple guard and a wrapped leather grip.' },
  { category: 'Creature', title: 'Enemy', description: 'A common enemy the hero fights early on, small and mischievous but clearly hostile.' },
];

// The starter set for a sheet grown from a tournament winner. The descriptions name a role and leave the specifics
// to the chain, which designs each piece inside the world of the winning image.
export const WINNER_SHOTS = [
  { category: 'Character', title: 'Hero', description: 'The main character the player controls: someone who belongs to this world and could have stepped out of the winning image.' },
  { category: 'Environment', title: 'Home region', description: 'The signature place of this world, where the adventure begins. A wide view that could contain the scene from the winning image.' },
  { category: 'Building', title: 'Landmark', description: 'The most recognisable structure in this world: a home, workshop, temple or tower its inhabitants gather around.' },
  { category: 'Creature', title: 'Rival', description: 'A creature or adversary native to this world that the hero has to deal with early on.' },
  { category: 'Item', title: 'Signature item', description: 'The object this world is known for: a tool, treasure or weapon the hero carries.' },
];

export const ASPECTS = {
  '1:1': [1024, 1024],
  '4:3': [1024, 768],
  '3:4': [768, 1024],
  '16:9': [1280, 720],
  '9:16': [720, 1280],
};
