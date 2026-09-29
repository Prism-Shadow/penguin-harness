# Local speech and music for activities

Date: 2026-09-29
Type: Added
Scope: server, web

Activities can generate local Kokoro narration and MusicGen music through Penguin's local-audio capability. Results remain reviewable candidates until accepted. Generation runs in a cancellable Node worker; it requires no provider API key or agent session.

- Kokoro offers American and British English voices. It does not supply word timings, and decodable-book words need a custom pronunciation script.
- MusicGen generates music clips from 1 to 30 seconds; an unspecified duration requests 10 seconds.
- Model files download on first use into `models/audio` inside the Penguin data directory. One local model runs at a time to bound memory use.
- Native runtimes are optional server dependencies. Packaged or hot-loaded installations can also resolve them from `<Penguin data directory>/local-audio/node_modules`: install `kokoro-js@1.2.1` and `@huggingface/transformers@3.8.1` there with Node 24 or newer. Missing runtimes are shown as unavailable.
- Exact AudioGen and AudioLDM generation remains unavailable. Neither is replaced with a different model.
