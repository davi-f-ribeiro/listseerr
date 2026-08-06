import { describe, expect, test } from 'bun:test';
import { toTmdbLookupResult } from './mapping';

describe('toTmdbLookupResult', () => {
  test('reads a TV mapping', () => {
    expect(toTmdbLookupResult({ anilist_id: 290, themoviedb_id: { tv: 26209 } })).toEqual({
      tmdbId: 26209,
      type: 'tv',
    });
  });

  test('reads a movie mapping from an array', () => {
    expect(toTmdbLookupResult({ anilist_id: 821, themoviedb_id: { movie: [1390599] } })).toEqual({
      tmdbId: 1390599,
      type: 'movie',
    });
  });

  test('prefers the TMDB key over the Fribb type field', () => {
    // Fribb labels plenty of TMDB movies as OVA/Special.
    expect(toTmdbLookupResult({ type: 'OVA', themoviedb_id: { movie: [1390599] } })?.type).toBe(
      'movie'
    );
    expect(toTmdbLookupResult({ type: 'MOVIE', themoviedb_id: { tv: 26209 } })?.type).toBe('tv');
  });

  test('returns null when there is no TMDB mapping', () => {
    expect(toTmdbLookupResult({ anilist_id: 1 })).toBeNull();
    expect(toTmdbLookupResult({ themoviedb_id: {} })).toBeNull();
    expect(toTmdbLookupResult({ themoviedb_id: { movie: [] } })).toBeNull();
  });

  // The Fribb payload is cast, not parsed, so bad shapes must not reach MediaItemVO.
  test('rejects non-positive-integer ids instead of passing them through', () => {
    const bogus = [{ tv: 0 }, { tv: -1 }, { tv: 1.5 }, { tv: '26209' }, { tv: { tv: 26209 } }];
    for (const themoviedb_id of bogus) {
      expect(toTmdbLookupResult({ themoviedb_id } as never)).toBeNull();
    }
  });
});
