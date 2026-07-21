# Skills: pin the CLI --root to the app dir and fast-stop when no key

Three skills gain two hard rules for AI-app development: always target the app's own data root with the penguin CLI, and stop asking for help the moment no API key is usable.

- penguin-sdk (v7), agenthub-models (v4), penguin-cli (v2): when building an AI app, `penguin config ...` must always pass `--root <data_dir>` pointing at the app's data directory inside the current working directory (the same path given to `createAgent({ root })`, e.g. `./penguin_data`); running without `--root` writes to the global `~/.penguin/data`, which belongs to the person running Penguin, not the app.
- penguin-sdk (v7) and agenthub-models (v4): when no API key is usable, stop immediately and ask the user for help instead of looping on tool calls — re-running `env`, re-checking the vault, or retrying the build wastes turns and money; one clear check, then hand back to the user (open the agent's settings via the gear icon and add a key to the key vault).
