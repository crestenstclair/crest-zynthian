# Control-mapping workbook

Open [`docs/zynthian-control-mapping.html`](../../../docs/zynthian-control-mapping.html)
directly in a browser. It is one self-contained offline HTML file, with no server,
network requests or dependencies. This workbook is a design handoff, not a live
mapping loader. The running application is unchanged until the decisions are
implemented.

1. Enter the controller/hardware and overall layout rules.
2. Set **Default / all screens** behavior. Choose Gamepad, Keyboard, Deck & touch,
   or All inputs to see each control.
3. Select a screen for exceptions. Add a custom mode for sub-states such as
   piano-roll block selection. Add custom controls for chords or other hardware.
4. Describe the primary action and, where needed, holds, double presses,
   modifiers, repeat/sensitivity and edge cases. Use **Disable** for no action.
5. Review all decisions, then **Save JSON bundle**. Give that file or its local
   path to the coding agent when ready to update the controls.

**Load JSON** restores an exported bundle. Loading or starting a new bundle asks
before replacing the current draft and offers a download first. Drafts are also
saved in the current browser's local storage when available. Browser-local storage
is not a portable backup; its behavior for local files depends on the browser.
Use JSON to move between browsers/computers or preserve a version. Invalid imports
leave the existing draft intact. An unreadable stored draft is not overwritten.

## Bundle interpretation

The JSON identifies `format: "crest-zynthian-control-map"` and `schemaVersion: 1`.
It includes a reference catalog, source commit, project brief, screen notes,
custom controls/modes and an `assignments` array. Each assignment identifies a
stable `control` and `context` ID, a `decision`, and freeform text fields:
`press`, `hold`, `doublePress`, `modifiers`, `repeat`, `notes`.

- `global` is the default context. Missing assignments or `inherit` preserve the
  inherited behavior. Notes attached to an inherited entry are still design input.
- `change` specifies intended behavior. Freeform text may describe new actions;
  it is not executable code or an assertion that the action already exists.
- `disable` explicitly requests no action in that scope. Retained text supplies
  context, not a competing active mapping.
- Screen-specific decisions override global decisions. Custom modes need their
  activation conditions defined in the corresponding screen notes.
- Blank change descriptions are unfinished decisions. The workbook allows them
  to be saved and flags them in the review view.

When implementing a bundle, read the brief and screen notes as well as every
assignment. Resolve unspecified details against the current implementation;
do not turn blank fields into disabled controls. Keep new behavior requirements
distinct from assignments to existing actions. Update runtime mappings and their
on-screen hints together, and test the resulting contexts and modifier behavior.

Current gamepad and keyboard references come from the repository's Node input
module; screen IDs come from the supplied backend registration. Action descriptions
summarize context-dependent behavior. Deck-specific inputs are design entries:
their browser/Steam Input availability and physical hardware remain unverified.

## Build and test

From the repository root:

```sh
node tools/zynthian-controller/control-map/build.mjs
cd tools/zynthian-controller/controller-node
npm test
npx playwright test --grep 'control worksheet'
```

Edit `page.html`, `editor.css`, `bundle.mjs` and `editor.mjs`, then rebuild the
offline artifact. `build.mjs` embeds the catalog, CSS and module source without
external imports. Tests cover freeform JSON round-trip, inheritance/disable
semantics, custom scopes, invalid imports, local draft recovery, text-only
rendering, offline operation and desktop/mobile layout. Browser evidence defaults
to `/tmp/crest-control-mapping-tests`; set `MAPPING_EVIDENCE` to another directory.
