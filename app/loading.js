import { ViewTransition } from 'react';
import SceneLoading from './scene-loading';

// Shown the moment a link is clicked, while the page's data loads. The background scene speeds up meanwhile,
// and the placeholder fades away as the real page arrives.
export default function Loading() {
  return (
    <ViewTransition exit="skeleton-out" default="none">
      <main className="feed skeleton" aria-busy="true" aria-label="Loading">
        <SceneLoading />
        <div className="skeleton-title" />
        <div className="skeleton-banner" />
        <div className="posts">
          {Array.from({ length: 6 }, (_, index) => <div className="skeleton-card" key={index} style={{ '--i': index }} />)}
        </div>
      </main>
    </ViewTransition>
  );
}
