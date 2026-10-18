# Local AI

[README](../README.md) · [Setup](SETUP.md) · [Local AI](LOCAL_AI.md) · [Recommendations](RECOMMENDATIONS.md) · [Media](MEDIA.md) · [Testing](TESTING.md)

**Live Bonsai 2, Ollama, and LM Studio inference remains unverified.** Protocol and validation tests do not prove real-model generation or recommendation quality. See the [verification record](TESTING.md). AniPick requires a separately running model server; it never downloads weights, starts that server, or falls back to cloud.

The external runtime instructions and compatibility references below were carried forward from the previous README. Check the linked provider instructions for changes before installing.

## Select a local provider

Open **Pick for Me → AI settings** and choose **Cloud** or **Local**. Cloud keeps Google/Gemma and its consent checkbox. Local discovers model IDs from `/v1/models`; Bonsai 2 9B and 27B are prioritized, and other compatible models remain selectable. Local requires no Google consent/key and never falls back to cloud. Startup defaults come from `.env`; selections remain while the app stays open.

### Windows setup

Use [PrismML's official Bonsai-demo](https://github.com/PrismML-Eng/Bonsai-demo), **outside this repository**. Review its setup script and hardware requirements before running; downloads can be large. AniPick does not download weights or start the runtime.

In a separate PowerShell window:

```powershell
Set-Location $env:USERPROFILE
git clone https://github.com/PrismML-Eng/Bonsai-demo.git
Set-Location Bonsai-demo
$env:BONSAI_FAMILY='bonsai2'
$env:BONSAI_MODEL='9B'  # Or '27B'; run setup for the chosen size
$env:BONSAI_HOST='127.0.0.1'
.\setup.ps1
.\scripts\start_llama_server.ps1
```

If Windows blocks scripts, follow PrismML's documented process-scoped execution-policy instructions after reviewing them. Keep loopback binding; do not use `0.0.0.0` or enable public/LAN sharing. Leave this server running and start AniPick in another terminal.

Optimized `PQ2_0`/`PTQ1_0` GGUF packs need PrismML's fork; official `Q2_0` needs a recent upstream runtime with Bonsai 2 integration. Use the demo's matching runtime rather than assuming any GGUF engine works. See [model formats](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/MODEL-FORMATS.md). Ollama/LM Studio bundle their own engines; API compatibility does not establish optimized Bonsai weight support.

Add to AniPick's existing `.env`, keeping Google configuration:

```dotenv
LOCAL_AI_BASE_URL=http://127.0.0.1:8080/v1
LOCAL_AI_MODEL=
LOCAL_AI_RUNTIME=llamacpp
LOCAL_AI_TIMEOUT_MS=600000
LOCAL_AI_MAX_TOKENS=16384
LOCAL_AI_SAMPLING=auto
LOCAL_AI_API_KEY=
# Optional startup default: AI_PROVIDER=local
```

Restart AniPick, choose Local, refresh models, and select the exact served ID. `LOCAL_AI_MODEL` optionally makes that ID the startup default. Use **Test AI connection**, then **Pick for Me**. Discovery does not prove generation or model suitability. Weights/runtimes stay outside Git; `.gitignore` also guards common downloaded model/runtime paths.

Only HTTP bases ending in `/v1` on `127.0.0.1`, `localhost` (pinned to `127.0.0.1`), or `[::1]` are accepted. Public/LAN hosts, redirects, embedded credentials, queries, and arbitrary paths are rejected. Optional `LOCAL_AI_API_KEY` remains server-only and goes only to the local server. AniPick cannot inspect another application's forwarding behavior: choose an actual local model, not an Ollama cloud-backed model, when local computation is required. Imports/posters/embeds may still use internet services.

### Ollama, LM Studio, reasoning, and limits

For [Ollama](https://docs.ollama.com/api/openai-compatibility), set base `http://127.0.0.1:11434/v1` and runtime `ollama`; for [LM Studio](https://lmstudio.ai/docs/developer/openai-compat), use `http://127.0.0.1:1234/v1` and `lmstudio`. Start a loopback server with a supported model and refresh AniPick's list. These modes omit llama.cpp-only fields; verify sampler/runtime support in the host application. Embedding-only or incompatible models can appear in discovery and fail generation.

AniPick implements these Bonsai settings for llama.cpp, following the referenced PrismML profiles:

- [Small models (9B/4B/2B)](https://github.com/PrismML-Eng/Bonsai-demo/blob/main/SMALL-MODELS.md): temperature 1, top-p .95, top-k 20, min-p 0, presence penalty 1, repetition penalty 1, and penalty window 64.
- [27B](https://github.com/PrismML-Eng/Bonsai-demo#best-practices-bonsai-2-27b): temperature 1, top-p .95, top-k 20, min-p .05, presence penalty 0, and repetition penalty 1.

The llama.cpp adapter enables thinking with `medium` effort; it avoids unsupported `low`. Alias IDs can override detection with `LOCAL_AI_SAMPLING=bonsai2-small` or `bonsai2-27b`; `generic` disables special sampling. Non-llama.cpp hosts use standard sampling fields and their engine defaults for extensions.

Separate reasoning fields are ignored. Complete leading `<think>…</think>` blocks are stripped before final JSON parsing; incomplete/thought-only and truncated responses are rejected. Reasoning is never saved or used as a recommendation. Existing candidate/history ID checks, source metadata joins, spoiler-avoidance instructions, bounded repairs, and hard filters still apply. Free-form interpretation cannot guarantee no spoilers.

`LOCAL_AI_TIMEOUT_MS` governs the entire profile/ranking/repair operation: default ten minutes, range 30 seconds–30 minutes. The browser uses that deadline plus transport slack; discovery has a 15-second cap. `LOCAL_AI_MAX_TOKENS` accepts 1,024–65,536 (default 16,384 leaves room for thinking). Ensure the runtime context/memory can fit input plus output. Local cache identity includes endpoint, model, runtime, sampling profile, and output budget; Google caches remain separate.

```powershell
pnpm test:ai --local
# Lists models; supply LOCAL_AI_MODEL or an exact ID for verification:
pnpm test:ai --local --model=YOUR_SERVED_ID --probe
# Real final-JSON generation, without watchlist data.
pnpm test:ai --local --model=YOUR_SERVED_ID --recommend --library=anilist:yourusername
# Sends that bounded saved-library sample only to loopback.
```

For cloud configuration and the shared taste-analysis/validation pipeline, see [Recommendations](RECOMMENDATIONS.md).
