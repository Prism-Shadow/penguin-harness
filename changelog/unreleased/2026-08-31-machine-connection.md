# Every word to a machine leaves through one connection seam

- **Date:** 2026-08-31
- **Type:** refactor
- **Scope:** `server`, `web`
- **PR:** [#562](https://github.com/Prism-Shadow/penguin-harness/pull/562)

[中文版](2026-08-31-machine-connection.zh.md)

Talk to a machine used to leave through four doors — the shared shell, the held forward, a fresh ssh/scp per install step, and a one-shot ssh the status probe fell back to. Each door judged the machine's liveness from its own channel's state, and the judgements could disagree — the soil the connect loop grew in. All of it now leaves through the machine's `MachineConnection`, and the liveness fact in the machine list now names the layer it measured.

## Details

- New `machines/transport/` directory: `exec.ts`, `ssh-session.ts`, `forward.ts` and `targets.ts` move in and become private; the one door is `transport/index.ts`, exporting the `MachineConnection` handle (`exec` on the shared shell, `oneShot` for long steps and stdin payloads, `pipeTo` for streamed transfers, `copyTo` for scp, `forward` for the held tunnel) plus target resolution and the result vocabulary.
- The guarantee is authority, not socket count: what sockets exist underneath is now an implementation detail of one directory, free to be tightened toward a literal single multiplexed connection later without any caller noticing. A source-scan test (`machines-transport-boundary.test.ts`) pins the boundary: nothing outside the directory spawns ssh/scp or imports past the index.
- The status probe's one-shot ssh fallback is gone — its channel parameter is now required, so a probe always rides the caller's shared shell instead of opening a second mouth to the machine.
- `MachineInfo.connected` is gone: it was a boolean that measured "the ssh forward child on THIS side is alive" and was read as "the machine is usable" — the misreading behind the connect loop. The field is now the fact itself, `forward: { localPort } | null`, always `null` for the local entry; whether a server *answers* over there remains `status`'s word (the probe layer, which already carries `state` + `checkedAt`). A consumer that means "usable" can no longer type-check while reading the transport layer. The third layer — "the machine's API answered at t" — is deliberately not added yet: nothing server-side measures it today; it arrives with the machine-health state machine, the next step of this line.
- Behavior-neutral otherwise: the handle is stateless (per-machine state stays in the address-keyed registries), and the `MachinesEffects` seam tests fake stays exactly where it was.
