import { fortyFiveTest } from '../fortyFive.js';

/**
 * 45-degree rule from the neighbour window the applicant marked on the map. Council guidance, not part of the GPDO,
 * so a breach is a WARNING (and counts in the council-guidance outlook), never a permitted-development fail.
 * result.fortyFive = { status: 'unavailable' | 'clear' | 'breach', excessM, dir }
 */
export const fortyFiveRule = {
  id: 'forty-five',
  run({ P, fortyFive }, result) {
    if (!fortyFive) return;
    const r = fortyFiveTest({ P, window: fortyFive.xy, rearBearingDeg: fortyFive.rearBearingDeg });
    result.fortyFive = r;
    result.items.push(r.status === 'breach'
      ? { status: 'warn', message: `The work crosses the council's 45-degree line from the neighbour's window you marked, by about ${r.excessM} m. Councils use this test to protect a neighbour's light and outlook, and may refuse a design that breaks it.` }
      : { status: 'pass', message: 'Within the 45-degree line from the neighbour\'s window you marked (council guidance – the true window position matters, so check it on site).' });
  },
};
