import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { filterAnime, type BrowseFilters, type SortOrder } from '../shared/filter.js';
import { providerLabels, statusLabels, type Anime, type ImportProgress, type Library, type LibrarySummary, type ListStatus, type Provider } from '../shared/model.js';
import { api, errorMessage } from './api.js';
import { AnimeCard } from './AnimeCard.js';
import { AnimeDetail } from './AnimeDetail.js';
import { Icon } from './icons.js';
import { PickForMe } from './PickForMe.js';
import { lengths } from './length-options.js';
import { LibraryHero } from './LibraryHero.js';

interface ImportRequest { provider: Provider; username: string; refresh: boolean }

export function App() {
  const [view, setView] = useState<'library' | 'pick'>(() => location.hash === '#pick-for-me' ? 'pick' : 'library');
  const manager = useRef<HTMLDetailsElement>(null);
  const [provider, setProvider] = useState<Provider>('anilist');
  const [username, setUsername] = useState('');
  const [libraries, setLibraries] = useState<LibrarySummary[]>([]);
  const [library, setLibrary] = useState<Library | null>(null);
  const [malConfigured, setMalConfigured] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportProgress | null>(null);
  const [lastRequest, setLastRequest] = useState<ImportRequest | null>(null);
  const [filters, setFilters] = useState<BrowseFilters>({ status: 'planning', length: 'all', sort: 'title' });
  const [visibleCount, setVisibleCount] = useState(60);
  const [selected, setSelected] = useState<Anime | null>(null);
  const [bootAttempt, setBootAttempt] = useState(0);
  const activeJobId = job?.state === 'running' ? job.id : null;
  const busy = submitting || Boolean(activeJobId);

  useEffect(() => {
    function navigate() {
      if (location.hash === '#pick-for-me') setView('pick');
      else if (location.hash === '#backlog') setView('library');
    }
    window.addEventListener('hashchange', navigate);
    return () => window.removeEventListener('hashchange', navigate);
  }, []);

  function openImport() {
    if (manager.current) manager.current.open = true;
  }

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      try {
        const [saved, capabilities, imports] = await Promise.all([api.libraries(controller.signal), api.capabilities(controller.signal), api.activeImport(controller.signal)]);
        const first = saved.libraries[0];
        const restored = first ? await api.library(first.id, controller.signal) : null;
        if (controller.signal.aborted) return;
        setLibraries(saved.libraries); setLibrary(restored); setMalConfigured(capabilities.malConfigured); setJob(imports.job); setError(null);
      } catch (failure) { if (!controller.signal.aborted) setError(errorMessage(failure)); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    }
    void initialize();
    return () => controller.abort();
  }, [bootAttempt]);

  useEffect(() => {
    if (!activeJobId) return;
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    const id = activeJobId;
    async function poll() {
      try {
        const progress = await api.progress(id, controller.signal);
        if (progress.state === 'complete' && progress.libraryId) {
          const [saved, imported] = await Promise.all([api.libraries(controller.signal), api.library(progress.libraryId, controller.signal)]);
          if (controller.signal.aborted) return;
          setLibraries(saved.libraries); setLibrary(imported); setVisibleCount(60);
          setFilters(current => ({ ...current, status: 'planning' }));
        }
        if (controller.signal.aborted) return;
        setJob(progress);
        if (progress.state === 'failed') setError(progress.error?.message ?? progress.message);
        if (progress.state === 'running') timer = setTimeout(() => { void poll(); }, 900);
      } catch (failure) {
        if (controller.signal.aborted) return;
        setError(`${errorMessage(failure)} The server may still be importing. Reconnect to check its progress.`);
        setJob(null);
      }
    }
    void poll();
    return () => { controller.abort(); clearTimeout(timer); };
  }, [activeJobId]);

  async function runImport(request: ImportRequest) {
    setSubmitting(true); setError(null); setLastRequest(request);
    try {
      const result = await api.import(request.provider, request.username.trim(), request.refresh);
      if (result.state === 'complete' && result.libraryId) {
        const [saved, imported] = await Promise.all([api.libraries(), api.library(result.libraryId)]);
        setLibraries(saved.libraries); setLibrary(imported);
      }
      setJob(result);
    } catch (failure) { setError(errorMessage(failure)); }
    finally { setSubmitting(false); }
  }

  async function openLibrary(id: string) {
    setSwitching(true); setError(null);
    try { setLibrary(await api.library(id)); setVisibleCount(60); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setSwitching(false); }
  }
  function submit(event: FormEvent<HTMLFormElement>) { event.preventDefault(); void runImport({ provider, username, refresh: false }); }
  function updateFilters(update: Partial<BrowseFilters>) { setFilters(current => ({ ...current, ...update })); setVisibleCount(60); }
  function resetFilters() { setFilters({ status: filters.status, length: 'all', sort: 'title', search: '', genre: '' }); setVisibleCount(60); }
  const entries = library?.entries;
  const filtered = useMemo(() => filterAnime(entries ?? [], filters), [entries, filters]);
  const genres = useMemo(() => [...new Set(entries?.flatMap(anime => anime.genres) ?? [])].sort(), [entries]);
  const counts = useMemo(() => {
    const result: Record<ListStatus, number> = { planning: 0, watching: 0, completed: 0, paused: 0, dropped: 0 };
    for (const anime of entries ?? []) result[anime.status]++;
    return result;
  }, [entries]);

  return <div className="app-shell">
    <a className="skip-link" href="#main">Skip to content</a>
    <header className="site-header">
      <a className="brand" href="#backlog" onClick={() => setView('library')} aria-label="AniPick home"><span className="brand-mark"><Icon name="play" size={19} /></span>AniPick<span className="brand-period">.</span></a>
      <nav aria-label="Main navigation"><a href="#backlog" onClick={() => setView('library')} aria-current={view === 'library' ? 'page' : undefined}>Library</a><a className="pick-nav" href={library ? '#pick-for-me' : '#library-manager'} aria-current={view === 'pick' ? 'page' : undefined} onClick={() => { if (library) setView('pick'); else openImport(); }}><Icon name="shuffle" size={16} />Pick for Me</a></nav>
      <div className="header-tools"><span className="local-indicator"><Icon name="lock" size={13} />Saved locally</span><a className="import-trigger" href="#library-manager" onClick={openImport}><Icon name="plus" size={16} /><span>Import list</span></a></div>
    </header>

    <main className="workspace" id="main" tabIndex={-1}>
      {(view === 'library' || !library) && !loading && <LibraryHero library={library} onPick={() => setView('pick')} onImport={openImport} onOpen={setSelected} />}
      <details className="library-manager" id="library-manager" ref={manager} open={!loading && !library}>
        <summary><span><Icon name="library" size={17} />{library ? `${library.username}’s collection` : 'Your collection starts here'}<span className="manager-source">{library ? providerLabels[library.provider] : 'Import a public watchlist'}</span></span><span className="manager-toggle">{library ? 'Manage libraries' : 'Import list'}<Icon name="chevron" size={16} /></span></summary>
        <div className="manager-content">
        <section className="import-panel">
          <h2>Bring your list.</h2>
          <p className="muted">One username. Your whole anime collection.</p>
          <form onSubmit={submit}>
            <fieldset className="provider-picker" disabled={busy || loading}>
              <legend className="sr-only">Watchlist provider</legend>
              <label className={provider === 'anilist' ? 'chosen' : ''}><input type="radio" name="provider" value="anilist" checked={provider === 'anilist'} onChange={() => setProvider('anilist')} /><span className="provider-letter" aria-hidden="true">A</span>AniList</label>
              <label className={provider === 'mal' ? 'chosen' : ''}><input type="radio" name="provider" value="mal" checked={provider === 'mal'} onChange={() => setProvider('mal')} /><span className="provider-letter mal-letter" aria-hidden="true">M</span>MyAnimeList</label>
            </fieldset>
            <label className="field-label" htmlFor="username">{providerLabels[provider]} username</label>
            <input id="username" name="username" type="text" placeholder="Your public username" autoComplete="off" autoCapitalize="none" spellCheck={false} maxLength={32} pattern="[A-Za-z0-9_-]{1,32}" title="Letters, numbers, hyphens and underscores" required value={username} onChange={event => setUsername(event.target.value)} disabled={busy || loading} />
            <button className="primary-button" type="submit" disabled={busy || loading || !username.trim()}>{busy ? <><span className="spinner" />Importing your list…</> : <>Import list <Icon name="arrow" size={18} /></>}</button>
          </form>
          <p className="import-note"><Icon name="globe" size={14} />Public lists only. No viewer login required.</p>
          {provider === 'mal' && <p className={`provider-note ${malConfigured === false ? 'setup-note' : ''}`}>{malConfigured === false ? <>MAL setup needed: add <code>MAL_CLIENT_ID</code> to the server’s <code>.env</code>, then restart. Hosted Jikan no longer provides user lists.</> : 'Public list from the official MAL API. Extra anime metadata from Jikan.'}</p>}
          {job && <div className={`import-status ${job.state}`} role="status" aria-live="polite">{job.state === 'complete' && <Icon name="check" size={16} />}<div><p>{job.message}</p>{job.state === 'running' && <span>{job.imported.toLocaleString()} anime · {job.pages} pages read. Large lists can take a few minutes.</span>}</div></div>}
        </section>

        <div className="manager-libraries">{libraries.length > 0 && <section className="saved-libraries"><h3>Saved libraries <span>{libraries.length}</span></h3>
          <div className="library-list">{libraries.map(saved => <button key={saved.id} className={`library-item ${library?.id === saved.id ? 'selected' : ''}`} onClick={() => { void openLibrary(saved.id); }} disabled={switching} aria-pressed={library?.id === saved.id}>
            <span className="library-avatar">{saved.username.slice(0, 1).toUpperCase()}</span><span><strong>{saved.username}</strong><small>{providerLabels[saved.provider]} · {saved.count.toLocaleString()} anime</small></span>{library?.id === saved.id && <span className="selected-dot" aria-hidden="true" />}
          </button>)}</div>
        </section>}
        <div className="privacy-note"><Icon name="lock" size={17} /><div><h3>A collection that stays yours.</h3><p>Your library is saved on this computer. Browse anytime without an AI key.</p><p className="quiet">Imports contact your list provider. Posters load from their image hosts.</p></div></div>
        </div></div>
      </details>

      <div className="main-content">
        {error && <div className="error-banner" role="alert"><div><strong>We couldn’t finish that.</strong><p>{error}</p></div><div className="error-actions">{lastRequest && !busy && <button className="secondary-button" onClick={() => { void runImport(lastRequest); }}>Retry import</button>}<button className="text-button" onClick={() => { setLoading(true); setBootAttempt(value => value + 1); }}>Reconnect</button></div></div>}
        {loading ? <div className="library-loading" role="status"><div><span className="spinner" /><h1>Opening your library…</h1></div><div className="skeleton-grid" aria-hidden="true">{Array.from({ length: 6 }, (_, index) => <div key={index} />)}</div></div> : !library ? <p className="first-import-note"><Icon name="library" size={17} />Your real posters, ratings, and watch history will appear here after import.</p> : <><div hidden={view !== 'pick'}><PickForMe key={`${library.id}:${library.importedAt}`} library={library} onOpen={setSelected} /></div><section hidden={view !== 'library'} className="browser" id="backlog" aria-label="Anime watchlist browser" aria-busy={switching}>
          <div className="library-heading"><div><h2>Your library<span className="library-total">{library.entries.length.toLocaleString()} titles</span></h2><p>{library.username} on {providerLabels[library.provider]}<span aria-hidden="true"> · </span>Saved {new Date(library.importedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}</p></div><button className="secondary-button refresh-button" disabled={busy} onClick={() => { void runImport({ provider: library.provider, username: library.username, refresh: true }); }}><Icon name="refresh" size={15} />Refresh list</button></div>
          <div className="status-tabs" role="group" aria-label="List status">
            {(Object.keys(statusLabels) as ListStatus[]).map(status => <button key={status} aria-pressed={filters.status === status} className={filters.status === status ? 'active' : ''} onClick={() => updateFilters({ status })}>{statusLabels[status]}<span>{counts[status]}</span></button>)}
            <button aria-pressed={filters.status === 'all'} className={filters.status === 'all' ? 'active' : ''} onClick={() => updateFilters({ status: 'all' })}>All<span>{library.entries.length}</span></button>
          </div>
          <div className="browser-tools"><label className="search-field"><span className="sr-only">Search anime titles</span><Icon name="search" size={18} /><input type="search" placeholder="Find a story in your collection…" value={filters.search ?? ''} onChange={event => updateFilters({ search: event.target.value })} /></label>
            <details className="browse-filters" onKeyDown={event => { if (event.key === 'Escape') { event.currentTarget.open = false; event.currentTarget.querySelector('summary')?.focus(); } }}><summary><Icon name="sliders" size={16} />Filters{(filters.genre || filters.length !== 'all') && <span className="filter-dot" aria-label="Filters applied" />}<Icon name="chevron" size={14} /></summary><div className="browse-filter-content">
            <div className="filter-panel-heading"><h3>Refine your library</h3><button className="icon-button" aria-label="Close filters" onClick={event => { const details = event.currentTarget.closest('details'); if (details) { details.open = false; details.querySelector('summary')?.focus(); } }}><Icon name="close" size={17} /></button></div>
            <label className="select-field"><span className="field-label">Genre</span><select value={filters.genre ?? ''} onChange={event => updateFilters({ genre: event.target.value })}><option value="">All genres</option>{genres.map(genre => <option key={genre} value={genre}>{genre}</option>)}</select></label>
          <div className="length-filter"><span className="field-label">How long a story?</span><div className="length-options" role="group" aria-label="Total anime length">{lengths.map(length => <button key={length.value} title={length.boundary} aria-label={`${length.label}: ${length.boundary}`} aria-pressed={filters.length === length.value} className={filters.length === length.value ? 'active' : ''} onClick={() => updateFilters({ length: length.value })}>{length.label}</button>)}</div><p>Total anime length: ≤12, ≤24, movie, or ≥25 episodes. Unknown lengths appear under No limit.</p></div>
            </div></details>
            <label className="select-field sort-field"><span className="sr-only">Sort anime</span><select value={filters.sort ?? 'title'} onChange={event => updateFilters({ sort: event.target.value as SortOrder })}><option value="title">Title A–Z</option><option value="score">Community score</option><option value="shortest">Shortest first</option><option value="year">Newest year</option></select></label>
          </div>
          <div className="results-heading"><p aria-live="polite"><strong>{filtered.length.toLocaleString()}</strong> {filtered.length === 1 ? 'title' : 'titles'}<span aria-hidden="true"> · </span>{filters.status === 'all' ? 'All statuses' : statusLabels[filters.status ?? 'planning']}</p>{(filters.search || filters.genre || filters.length !== 'all') && <button className="text-button" onClick={resetFilters}>Clear filters</button>}<span>Community ratings out of 10</span></div>
          {filtered.length > 0 ? <><div className="anime-grid">{filtered.slice(0, visibleCount).map(anime => <AnimeCard key={anime.id} anime={anime} onOpen={() => setSelected(anime)} />)}</div>{filtered.length > visibleCount && <div className="load-more"><button className="secondary-button" onClick={() => setVisibleCount(count => count + 60)}>Show more titles <span>{Math.min(visibleCount, filtered.length)} / {filtered.length}</span></button></div>}</> : <div className="empty-state filtered-empty"><Icon name="search" size={28} /><h3>{library.entries.length === 0 ? 'This public list is empty.' : counts.planning === 0 && filters.status === 'planning' ? 'Nothing in Plan to Watch. Yet.' : 'No titles fit this search.'}</h3><p>{library.entries.length === 0 ? 'Add anime on your list provider, then use Refresh list.' : counts.planning === 0 && filters.status === 'planning' ? 'Explore the other list statuses above, or add a few possibilities on your list provider.' : 'Try a different title, genre, or total episode count.'}</p>{(filters.search || filters.genre || filters.length !== 'all') && <button className="secondary-button" onClick={resetFilters}>Clear filters</button>}</div>}
        </section></>}
        <footer className="page-footer"><a className="footer-brand" href="#backlog" onClick={() => setView('library')}>AniPick<span>.</span></a><span>A little less indecision. A little more anime.</span><span><Icon name="lock" size={12} />Your library, saved locally.</span></footer>
      </div>
    </main>
    {selected && <AnimeDetail key={selected.id} anime={selected} onClose={() => setSelected(null)} />}
  </div>;
}
