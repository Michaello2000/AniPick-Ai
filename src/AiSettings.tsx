import { Icon } from './icons.js';
import type { AiStatus } from '../shared/recommendations.js';

interface Props {
  mode: 'cloud' | 'local'; onMode: (mode: 'cloud' | 'local') => void;
  model: string; onModel: (model: string) => void;
  models: string[]; baseUrl?: string; loading: boolean; localError: string | null; onRefresh: () => void;
  cloud: AiStatus; busy: boolean; checking: boolean; ready: boolean; onCheck: () => void;
}

export function AiSettings({ mode, onMode, model, onModel, models, baseUrl, loading, localError, onRefresh, cloud, busy, checking, ready, onCheck }: Props) {
  return <details className="ai-settings">
    <summary><Icon name="sliders" size={14} />AI settings · {mode === 'local' ? 'Local' : 'Cloud'}<Icon name="chevron" size={14} /></summary>
    <div className="ai-settings-content">
      <fieldset disabled={busy || checking} className="provider-picker ai-provider-picker">
        <legend className="field-label">Where should AI run?</legend>
        <button type="button" aria-pressed={mode === 'cloud'} className={mode === 'cloud' ? 'active' : ''} onClick={() => onMode('cloud')}>Cloud</button>
        <button type="button" aria-pressed={mode === 'local'} className={mode === 'local' ? 'active' : ''} onClick={() => onMode('local')}>Local</button>
      </fieldset>
      {mode === 'cloud' ? <p className="pick-note">{cloud.configured ? `${cloud.provider} · ${cloud.model}` : cloud.message}</p> : <>
        <label className="local-model-field"><span className="field-label">Local model</span><select value={model} disabled={busy || checking || loading || !models.length} onChange={event => onModel(event.target.value)}>
          <option value="">Select a model from your server</option>
          {models.map(id => <option key={id} value={id}>{id}</option>)}
        </select></label>
        <div className="ai-configuration"><p>{baseUrl ?? 'Endpoint is configured server-side in LOCAL_AI_BASE_URL.'}</p><button type="button" className="text-button" disabled={busy || checking || loading} onClick={onRefresh}>{loading ? 'Finding models…' : 'Refresh local models'}</button></div>
        {localError && <p className="pick-note" role="alert">{localError}</p>}
        {!loading && !localError && models.length === 0 && <p className="pick-note">No models found. Load a model in your local server, then refresh.</p>}
        <p className="pick-note">Bonsai 2 9B and 27B appear first when available. Select the real server ID; other compatible models are welcome. Use PrismML’s runtime for its optimized GGUF files. No automatic cloud fallback.</p>
      </>}
      <div className="ai-configuration"><button type="button" className="text-button" disabled={busy || checking || !ready} onClick={onCheck}>{checking ? 'Checking…' : 'Test AI connection'}</button></div>
      <p className="pick-note">At most 16 history entries and 24 eligible titles are selected, with shortened descriptions. Fewer suggestions use a smaller sample. Your username, posters, notes, and community ratings are not sent. {mode === 'local' ? 'Inference requests go only to the configured loopback server. Use a locally running model; AniPick cannot verify how another application processes requests.' : 'This is cloud inference.'}</p>
    </div>
  </details>;
}
