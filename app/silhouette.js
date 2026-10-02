// Blank profile picture: a head and shoulders, on a 100×100 grid. app/board.js paints the same shape onto its cards.
export const head = { x: 50, y: 40, radius: 18 };
export const shoulders = { x: 50, y: 102, radiusX: 34, radiusY: 36 };

export default function Silhouette({ className }) {
  return (
    <svg className={className} viewBox="0 0 100 100" aria-hidden="true">
      <circle cx={head.x} cy={head.y} r={head.radius} />
      <ellipse cx={shoulders.x} cy={shoulders.y} rx={shoulders.radiusX} ry={shoulders.radiusY} />
    </svg>
  );
}
