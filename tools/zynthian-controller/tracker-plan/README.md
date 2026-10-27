# Crest Tracker × Zynthian plan

An isolated design proposal based on the supplied Crest Tracker Figma and this
repository's existing Zynthian adapter. It does not replace the live frontend.

Open `docs/crest-tracker-zynthian-plan.html` from the repository root in Safari
or another modern browser. The single file works offline. Its Song, Phrase
(tracker and piano roll), Instruments and Mixer views use temporary fixtures;
there is no MIDI, audio, network connection or persistence. Reload resets edits.
Context popovers and the document below the demo explain native ownership,
proposed adaptations and integration gaps.

Build from the repository root:

```sh
node tools/zynthian-controller/tracker-plan/build.mjs
```

The build inlines the existing `controller-node/web/input.mjs` so browser
Gamepad and native SDL input keep the same bindings. `template.html` owns the
written plan, `style.css` the Figma-derived presentation, and `app.js` the
offline fixture interactions. Azeret Mono is used if installed; otherwise the
document uses the system monospace font. No external assets are fetched.

Focused interaction checks, using the controller frontend's installed dev
dependencies:

```sh
cd tools/zynthian-controller/controller-node
npx playwright test tests/tracker-plan.spec.mjs
```

These checks prove offline navigation, shared and unique phrase editing,
sustain/OFF visualization, undo/redo, UI settings and simulated controller
focus. They do not validate physical controllers, MIDI/audio or backend saves.
