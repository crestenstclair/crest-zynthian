# crest-zynthian

This is a public repository for Zynthian designs and Steam Deck/Linux host
packaging. Keep private Crest Pedal source, firmware, recovered DSP, validation
records and detailed migration inventory out of both files and Git history.

- Start with `README.md` and the runtime's `tools/zynthian-steamdeck/README.md`.
- Preserve pinned upstream commits in `sources.lock.json` and license notices.
- Reuse the stock Zynthian UI, engine routing and existing packaging. Do not
  substitute a replacement UI or change engine algorithms without a task need.
- Keep user configuration, presets, snapshots and recordings outside the
  container. Never silently replace an existing container or remove user data.
- Keep SteamOS read-only; install Ubuntu dependencies inside the container.
- The HTML control map is a proposal, not a claim of implemented controls or
  instrument availability. Keep generic host designs separate from private
  plugin recovery work.
- Preserve the JACK, PipeWire, snapshot and rootless installer checks. Record
  the exact commit and run when claiming runtime validation.
- Desktop CI does not validate Steam Deck hardware, physical Raspberry Pi,
  USB devices, real-time latency or sustained thermal performance. Physical
  Raspberry Pi testing remains deferred until the user's hardware arrives.
- Do not copy unrelated source-repository history into this public repository.
