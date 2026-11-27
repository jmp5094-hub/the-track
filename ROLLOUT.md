# Complete broadcast rollout — 27 November 2026

All public, auction, private and replay races use the same broadcast renderer. The old race-screen fallback is removed. The green, ivory and brass theme covers the existing menus, bank, auctions, tickets, profiles and help; horse silk colors remain identifying colors.

## Race coverage

| Format | Conditions | Visual behavior |
|---|---|---|
| Standard | Clear, rain, fog | Two dice; fixed spaces; weather modifiers |
| Down & Back | Clear, rain, fog | Turn at 12; return to the home finish |
| Hurdles | Clear, rain, fog | Stop at 5; doubles jump to 7 |
| Magic Dice | Clear | First die selects horse, second distance; out and back |
| Triple Dice | Clear, rain, fog | Three dice, including repeated numbers |

New official races receive engineVersion 2 from the backend. Existing scheduled races and recorded results retain version 1. Version 2 fixes fog declaring a winner before a later die reverses it, repeated finish entries, hurdle backsteps and return-leg/tiebreak handling. Recorded older results are never recalculated with the new rules. Historical anomalies are labeled rather than inventing extra earned spaces.

Official schedules and public roll histories come only from the backend. Clients no longer generate replacement schedules or simulate public results. The cron waits for each recorded visual finish, including races longer than the previous 250-second cutoff. Private races share their seed, condition and start time through Firestore.

Production verification exposed an existing seed archive at Firestore's 1 MiB document limit. New race seeds now live in individual server-only documents under `private/raceSeeds/races/{raceId}`, committed before their schedules are published. The legacy archive remains intact and readable for existing races. Both the scheduled and manual recovery handlers use this storage path.

## Balance and ticket behavior

- Ticket confirmation, edits and shared-pool contributions commit together; edits charge/refund the difference.
- Each user has a settlement receipt. Retries and concurrent tabs cannot credit the same ticket twice; the shared pool remains available to other bettors.
- Bank balance and ledger writes are atomic and keyed by operation ID.
- Authenticated `placeAuctionBid` reserves the leading bid and refunds an outbid user in a server transaction. Finalization is idempotent, including unsold horses and one-horse ownership.
- Private-room create/join/confirm/start/settle uses shared transactions and the selected condition.
- New settlement history retains seed, version, weather and horse names for replay. A missing recording and seed produces an explicit unavailable state.

## Verification

`npm test`: 50 passing tests, including 3,250 version-2 and 3,250 archived format/condition simulations. Assertions cover finishes, exact earned spaces, weather, hurdle events, tiebreak eligibility, server/client agreement, preserved recorded winners, camera stability and non-overlapping commentary cues.

`npm run test:finance`: 8 passing emulator tests (including nested groups), using separate authenticated clients and a copy of the actual production Firestore rules. Covers competing bids/refunds, overdrafts, ticket editing/retries, proportional multi-user payouts, all 13 private setups and scheduler migration/recovery. Scheduler tests invoke both real handlers against demo-track only, preserve a near-limit legacy archive, verify new seed commitments and later reveals, and confirm that clients cannot read or write private seed documents.

Run emulators with Java 21+ and Node 24:

```sh
firebase emulators:start --only auth,firestore,functions --project demo-track --config firebase.test.json
npm run test:finance
```

Browser QA uses `npm run dev`, `node tests/seed-browser.cjs`, then `http://127.0.0.1:5173/?qa=1`. It targets only demo-track on localhost and is disabled in production builds. Do not use production accounts for transaction tests.

Observed browser flows: sign-in, regular ticket confirmation/downward edit, bank deposit/withdrawal with dated ledger, private fog/hurdle room and automatic countdown, auction bid/ownership/ticket/countdown/Magic Dice race/payout/replay, Triple Dice fog finish, profile statistics, mobile menus, help and race-chat opening. No live financial actions were used for QA.

Responsive checks include 1366×900 desktop, 844×390 landscape and 390×844 portrait. Fixed navigation and chat no longer cover the broadcast; three dice have their own space in narrow layouts. Steady 3D and board view remain available. Actual TV casting and subjective audio listening were not tested; sound timing, mix controls and cue scheduling were checked.

`npm run build` passes. Vite reports the existing large-chunk advisory. Compatible backend dependency updates remove the reported high/critical npm findings; moderate transitive findings remain.

## Release order and recovery

1. Push the tested commit to the preview branch and verify its Vercel build and browser presentation.
2. Deploy functions explicitly to `the-track-c8138`: `firebase deploy --only functions --project the-track-c8138`. This includes the new authenticated auction callable. Do not deploy test rules.
3. Fast-forward main to the same tested commit; the existing Vercel integration deploys production.
4. Verify the production SHA, custom domains, frontend and three Firebase functions.

Pre-rollout frontend rollback: Vercel deployment `dpl_Ah7YLTq1jQCbcUhPHRwBLJ3ws2ab`, commit `a73d95060b0b5f2039ae3d773542637833494c25`. Keep the compatible backend deployed when rolling back only the frontend. A full backend rollback requires the previous source at that commit and an explicit project target; review races already created with version 2 before doing so. Never reset balances, pools, histories, receipts or private rooms to roll back presentation.
