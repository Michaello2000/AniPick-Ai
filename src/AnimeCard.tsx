import { useState } from 'react';
import type { Anime } from '../shared/model.js';
import { Icon } from './icons.js';

export function Cover({ anime, className = '' }: { anime: Anime; className?: string }) {
  const [failed, setFailed] = useState(false);
  return <div className={`cover ${className}`}>
    {anime.poster && !failed ? <img src={anime.poster} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(true)} /> : <div className="cover-fallback"><Icon name="library" size={32} /><span>Cover unavailable</span></div>}
  </div>;
}

export function AnimeCard({ anime, onOpen }: { anime: Anime; onOpen: () => void }) {
  return <button className="anime-card" onClick={onOpen} aria-label={`Details for ${anime.title}`}>
    <div className="poster-wrap">
      <Cover anime={anime} />
      {anime.communityScore && <span className="score-badge" title={`Community score: ${anime.communityScore.value} / ${anime.communityScore.scale}`}><Icon name="star" size={12} /> {(anime.communityScore.value / anime.communityScore.scale * 10).toFixed(1)}<span className="sr-only"> community score out of 10</span></span>}
      <span className="card-open"><Icon name="arrow" size={18} /></span>
    </div>
    <h3>{anime.title}</h3>
    <p className="card-meta">{anime.format?.replaceAll('_', ' ') ?? 'Unknown format'}<span aria-hidden="true"> · </span>{anime.episodes === null ? 'Episodes unknown' : `${anime.episodes} ep${anime.episodes === 1 ? '' : 's'}`}</p>
    <p className="card-genre">{anime.genres.slice(0, 2).join(' / ') || 'Genres unknown'}</p>
  </button>;
}
