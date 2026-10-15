// Each section of the site has its own accent color, shared by the navigation and the 3D background.
const accents = {
  people: '#b79cf0',
  posts: '#7fd1c0',
  tournaments: '#f0c674',
  create: '#f09ac0',
  admin: '#f0958a',
};

export function sectionOf(pathname) {
  const first = pathname.split('/')[1] ?? '';
  if (first === 'posts') return 'posts';
  if (first === 'tournaments') return 'tournaments';
  if (first === 'create') return 'create';
  if (first === 'admin') return 'admin';
  return 'people';
}

export const accentFor = (pathname) => accents[sectionOf(pathname)];
