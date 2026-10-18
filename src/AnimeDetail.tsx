import { useEffect, useRef, useState } from 'react';
import { providerLabels, statusLabels, type Anime, type AnimeMetadata } from '../shared/model.js';
import { api, errorMessage } from './api.js';
import { Cover } from './AnimeCard.js';
import { Icon } from './icons.js';
import { AnimePreviews } from './AnimePreviews.js';

function readable(value: string | null): string { return value ? value.replaceAll('_', ' ').toLowerCase() : 'Unknown'; }

export function AnimeDetail({ anime, onClose }: { anime: Anime; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [metadata, setMetadata] = useState<AnimeMetadata | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => { element?.close(); };
  }, []);
  useEffect(() => {
    const id = anime.sourceIds.mal;
    if (!id) return;
    const controller = new AbortController();
    api.metadata(id, controller.signal).then(data => { if (!controller.signal.aborted) { setMetadata(data); setFailure(null); } })
      .catch(error => { if (!controller.signal.aborted) setFailure(errorMessage(error)); });
    return () => controller.abort();
  }, [anime.sourceIds.mal, attempt]);
  const genres = [...new Set([...anime.genres, ...(metadata?.genres ?? [])])];
  const tags = [...new Set([...anime.tags, ...(metadata?.tags ?? [])])];
  return <dialog ref={dialog} className="anime-dialog" aria-labelledby="detail-title" onClose={event => { if (!event.currentTarget.open) onClose(); }} onClick={event => { if (event.target === event.currentTarget) dialog.current?.close(); }}>
    <div className="detail-inner">
      <button className="icon-button detail-close" aria-label="Close anime details" autoFocus onClick={() => dialog.current?.close()}><Icon name="close" /></button>
      <div className="detail-heading"><Cover anime={anime} /><div>
        <p className="muted">{readable(anime.format)} · {anime.year ?? 'Year unknown'}</p>
        <h2 id="detail-title">{anime.title}</h2>
        <p className="alternate-title">{[anime.titles.romaji, anime.titles.english, anime.titles.native].filter(title => title && title !== anime.title).join(' / ')}</p>
        <div className="tags">{genres.map(genre => <span key={genre}>{genre}</span>)}</div>
        <dl className="detail-facts">
          <div><dt>Length</dt><dd>{anime.episodes === null ? 'Unknown' : `${anime.episodes} episodes`}</dd></div>
          <div><dt>Airing status</dt><dd>{readable(anime.airingStatus)}</dd></div>
          <div><dt>Community score</dt><dd>{anime.communityScore ? `${anime.communityScore.value} / ${anime.communityScore.scale}` : 'Unrated'}</dd></div>
          <div><dt>Your score</dt><dd>{anime.personalScore ? `${anime.personalScore.value} / ${anime.personalScore.scale}${anime.personalScore.format === 'POINT_3' ? ' (smileys)' : anime.personalScore.format === 'POINT_5' ? ' (stars)' : ''}` : 'Unrated'}</dd></div>
        </dl>
      </div></div>
      <AnimePreviews key={anime.id} anime={anime} />
      <section className="detail-section"><h3>Synopsis</h3><p className="synopsis">{anime.synopsis || metadata?.synopsis || 'No synopsis is available from the source.'}</p></section>
      {tags.length > 0 && <section className="detail-section"><h3>Themes & tags</h3><div className="tags">{tags.slice(0, 24).map(tag => <span key={tag}>{tag}</span>)}</div></section>}
      <section className="detail-section"><h3>On your list</h3><dl className="list-facts">
        <div><dt>Source</dt><dd>{providerLabels[anime.provider]} · {statusLabels[anime.status]}{anime.rewatching ? ' · Rewatching' : ''}</dd></div>
        <div><dt>Progress</dt><dd>{anime.progress} episodes watched · {anime.repeat} rewatches</dd></div>
        <div><dt>Added</dt><dd>{anime.entryCreatedAt ? new Date(anime.entryCreatedAt).toLocaleDateString() : 'Not supplied by provider'}</dd></div>
        <div><dt>Updated</dt><dd>{anime.entryUpdatedAt ? new Date(anime.entryUpdatedAt).toLocaleDateString() : 'Unknown'}</dd></div>
        {anime.startedOn && <div><dt>Started</dt><dd>{anime.startedOn}</dd></div>}
        {anime.completedOn && <div><dt>Completed</dt><dd>{anime.completedOn}</dd></div>}
      </dl></section>
      <div className="detail-footer">
        {metadata ? <p className="muted">Extra metadata: Jikan / MyAnimeList · cached locally.</p> : failure ? <div className="metadata-error"><p>{failure} Your imported details are shown above.</p><button className="text-button" onClick={() => { setFailure(null); setAttempt(value => value + 1); }}>Retry metadata</button></div> : anime.sourceIds.mal ? <p className="muted" role="status">Fetching extra metadata from Jikan…</p> : <p className="muted">Metadata from {providerLabels[anime.provider]}.</p>}
        <a className="source-link" href={anime.provider === 'anilist' ? `https://anilist.co/anime/${anime.sourceIds.anilist}` : `https://myanimelist.net/anime/${anime.sourceIds.mal}`} target="_blank" rel="noreferrer">View on {providerLabels[anime.provider]} <Icon name="external" size={15} /></a>
      </div>
    </div>
  </dialog>;
}
