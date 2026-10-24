# Sequencer interaction mockups

These are working, in-memory UI mockups for the Zynthian controller project.
They reuse the current frontend theme, compact bar, piano roll and popover.
They are not loaded by the native executable and do not send audio, MIDI or
commands to Zynthian. There are no new runtime dependencies.

Build the single-file offline preview from the repository root:

```sh
python3 controller-webview/mockups/build_preview.py --output /tmp/zynthian-sequencer-mockups.html
```

- **Tracker:** decimal step numbers; note, MIDI channel, chord, velocity, length and
  three FX fields. Click a cell or press Enter to edit. Delete clears a step.
  MIDI channels are selectable from 1–16 per step; new and generated notes default
  to channel 1. Channel edits survive view changes and support undo/redo. Channel,
  chord and FX values are editable design data; native MIDI delivery and chord/FX
  execution are not implemented in this mockup.
- **Euclidean:** four lanes with hits, rotation, pitch, velocity, gate and mute.
  Click a pulse for a manual override. Changing lane settings retains overrides;
  Clear manual overrides resets them on Apply. All lanes use the pattern length.
- **Randomizer:** seeded generation, density, pitch/velocity/gate ranges and
  scale filtering. Lock individual notes or rests before regenerating. A repeated
  seed and unchanged inputs reproduce a preview. Generate variation advances
  the seed. Apply & generate validates min/max bounds and empty scale ranges.
- **Sequencer type:** choose Piano roll, Tracker, Euclidean or Randomizer.
  Authored notes survive view changes. Use preview is an explicit, undoable copy
  from a generator to the tracker; generators otherwise leave authored notes alone.
- **Pattern settings:** 1–64 steps, 1/4 through 1/64 step length, straight/triplet/
  dotted timing, BPM, swing, default gate, direction, root and scale. Shortening
  hides authored steps; extending restores them. Steps are paged in groups of 16.
- **Preview:** visual cursor only; duration, direction and swing affect its timing.
  No audio or MIDI is produced. Session edits have undo/redo and reset on reload.

Functional reference: the requested sequencer concepts and the shared phrase
forms described in the existing Crest design material. No Crest implementation,
audio backend or visual redesign is imported.

`verify_preview.js` drives real DOM controls in the offline Qt capture harness;
it checks edits, cancellation, timing bounds, generator output, locks, undo,
view preservation and popover geometry. The manual marks these screens as mockups.
