// Lets loading screens tell the background scene that a page is on its way. They render in different parts of
// the tree, so they share this module-level counter instead of React state.
let pending = 0;

export function startLoading() {
  pending += 1;
  return () => {
    pending = Math.max(0, pending - 1);
  };
}

export const isLoading = () => pending > 0;
