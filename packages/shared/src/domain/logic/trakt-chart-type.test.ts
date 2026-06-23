import { describe, it, expect } from 'bun:test';
import { chartTypeNeedsPeriod } from './trakt-chart-type.logic';

describe('chartTypeNeedsPeriod', () => {
  // period-suffixed Trakt endpoints (e.g. /movies/watched/weekly) — bare path 404s
  it.each(['favorited', 'played', 'watched', 'collected'] as const)(
    '%s needs a period segment',
    (type) => {
      expect(chartTypeNeedsPeriod(type)).toBe(true);
    }
  );

  it.each(['trending', 'popular', 'anticipated'] as const)('%s has no period', (type) => {
    expect(chartTypeNeedsPeriod(type)).toBe(false);
  });
});
