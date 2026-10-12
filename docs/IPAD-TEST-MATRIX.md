# iPad interaction test matrix

This checklist is the required manual verification surface for touch and Apple Pencil changes. It must be run in an Obsidian mobile vault on the target device; a successful build does not replace device testing.

Record the device model, iPadOS version, Obsidian version, orientation, and split-view state with each pass.

## Devices and layouts

- [ ] iPad with Apple Pencil — device: __________ iPadOS: __________ Obsidian: __________
- [ ] iPad without Apple Pencil — device: __________ iPadOS: __________ Obsidian: __________
- [ ] Portrait
- [ ] Landscape
- [ ] Split view / narrow pane
- [ ] External keyboard, mouse, or trackpad

## Navigation and gestures

- [ ] One-finger drag on empty canvas pans without selecting cards.
- [ ] One-finger drag on a card opens the long-press menu only after a stationary hold; movement pans normally.
- [ ] Two-finger pan moves the camera.
- [ ] Pinch zooms around the gesture midpoint.
- [ ] A second finger landing during a Pencil/card drag cancels the single-pointer operation without committing it.
- [ ] Pointer cancellation, system edge swipe, app backgrounding, and view switching leave no stuck drag or overlay.
- [ ] Orientation and split-view resizing keep the board, drawing surface, and popovers usable.

## Pencil and drawing

- [ ] Pencil moves, resizes, and connects cards.
- [ ] Pencil draws with pressure in Draw and Sketch modes.
- [ ] A resting palm does not create or modify strokes while Pencil is down.
- [ ] Pencil double-tap actions still work.
- [ ] Escape discards an active drawing; explicit Save persists it.
- [ ] Cancelling or closing the view during drawing leaves no stale session or listener.

## Toolbar and media

- [ ] Touch/Pencil toolbar drag creates the selected card at the release point.
- [ ] A stationary toolbar tap shows the drag hint and creates nothing.
- [ ] Recording with permission granted saves a playable file.
- [ ] Escape, outside tap, view switching, and app interruption cancel recording without saving.
- [ ] Stop intentionally saves exactly one recording.
- [ ] Unsupported microphone/codec and denied permission show an actionable status.
- [ ] Audio and video playback errors are visible; controls remain finger-accessible.
- [ ] Files app, camera/file picker, paste, and Obsidian file-explorer imports work.
- [ ] JSON Canvas export opens in Obsidian Canvas and imported `.canvas` nodes/groups/edges appear in the current board.

## Desktop regression

- [ ] Mouse drag, wheel zoom, Ctrl/Cmd-wheel zoom, Space-pan, right-click, double-click, and Alt-drag duplicate remain unchanged.
- [ ] Developer console has no errors during the above checks.

## Automated checks

Run from the repository root:

```text
npm test
npm run build
git diff --check
```

## Compatibility gate

The plugin declares `minAppVersion: 1.4.0` in `manifest.json`. Run this matrix on the oldest supported Obsidian desktop/mobile versions before changing that declaration.

Date: __________  Tester: __________  Result/notes: ______________________________
