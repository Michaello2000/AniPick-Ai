import { useEffect, useState, type FormEvent } from 'react';
import type { Anime } from '../shared/model.js';
import { parseTikTokUrl, youtubeSearch, tiktokSearch, type SavedTikTok, type TrailerResponse } from '../shared/media.js';
import { api, errorMessage } from './api.js';
import { Icon } from './icons.js';
import { MediaPlayer } from './MediaPlayer.js';

export function AnimePreviews({ anime }: { anime: Anime }) {
  const [trailer, setTrailer] = useState<TrailerResponse | null>(null);
  const [trailerError, setTrailerError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [videos, setVideos] = useState<SavedTikTok[]>([]);
  const [loadingVideos, setLoadingVideos] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [videoAttempt, setVideoAttempt] = useState(0);
  const [url, setUrl] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api.trailer(anime.id, controller.signal).then(data => { if (!controller.signal.aborted) { setTrailer(data); setTrailerError(null); } })
      .catch(error => { if (!controller.signal.aborted) setTrailerError(errorMessage(error)); });
    return () => controller.abort();
  }, [anime.id, attempt]);
  useEffect(() => {
    const controller = new AbortController();
    api.tiktoks(anime.id, controller.signal).then(data => { if (!controller.signal.aborted) { setVideos(data.videos); setVideoError(null); } })
      .catch(error => { if (!controller.signal.aborted) setVideoError(errorMessage(error)); })
      .finally(() => { if (!controller.signal.aborted) setLoadingVideos(false); });
    return () => controller.abort();
  }, [anime.id, videoAttempt]);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || loadingVideos) return;
    const parsed = parseTikTokUrl(url);
    if (!parsed) { setVideoError('Use a full HTTPS TikTok video link: tiktok.com/@creator/video/VIDEO_ID. Open shortened share links first and copy the full URL.'); return; }
    setSaving(true); setVideoError(null); setNotice(null);
    try {
      const saved = await api.saveTikTok(anime.id, parsed.url);
      setVideos(current => [saved, ...current.filter(video => video.videoId !== saved.videoId)]);
      setUrl(''); setNotice('Video link saved on this computer.');
    } catch (error) { setVideoError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  async function remove(videoId: string) {
    setSaving(true); setVideoError(null); setNotice(null);
    try {
      await api.deleteTikTok(anime.id, videoId);
      setVideos(current => current.filter(video => video.videoId !== videoId));
      setNotice('Saved link removed.');
    } catch (error) { setVideoError(errorMessage(error)); }
    finally { setSaving(false); }
  }
  return <section className="detail-section anime-previews" aria-labelledby="previews-heading">
    <div className="preview-heading"><h3 id="previews-heading">Before you press play</h3><span>Trailers & community picks</span></div>
    <div className="trailer-preview"><h4>Trailer</h4>
      {!trailer && !trailerError && <p className="media-status" role="status"><span className="spinner" />Checking source trailer metadata…</p>}
      {trailerError && <div className="media-error" role="alert"><p>{trailerError}</p><button type="button" className="text-button" onClick={() => { setTrailerError(null); setAttempt(value => value + 1); }}>Retry trailer lookup</button></div>}
      {trailer?.trailer ? <><p className="media-caption">Trailer listed by {trailer.trailer.source}. Promotional videos may reveal story details.</p><MediaPlayer key={trailer.trailer.videoId} kind="youtube" videoId={trailer.trailer.videoId} title={anime.title} externalUrl={`https://www.youtube.com/watch?v=${trailer.trailer.videoId}`} /></> : trailer && <p className="media-caption">No YouTube trailer is listed in the available source metadata. Try searching for an official trailer.</p>}
      {trailer?.warnings.map(warning => <p className="media-caption" key={warning}>{warning}</p>)}
      <a className="source-link" href={youtubeSearch(anime.title)} target="_blank" rel="noreferrer">Search YouTube for a trailer<Icon name="external" size={14} /></a>
    </div>
    <div className="community-preview"><div className="preview-heading"><h4>From the community</h4><a className="source-link" href={tiktokSearch(anime.title)} target="_blank" rel="noreferrer">Find on TikTok<Icon name="external" size={14} /></a></div>
      <p className="media-caption spoiler-note">Reviews, recommendations, and edits may contain spoilers. Saved links are added by you; their relevance and availability are not verified.</p>
      <details className="save-video"><summary>Save a TikTok video<Icon name="plus" size={16} /></summary><form className="video-form" onSubmit={event => { void save(event); }}><label htmlFor="tiktok-url">Full TikTok video URL</label><div><input id="tiktok-url" type="url" inputMode="url" placeholder="https://www.tiktok.com/@creator/video/…" maxLength={500} required autoComplete="off" value={url} onChange={event => setUrl(event.target.value)} disabled={saving || loadingVideos} /><button className="secondary-button" type="submit" disabled={saving || loadingVideos || !url.trim()}>{saving ? 'Saving…' : 'Save link'}</button></div><p className="media-caption">Stored against this anime in your local library. No video is downloaded. Shortened TikTok share links are not supported.</p></form></details>
      {loadingVideos && <p className="media-status" role="status">Opening saved video links…</p>}
      {videoError && <div className="media-error" role="alert"><p>{videoError}</p><button className="text-button" type="button" disabled={saving} onClick={() => { setLoadingVideos(true); setVideoError(null); setVideoAttempt(value => value + 1); }}>Reload saved links</button></div>}
      {notice && <p className="media-status media-success" role="status">{notice}</p>}
      {!loadingVideos && !videoError && videos.length === 0 && <p className="media-caption saved-video-empty">No community videos saved yet. Find a review you like and save its full link here.</p>}
      <div className="saved-videos">{videos.map(video => <article className="saved-video" key={video.videoId}><div className="preview-heading"><h4>@{video.creator}</h4><button type="button" className="text-button" disabled={saving} onClick={() => { void remove(video.videoId); }} aria-label={`Remove saved TikTok video ${video.videoId}`}>Remove link</button></div><MediaPlayer kind="tiktok" videoId={video.videoId} title={`${anime.title} — @${video.creator}`} externalUrl={video.url} /></article>)}</div>
    </div>
  </section>;
}
