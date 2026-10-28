export const SILKS = ['#cf6758', '#719dbf', '#d7ba72', '#78a58c', '#ac8ec1', '#d69b6d'];
export const RACE_LABELS = { standard: 'Classic', down_back: 'Down & Back', hurdle: 'Hurdles', magic_dice: 'Magic Dice', triple_dice: 'Triple Dice' };

export function progressFor(position, returning, type, phase = 'main') {
  const pos = Math.max(0, Number(position) || 0);
  if (phase === 'tiebreak') return Math.min(1, pos / 3);
  const roundTrip = type === 'down_back' || type === 'magic_dice';
  return Math.min(1, roundTrip ? (returning ? 24 - pos : pos) / 24 : pos / 12);
}

export function raceOrder(positions, legDone, type, phase, tieHorses) {
  return positions.map((position, id) => ({ id, progress: progressFor(position, legDone[id], type, phase) }))
    .filter(h => phase !== 'tiebreak' || !tieHorses || tieHorses.includes(h.id))
    .sort((a, b) => b.progress - a.progress || a.id - b.id);
}

export function rollCaption({ diceResult, rolling, winner, names, rollCount, phase }) {
  if (winner !== null && winner !== undefined) return `${names[winner]} wins the race.`;
  if (rolling) return 'The dice are in the air…';
  if (!diceResult || !rollCount) return 'Six horses. One shared race. Here we go.';
  const moves = diceResult.moves || [];
  // Dice allot movement; hurdles, turns and track boundaries can limit it.
  const actions = moves.map(m => `${names[m.horse]}: ${m.steps > 0 ? `+${m.steps} on the dice` : m.steps < 0 ? `${m.steps} in the fog` : 'mud skip'}`);
  const prefix = phase === 'tiebreak' ? 'Tiebreak. ' : diceResult.isDoubles ? 'Doubles! ' : '';
  return prefix + (actions.length ? actions.join(' · ') : 'No horse advances this roll.');
}

// Gross return includes the winning stake. Zero backing is not infinite odds.
export function poolReturns(pool, locked) {
  if (!locked) return null;
  const stakes = Array.from({ length: 6 }, (_, i) => Math.max(0, Number(pool[i]) || 0));
  const total = stakes.reduce((sum, value) => sum + value, 0);
  return stakes.map(stake => stake > 0 && total > 0 ? total / stake : null);
}
