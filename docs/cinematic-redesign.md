# The Track — clubhouse prototype

This branch builds the first playable version of a new clubhouse experience around the existing shared dice game. It is a review branch, not a real-money release.

## Try it

```sh
npm ci
npm run dev
```

Open `/?showcase=1` on the development or preview host. `/showcase` also works on hosts configured for single-page application routing. The query route works without additional hosting rewrites.

The showcase loads separately from the account application and never initializes Firebase. Its pool, 10-credit ticket and resulting balance changes are illustrative and local to that page. It makes no wager, account or payment writes. Choose any of the five formats and three conditions, lock the demo ticket, watch the reveal, then follow the race. Sound is opt-in. Pause, resume and replay are available. Replay uses the same dice history; a new demo generates a new seed.

## What changed

- Green, ivory and brass clubhouse design for navigation, race discovery, tickets, odds reveal, racing and results.
- A miniature 3D racecourse with articulated horses, track lighting, weather, hurdles and broadcast/follow/overhead cameras. A complete animated SVG broadcast takes over if WebGL cannot initialize or loses its context.
- Exact positions remain in a readable running-order panel. Camera movement never changes a result. The existing classic track remains available, with a button to return to the cinematic view.
- Dice, callouts, selected-horse highlighting, optional local demo voice/music, reduced-motion support and existing live room chat.
- Odds appear only after lock in the new UI. The pre-close ticket view receives no per-horse pool data. Popularity sets returns, never movement probability.
- Results distinguish gross credits returned from net profit/loss. Winner commentary no longer invents a payout or computes one from just the spectator's bets.
- The existing pure roll-history simulator moved into `src/cinematic/rules.mjs` unchanged. Settlement, scheduling, backend functions, auth and payment behavior were not redesigned.

Account panels, auctions, private-room setup and authentication retain their existing screens. Live horse names are preserved; procedural horses currently use six fixed coats. Final art direction, commissioned horse assets and licensed audio can replace these prototype assets without touching race logic.

## Verification

`npm test` checks 3,750 complete race histories against frozen digests produced from the original simulator in commit `492cffecfe89d3ae37e1612d79c229a6a73de2b0`: 250 seeds × five formats × three conditions. It also checks pre-close payout concealment, gross-return arithmetic, return-leg ordering, tiebreak filtering and accurate dice callouts.

`npm run build` compiles the full app and the isolated showcase. Existing Lottie eval and large-bundle warnings remain; no new backend dependency is added.

Browser QA covered the animated SVG fallback, a 390px mobile viewport, hidden odds before lock, post-lock odds, a complete Magic Dice race, pause/resume, and replay with the same winner and final positions. The ticket component was tested with isolated sample data for over-budget rejection and confirmation. No live bets were submitted. The review browser has WebGL disabled, so 3D rendering and performance still require a GPU-equipped device check before merge. Audio availability depends on the device/browser and also needs a listening pass. The signed-in live end-to-end flow needs a staging-account smoke test before merge.

## Next production phase

The visual prototype is suitable for product feedback; the existing trust model requires separate engineering before money is involved. In particular, audit client balance updates and settlement, enforce ticket deadlines and pool disclosure on the server, validate production Firestore rules, and restrict seed/outcome disclosure. Hiding odds in the UI alone is not an access-control guarantee. The simulator regression test preserves current rules; it is not a certification of those rules or of randomness.

A money pilot should follow a separately scoped server-authoritative ledger/settlement design, independent security and game-math review, and advice for the intended jurisdiction and operating partner. No payment collection, deposits, withdrawals or real-money enablement is included here.

For the next experience iteration: commission final horse animation and audio, refine the 3D cameras on phones, make the host's role central to the room, and test shared cheering/reactions with a real group. Any pre-close social signals must avoid exposing horse popularity.
