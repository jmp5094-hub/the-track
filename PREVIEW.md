# Dice suspense preview

Open `/?demo=1` for The Brass Cup, a no-login Standard exhibition replay. Choose a runner, enable sound if wanted, and use **Closing stretch** for the last seven rolls. There are no wagers, balances or payouts in the exhibition. `/?account=1` opens the existing application.

## Presentation

- A horse's world position comes only from the saved engine positions. Horses that earn no movement hold their place; doubles use two separate movement beats.
- Dice settle before movement. Captions describe each die result and the exact positional change. Original horse numbers and colors remain consistent.
- The selected runner, leaders, remaining spaces and full course stay readable. The finish camera activates from actual distance remaining, with a fixed physical finish line.
- Trackside, steady-camera and 2D board views share the same playback. Reduced motion defaults to the board; WebGL failure and persistently slow rendering fall back to it.
- Pause, resume, restart, speed and finish replay are available in the exhibition. Refresh restores the last saved playback checkpoint in a paused state and retains the followed horse.
- The existing David Wolfe commentary is synchronized with the roll timeline. Sound requires opt-in.

## Preserved behavior

No edits to race simulation, server functions, payouts, balances, accounts, pari-mutuel calculations, or wager submission. Standard races use this presentation; other variants retain their existing screens. Inconsistent histories use the existing renderer.

The exhibition fixture is the existing frontend Standard engine's sunny seed 33, with 24 rolls. Cosmetic names do not alter its outcome.

## Verification and limits

`npm test` runs 13 tests including 300 seeded sunny/rain/fog histories, fixed-space movement, doubles, a three-space tiebreak, reveal timing, and fallback validation. `npm run build` builds the app. Existing Vite/Lottie bundle warnings remain.

An existing engine edge case is preserved and flagged: Standard fog seed 3 records horse 5 as the winner after a +1/-1 roll, but its final recorded position is 11/12. The preview rejects that contradictory final snapshot and uses the legacy renderer. No winning space is invented. This needs a separate rules/engine decision before a broader release.

Browser checks cover desktop/mobile exhibition, board and 3D modes, follow selection, finish replay and refresh. Authenticated end-to-end wagering has not been exercised. The original account, bank, bet-confirmation and payout logic is retained; source preservation checks compare it with the production baseline.

## Landscape and living-room revision

Wide screens now use a viewport-sized race stage with the dice and six runners alongside it. Short phone landscapes use the same arrangement with compact controls; full desktop and 1080p displays get larger dice, numbers and labels. A fullscreen control is available in supporting browsers. Portrait keeps its vertical layout.

Presentation highlights the selected number, doubles, and settled lead changes. Finish anticipation uses current positions and weather. These captions do not expose an unrevealed roll or change the race result. Pausing also freezes dice animation.

All races remain automatic. The exhibition still plays its saved engine history and has no wagers or payouts.

The suite now has 22 passing tests, including no premature dramatic callouts, camera stability across home-stretch rolls, audio preferences, and non-overlapping announcer cues. Casting to physical TV hardware has not been tested.

## November 27 audio and rollout revision

The finish-camera pan now runs only when a horse actually reaches the finish. The music is replaced with a short driving percussion bed, real crowd and hoofbeat stems, and more expressive calls from the existing David Wolfe voice. The mix responds to current revealed positions, ducks around commentary and decisive rolls, and supports crowd-plus-music, crowd-only and caller-only modes. Existing site music preferences still apply.

Protected race data is subscribed to only after authentication. The public demo links back to the full account app rather than the limited design fixture. Auctions, private races, bank, active bets, profile and rules remain in the real navigation. All races remain automatic; non-Standard formats and inconsistent saved histories retain the legacy renderer.
