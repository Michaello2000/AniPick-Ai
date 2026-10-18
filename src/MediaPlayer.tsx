import { useEffect, useRef, useState } from 'react';
import { z } from 'zod';
import { playerUrl } from '../shared/media.js';
import { Icon } from './icons.js';

const playerMessage = z.discriminatedUnion('type', [
  z.object({ 'x-tiktok-player': z.literal(true), type: z.literal('onPlayerReady') }),
  z.object({ 'x-tiktok-player': z.literal(true), type: z.literal('onPlayerError'), value: z.object({ errorCode: z.number(), errorType: z.string() }) }),
  z.object({ 'x-tiktok-player': z.literal(true), type: z.literal('onError'), value: z.number() }),
]);

export function MediaPlayer({ kind, videoId, title, externalUrl }: {
  kind: 'youtube' | 'tiktok'; videoId: string; title: string; externalUrl: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [active, setActive] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'slow' | 'error'>('loading');
  const provider = kind === 'youtube' ? 'YouTube' : 'TikTok';
  useEffect(() => {
    if (!active) return;
    const timer = setTimeout(() => setStatus(current => current === 'loading' ? 'slow' : current), 15000);
    function receive(event: MessageEvent<unknown>) {
      if (kind !== 'tiktok' || event.origin !== 'https://www.tiktok.com' || event.source !== frame.current?.contentWindow) return;
      const parsed = playerMessage.safeParse(event.data);
      if (parsed.success) setStatus(parsed.data.type === 'onPlayerReady' ? 'ready' : 'error');
    }
    window.addEventListener('message', receive);
    return () => { clearTimeout(timer); window.removeEventListener('message', receive); };
  }, [active, attempt, kind]);
  function retry() { setStatus('loading'); setAttempt(value => value + 1); }

  return <div className={`media-player ${kind}`}>
    {!active ? <button className="media-launch" type="button" onClick={() => { setStatus('loading'); setActive(true); }}><span className="media-play-icon"><Icon name="play" size={24} /></span><span>Load {kind === 'youtube' ? 'trailer' : 'TikTok preview'}<small>Connects to {provider}. Playback stays off until you press play.</small></span></button> : <>
      {status !== 'error' && <div className="media-frame"><iframe key={attempt} ref={frame} src={playerUrl(kind, videoId)} title={`${title} — ${provider} preview`} loading="lazy" allow={kind === 'youtube' ? 'encrypted-media; fullscreen; picture-in-picture' : 'fullscreen'} allowFullScreen referrerPolicy="strict-origin-when-cross-origin" onLoad={() => setStatus(current => current === 'error' ? current : 'ready')} onError={() => setStatus('error')} /></div>}
      {status === 'loading' && <p className="media-status" role="status"><span className="spinner" />Loading {provider} player…</p>}
      {status === 'slow' && <p className="media-status" role="status">The player is taking longer than expected. Try the original video or reload the player.</p>}
      {status === 'error' && <p className="media-error" role="alert">This video could not be played. It may be private, removed, restricted in your region, or blocked by your browser.</p>}
      <div className="media-player-actions">{(status === 'error' || status === 'slow') && <button type="button" className="text-button" onClick={retry}>Reload player</button>}<button type="button" className="text-button" onClick={() => setActive(false)}>Hide player</button></div>
    </>}
    <a className="source-link" href={externalUrl} target="_blank" rel="noreferrer">Open on {provider}<Icon name="external" size={14} /></a>
    {active && kind === 'youtube' && <p className="media-caption">If YouTube reports a playback restriction, use the original video or trailer search below.</p>}
  </div>;
}
