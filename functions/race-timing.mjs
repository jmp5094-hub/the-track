export const ODDS_SECONDS = 20;

// Missing metadata belongs to a race published before the shorter countdown.
// Keep that race's original start and settlement clock until it can be migrated.
export const auctionOddsSeconds = race => race.oddsSeconds === ODDS_SECONDS ? ODDS_SECONDS : 30;
export const privateCountdownSeconds = race => !race.started || race.countdownSeconds === ODDS_SECONDS ? ODDS_SECONDS : 30;
export const raceStartAt = race => race.startTime + (race.isAuction ? auctionOddsSeconds(race) * 1000 : 0);
export const privateStartAt = race => race.startedAt + privateCountdownSeconds(race) * 1000;
export const bettingClosesAt = race => race.startTime - (race.isAuction ? 0 : ODDS_SECONDS * 1000);

export function shortenUpcomingAuction(race, now) {
  // Leave the current presentation alone, including a small publication margin.
  return race.isAuction && race.status !== 'finished' && race.startTime > now + 30000 && race.oddsSeconds !== ODDS_SECONDS
    ? {...race, oddsSeconds: ODDS_SECONDS} : race;
}

// Publish a changed auction clock and any precomputed finish together. Rolls,
// seeds, winners, bids and pots remain untouched.
export async function publishAuctionTiming(db, races, now) {
  const next = races.map(race => shortenUpcomingAuction(race, now));
  const changed = next.filter((race, i) => race !== races[i]);
  if (!changed.length) return next;
  const results = await db.getAll(...changed.map(race => db.doc('raceRolls/' + race.id)));
  const batch = db.batch();
  results.forEach((doc, i) => {
    if (!doc.exists) return;
    const result = doc.data();
    if (Array.isArray(result.rolls)) batch.update(doc.ref, {visualFinishAt: raceStartAt(changed[i]) + 1300 + result.rolls.length * 3500});
  });
  batch.set(db.doc('global/auctionSchedule'), {races: next, generatedAt: now});
  await batch.commit();
  return next;
}
