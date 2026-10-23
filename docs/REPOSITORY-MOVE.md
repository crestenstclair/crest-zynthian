# Repository move — 2026-10-23

`crest-zynthian` is the public home for the Zynthian host work previously kept
alongside private pedal development.

## Imported scope

- The 13 commits for `tools/zynthian-steamdeck/` and
  `.github/workflows/zynthian-steamdeck.yml`, ending at source commit
  `6368d537a74d7727d007b1944d8fb234961591ba` on `codex/zynthian-steamdeck`.
  Authors, messages and changes were retained; commit IDs changed because
  unrelated parent history and files were excluded.
- The current `design/firmware-control-map.html` snapshot from source commit
  `f6b16f224e5da09e222622d9ffe2486793f410fa`. Older design history was not imported.
  The public copy changes the page branding to Crest Zynthian and links to the
  local public rig design.
- New repository instructions and entry-point documentation. CI now also runs
  on `main`; the runtime scripts, source pins, patch and tests are unchanged.

The private pedal repository retains its DSP, firmware, plugin products,
reference tools, validation records and detailed migration inventory. None of
that file history was imported here. Original commits remain in the private
repository for historical reproduction; new host development belongs here.

## Evidence and rollback

The imported runtime's source CI run `40020029639` passed on 2026-10-23 at
`6368d537a74d7727d007b1944d8fb234961591ba`: native x86-64 build, stock UI,
JACK and PipeWire audio/MIDI, Calf LV2, fresh-process snapshot recall, and
rootless Podman/Distrobox installation. That run and its artifacts remain under
the source repository's access controls and retention policy.

New installer and evidence artifacts are produced by this repository's
[workflow](https://github.com/crestenstclair/crest-zynthian/actions/workflows/zynthian-steamdeck.yml).
Use a successful run for the exact commit you intend to install. Hardware
validation remains outstanding.

[`repository-import.json`](repository-import.json) records the original and
filtered commit IDs and per-file hashes. The runtime at the filtered import
commit reproduces the source snapshot without the repository setup changes.
The source repository's move commit can be reverted independently if ownership
needs to be rolled back; no source history was rewritten or deleted.
