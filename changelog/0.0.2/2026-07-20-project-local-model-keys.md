# penguin-sdk and agenthub-models keep model keys project-local

Both skills now spell out where model API keys belong: in the project under the working directory, never in the user's global `~/.penguin`.

- penguin-sdk (v6) and agenthub-models (v3) instruct configuring keys with the penguin CLI into the app's own data root under CWD (`penguin config model add --root <data_dir> …`), or relying on vault-injected environment variables; reading, copying or falling back to model keys stored in the global `~/.penguin` directory is explicitly forbidden — that config belongs to the person running Penguin, not to the app being built.
- The no-key path stays as before: stop and ask the user to open the agent's settings via the gear icon on its card and update the key vault.
