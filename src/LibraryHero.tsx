import type { Anime, Library } from '../shared/model.js';
import { Cover } from './AnimeCard.js';
import { Icon } from './icons.js';

export function LibraryHero({ library, onPick, onImport, onOpen }: {
  library: Library | null;
  onPick: () => void;
  onImport: () => void;
  onOpen: (anime: Anime) => void;
}) {
  const covers = library?.entries.filter(anime => anime.status === 'planning' && anime.poster).slice(0, 5) ?? [];
  return <section className={`library-hero ${covers.length ? 'has-art' : ''}`} aria-labelledby="library-intro">
    <div className="hero-copy">
      <h1 id="library-intro">So many stories.<br /><span>What’s next?</span></h1>
      <p>{library ? 'Your collection. Your taste. A little help choosing the one worth pressing play on.' : 'Bring your anime watchlist. Find your next favorite among the stories you already want to see.'}</p>
      {library ? <a className="primary-button hero-action" href="#pick-for-me" onClick={onPick}><Icon name="shuffle" size={18} />Pick for Me<Icon name="arrow" size={18} /></a> : <a className="primary-button hero-action" href="#library-manager" onClick={onImport}>Bring your list<Icon name="arrow" size={18} /></a>}
      <span className="hero-footnote">{library ? 'Personal picks from your Plan to Watch.' : 'AniList or MyAnimeList. No account to create.'}</span>
    </div>
    {covers.length > 0 && <div className="hero-shelf">
      <div className="hero-posters">{covers.map(anime => <button className="hero-poster" key={anime.id} onClick={() => onOpen(anime)} aria-label={`Details for ${anime.title}`} title={anime.title}><Cover anime={anime} /></button>)}</div>
      <p>Waiting in your Plan to Watch<Icon name="arrow" size={14} /></p>
    </div>}
  </section>;
}
