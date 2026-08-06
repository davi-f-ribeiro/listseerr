/**
 * Anime ID Mapping
 *
 * Pure helpers for reading TMDB mappings out of Fribb anime-lists entries.
 * Kept separate from the cache client so they can be tested without a database.
 */

import type { AnimeIdEntry, TmdbLookupResult } from './types';

/**
 * Fribb reports TMDB ids either as a single number or as an array of numbers
 * (a handful of entries map one anime to several TMDB movies).
 */
function firstId(value: number | number[] | undefined): number | null {
  // ponytail: first id wins for multi-id entries; revisit if Seerr should request all of them.
  const id = Array.isArray(value) ? value[0] : value;
  return typeof id === 'number' && Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Extracts the TMDB id and media type from a Fribb entry.
 *
 * The media type comes from the `themoviedb_id` key rather than the entry's own
 * `type` field: Fribb labels plenty of TMDB movies as OVA/Special, and Seerr
 * needs the type TMDB itself uses.
 */
export function toTmdbLookupResult(entry: AnimeIdEntry): TmdbLookupResult | null {
  const movieId = firstId(entry.themoviedb_id?.movie);
  if (movieId !== null) {
    return { tmdbId: movieId, type: 'movie' };
  }

  const tvId = firstId(entry.themoviedb_id?.tv);
  if (tvId !== null) {
    return { tmdbId: tvId, type: 'tv' };
  }

  return null;
}
