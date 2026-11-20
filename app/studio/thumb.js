'use client';

import { useState } from 'react';
import { publicImageUrl } from '../../lib/studio/sheet';

// A rendered image, shown from its path in storage. If the file has gone missing it leaves a quiet placeholder.
export default function Thumb({ path, alt = '', onClick }) {
  const [failed, setFailed] = useState(null);
  if (!path || failed === path) return <div className="thumb missing-thumb">Image unavailable</div>;
  const img = <img className="thumb" src={publicImageUrl(path)} alt={alt} loading="lazy" onError={() => setFailed(path)} />;
  return onClick ? <button type="button" className="thumb-button" onClick={onClick}>{img}</button> : img;
}
