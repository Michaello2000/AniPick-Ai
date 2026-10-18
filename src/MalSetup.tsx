import { useState, type FormEvent } from 'react';
import { api, errorMessage } from './api.js';

export function MalSetup({ disabled, onConfigured }: { disabled: boolean; onConfigured: () => void }) {
  const [clientId, setClientId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving || disabled) return;
    setSaving(true); setError(null);
    try { await api.configureMal(clientId.trim()); setClientId(''); onConfigured(); }
    catch (failure) { setError(errorMessage(failure)); }
    finally { setSaving(false); }
  }
  return <section className="mal-setup" aria-labelledby="mal-setup-heading">
    <h3 id="mal-setup-heading">Enable MyAnimeList import</h3>
    <p>MAL needs its own application Client ID. Your Google AI Studio key is only for recommendations.</p>
    <a className="source-link" href="https://myanimelist.net/apiconfig" target="_blank" rel="noreferrer">Register a MAL application and copy its Client ID</a>
    <form onSubmit={event => { void save(event); }}>
      <label className="field-label" htmlFor="mal-client-id">MAL Client ID</label>
      <input id="mal-client-id" type="password" autoComplete="off" spellCheck={false} value={clientId} onChange={event => setClientId(event.target.value)} disabled={disabled || saving} required maxLength={256} placeholder="Paste your MAL Client ID" />
      <button className="secondary-button" type="submit" disabled={disabled || saving || !clientId.trim()}>{saving ? 'Checking MAL access…' : 'Save and enable MAL'}</button>
    </form>
    <p>Validated with MAL and saved only in this computer’s local database. No restart, client secret, or viewer OAuth login required.</p>
    {error && <p className="mal-setup-error" role="alert">{error}</p>}
  </section>;
}
