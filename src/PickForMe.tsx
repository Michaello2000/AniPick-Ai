import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { statusLabels, type Anime, type Library } from '../shared/model.js';
import { moodLabels, recommendationPreferencesSchema, type RecommendationContext, type RecommendationPreferences, type RecommendationResponse } from '../shared/recommendations.js';
import { api, errorMessage } from './api.js';
import { Cover } from './AnimeCard.js';
import { Icon } from './icons.js';
import { lengths } from './length-options.js';

interface PickProps { library: Library; onOpen: (anime: Anime) => void }

function HistoryEvidence({ ids, entries, onOpen }: { ids: string[]; entries: Map<string, Anime>; onOpen: PickProps['onOpen'] }) {
  return <ul className="history-evidence">{ids.map(id => {
    const anime = entries.get(id);
    return anime ? <li key={id}><button type="button" className="text-button" onClick={() => onOpen(anime)}>{anime.title}</button><span>{statusLabels[anime.status]} · {anime.personalScore ? `Your score ${anime.personalScore.value}/${anime.personalScore.scale}` : 'Unrated'}</span></li> : null;
  })}</ul>;
}

export function PickForMe({ library, onOpen }: PickProps) {
  const [context, setContext] = useState<RecommendationContext | null>(null);
  const [preferences, setPreferences] = useState<RecommendationPreferences>(() => recommendationPreferencesSchema.parse({}));
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [connection, setConnection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [contextAttempt, setContextAttempt] = useState(0);
  const [result, setResult] = useState<{ preferencesKey: string; response: RecommendationResponse } | null>(null);
  const requestController = useRef<AbortController | null>(null);
  const entries = useMemo(() => new Map(library.entries.map(anime => [anime.id, anime])), [library.entries]);
  const preferencesKey = JSON.stringify(preferences);
  const current = result?.preferencesKey === preferencesKey ? result.response : null;
  const preview = useMemo(() => library.entries.filter(anime => anime.status === 'planning' && anime.poster).slice(0, 3), [library.entries]);

  useEffect(() => {
    const controller = new AbortController();
    api.recommendationContext(library.id, controller.signal).then(data => {
      if (!controller.signal.aborted) { setContext(data); setError(null); }
    }).catch(failure => { if (!controller.signal.aborted) setError(errorMessage(failure)); });
    return () => controller.abort();
  }, [library.id, contextAttempt]);
  useEffect(() => () => requestController.current?.abort(), []);

  function updatePreference(update: Partial<RecommendationPreferences>) { setPreferences(current => ({ ...current, ...update })); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!consent || busy) return;
    const controller = new AbortController();
    requestController.current = controller;
    setBusy(true); setError(null);
    try {
      const response = await api.recommend({ libraryId: library.id, preferences, allowCloudProcessing: true }, controller.signal);
      if (!controller.signal.aborted) setResult({ preferencesKey, response });
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error && failure.name === 'TimeoutError' ? 'AI analysis took too long. Try again in a moment or narrow your preferences. Your saved list is unchanged.' : errorMessage(failure));
    } finally { if (!controller.signal.aborted) setBusy(false); }
  }
  async function checkConnection() {
    setChecking(true); setConnection(null); setError(null);
    try { const status = await api.checkAi(); setConnection(status.message); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setChecking(false); }
  }

  return <section id="pick-for-me" className="pick-section" aria-labelledby="pick-heading">
    <div className="pick-heading"><div><h1 id="pick-heading">Find your next<br /><span>favorite.</span></h1><p>A story for your mood, chosen from your own Plan to Watch.</p></div>{preview.length > 0 && <div className="pick-preview"><div>{preview.map(anime => <button key={anime.id} type="button" onClick={() => onOpen(anime)} aria-label={`Details for ${anime.title}`}><Cover anime={anime} /></button>)}</div><p>Your Plan to Watch</p></div>}</div>
    {!context ? <p className="pick-note" role="status">{error ? 'AI settings could not be loaded. Your Library tab is still available.' : 'Checking AI settings…'}</p> : <>
      {!context.ai.configured && <div className="configuration-note" role="status"><Icon name="sliders" size={18} /><p>{context.ai.message}</p></div>}
      {context.totalPlanning === 0 && <p className="pick-note">Add titles to Plan to Watch on your list provider and refresh your library to get suggestions.</p>}
      <form onSubmit={event => { void submit(event); }}>
        <fieldset className="pick-fields" disabled={busy || checking}>
          <legend className="sr-only">Recommendation preferences</legend>
          <fieldset className="pick-length"><legend className="field-label">How long a story?</legend><div className="length-options">{lengths.map(length => <button type="button" key={length.value} title={length.boundary} aria-label={`${length.label}: ${length.boundary}`} aria-pressed={preferences.length === length.value} className={preferences.length === length.value ? 'active' : ''} onClick={() => updatePreference({ length: length.value })}>{length.label}</button>)}</div></fieldset>
          <label><span className="field-label">What are you in the mood for?</span><select value={preferences.mood} onChange={event => updatePreference({ mood: recommendationPreferencesSchema.shape.mood.parse(event.target.value) })}>{Object.entries(moodLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <p className="pick-boundaries">The whole story, not tonight’s free time. ≤12, ≤24, movie, or ≥25 episodes. Unknown lengths match No limit, or Movie when the format is known.</p>
          <details className="advanced-preferences"><summary>Advanced preferences</summary><div className="advanced-fields">
            <label><span className="field-label">Genre</span><select value={preferences.genre} onChange={event => updatePreference({ genre: event.target.value })}><option value="">Any genre</option>{context.genres.map(genre => <option key={genre}>{genre}</option>)}</select></label>
            <label><span className="field-label">Airing status</span><select value={preferences.airing} onChange={event => updatePreference({ airing: recommendationPreferencesSchema.shape.airing.parse(event.target.value) })}><option value="any">Any status, including unknown</option><option value="finished">Finished</option><option value="airing">Currently airing</option><option value="upcoming">Not yet aired</option></select></label>
            <label><span className="field-label">Number of suggestions</span><select value={preferences.maxResults} onChange={event => updatePreference({ maxResults: Number(event.target.value) })}><option value={5}>Up to 5</option><option value={3}>Up to 3</option><option value={1}>Just one</option></select></label>
            <div className="dub-preference"><label className="checkbox-label"><input type="checkbox" disabled={context.verifiedDubs === 0} checked={preferences.englishDub === 'verified'} onChange={event => updatePreference({ englishDub: event.target.checked ? 'verified' : 'any' })} />Verified English dub only</label><p>{context.verifiedDubs > 0 ? `${context.verifiedDubs} Plan to Watch titles have an attributable dub record.` : 'English dub availability: Unknown. No verified dub source is connected, so this filter is unavailable.'}</p></div>
          </div></details>
          <div className="pick-submit-row"><label className="checkbox-label cloud-consent"><input type="checkbox" checked={consent} onChange={event => setConsent(event.target.checked)} /><span>I agree to send selected watch history, personal ratings, and anime metadata to {context.ai.provider} for analysis.<small>Your username and private notes stay on this computer.</small></span></label>
          <button className="primary-button pick-button" type="submit" disabled={!context.ai.configured || !consent || context.totalPlanning === 0}>{busy ? <><span className="spinner" />Finding your pick…</> : <><Icon name="shuffle" size={18} />Pick for Me <Icon name="arrow" size={18} /></>}</button></div>
        </fieldset>
      </form>
      <details className="ai-settings"><summary><Icon name="sliders" size={15} />AI settings & privacy<Icon name="chevron" size={14} /></summary><div className="ai-settings-content"><div className="ai-configuration"><p>{context.ai.configured ? <>{context.ai.provider} · <span>{context.ai.model}</span></> : context.ai.message}</p>{context.ai.configured && <button type="button" className="text-button" disabled={busy || checking} onClick={() => { void checkConnection(); }}>{checking ? 'Checking…' : 'Test AI connection'}</button>}</div><p className="pick-note">At most 16 history entries and 24 eligible titles are selected, with shortened descriptions. Requesting fewer suggestions uses a smaller candidate sample. Your username, posters, notes, and community ratings are not sent. This is cloud inference.</p></div></details>
    </>}
    {busy && <p className="pick-note" role="status" aria-live="polite">Analyzing your history, then ranking eligible titles. This can take up to two minutes. You can switch to Library while this runs.</p>}
    {connection && <p className="pick-note" role="status">{connection}</p>}
    {error && <div className="pick-error" role="alert"><p>{error}</p>{!context && <button className="text-button" onClick={() => setContextAttempt(value => value + 1)}>Retry AI settings</button>}</div>}
    {result && !current && <p className="pick-note" role="status">Preferences changed. Choose Pick for Me to get suggestions for these preferences.</p>}
    {current && <div className="pick-results" aria-live="polite">
      <h2>A few stories for you.</h2>
      <p className="analysis-provenance">{current.cached ? 'Saved analysis' : 'New AI analysis'} · {new Date(current.createdAt).toLocaleString()} · {current.model}{current.profileCached ? ' · Taste profile reused' : ''}</p>
      <div className="recommendation-list">{current.recommendations.map((recommendation, index) => {
        const anime = entries.get(recommendation.candidate_id);
        return anime?.status === 'planning' ? <article className="recommendation" key={anime.id}>
          <button className="recommendation-cover" type="button" onClick={() => onOpen(anime)} aria-label={`Details for ${anime.title}`}><Cover anime={anime} /></button>
          <div><p className="recommendation-position">Choice {index + 1} · {recommendation.confidence} confidence</p><h3><button type="button" onClick={() => onOpen(anime)}>{anime.title}</button></h3><p className="recommendation-facts">{anime.format ?? 'Format unknown'} · {anime.episodes === null ? 'Episodes unknown' : `${anime.episodes} episodes`} · English dub: {anime.englishDub ? anime.englishDub.available ? 'Verified' : 'Not confirmed available' : 'Unknown'}</p>
            {anime.englishDub?.available && <a className="source-link" href={anime.englishDub.source} target="_blank" rel="noreferrer">Dub source <Icon name="external" size={13} /></a>}
            <p className="recommendation-reason">{recommendation.reason}</p>
            {(recommendation.shared_genres.length > 0 || recommendation.shared_tags.length > 0) && <div className="tags">{[...new Set([...recommendation.shared_genres, ...recommendation.shared_tags])].map(trait => <span key={trait}>{trait}</span>)}</div>}
            <HistoryEvidence ids={recommendation.history_ids} entries={entries} onOpen={onOpen} />
            {recommendation.tradeoff && <p className="recommendation-tradeoff"><strong>Keep in mind:</strong> {recommendation.tradeoff}</p>}
          </div>
        </article> : null;
      })}</div>
      <details className="taste-profile"><summary>Your taste, as we understand it<Icon name="chevron" size={18} /></summary><p>{current.profile.summary}</p>
        {([{ title: 'Patterns you may enjoy', patterns: current.profile.likes }, { title: 'Possible turn-offs', patterns: current.profile.possible_dislikes }]).map(group => group.patterns.length > 0 && <div className="taste-patterns" key={group.title}><h3>{group.title}</h3><ul>{group.patterns.map((pattern, index) => <li key={index}><p>{pattern.pattern}</p><HistoryEvidence ids={pattern.history_ids} entries={entries} onOpen={onOpen} /></li>)}</ul></div>)}
        {current.profile.limitations.length > 0 && <ul className="analysis-limitations">{current.profile.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul>}
      </details>
      <details className="analysis-details"><summary>About this analysis<Icon name="chevron" size={15} /></summary><p className="pick-note">The model considered {current.coverage.candidatesSent} of {current.coverage.eligibleTotal} eligible titles using {current.coverage.historySent} of {current.coverage.historyTotal} history entries ({current.coverage.ratedHistorySent} rated). Confidence is qualitative, not a match percentage. Explanations are AI interpretations; source facts and cited history are shown separately.</p>
      {current.warnings.length > 0 && <ul className="analysis-limitations">{current.warnings.map(warning => <li key={warning}>{warning}</li>)}</ul>}
      </details>
    </div>}
  </section>;
}
