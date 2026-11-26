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

Browser checks cover desktop/mobile exhibition, board and 3D modes, follow selection, finish replay and refresh. Account and wagering flows require a separate authenticated regression pass before production. No production deployment is part of this preview.
