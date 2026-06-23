import { describe, it, expect } from 'bun:test';
import { parseTraktChartUrl } from './trakt-chart-url.logic';

describe('parseTraktChartUrl', () => {
  it('parses a period chart URL (display)', () => {
    expect(parseTraktChartUrl('https://trakt.tv/movies/watched/weekly')).toEqual({
      mediaType: 'movies',
      chartType: 'watched',
      period: 'weekly',
    });
  });

  it('parses a period chart URL (api)', () => {
    expect(parseTraktChartUrl('https://api.trakt.tv/shows/collected/monthly')).toEqual({
      mediaType: 'shows',
      chartType: 'collected',
      period: 'monthly',
    });
  });

  it('parses a bare chart URL with no period (self-heal case)', () => {
    expect(parseTraktChartUrl('https://api.trakt.tv/movies/watched')).toEqual({
      mediaType: 'movies',
      chartType: 'watched',
    });
  });

  it('parses a non-period chart URL', () => {
    expect(parseTraktChartUrl('https://trakt.tv/movies/trending')).toEqual({
      mediaType: 'movies',
      chartType: 'trending',
    });
  });

  it('rejects an unknown period', () => {
    expect(parseTraktChartUrl('https://trakt.tv/movies/watched/hourly')).toBeNull();
  });
});
