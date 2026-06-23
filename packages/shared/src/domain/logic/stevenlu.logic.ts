/**
 * StevenLu Popular Movies variants.
 *
 * sjlu/popular-movies publishes several JSON lists that differ ONLY by URL
 * (a curated popular list, the full dump, and rating-threshold filters).
 * This map is the single source of truth: the frontend renders the dropdown
 * from it, and the backend validates/looks up against it (closes SSRF on the
 * raw fetch). The resolved URL is stored in media_lists.url.
 */

const STEVENLU_BASE_URL = 'https://popular-movies-data.stevenlu.com';

interface StevenLuVariantInfo {
  /** Human label shown in the dropdown and baked into the list name. */
  label: string;
  /** JSON filename under STEVENLU_BASE_URL. */
  file: string;
}

/**
 * variantKey -> { label, file }. Key is stable; do not rename keys without a
 * data migration (the resolved URL, not the key, is what gets stored).
 */
export const StevenLuVariants = {
  popular: { label: 'Popular Movies', file: 'movies.json' },
  all: { label: 'All Movies', file: 'all-movies.json' },
  'metacritic-min50': { label: 'Metacritic 50+', file: 'movies-metacritic-min50.json' },
  'metacritic-min60': { label: 'Metacritic 60+', file: 'movies-metacritic-min60.json' },
  'metacritic-min70': { label: 'Metacritic 70+', file: 'movies-metacritic-min70.json' },
  'metacritic-min80': { label: 'Metacritic 80+', file: 'movies-metacritic-min80.json' },
  'imdb-min5': { label: 'IMDb 5+', file: 'movies-imdb-min5.json' },
  'imdb-min6': { label: 'IMDb 6+', file: 'movies-imdb-min6.json' },
  'imdb-min7': { label: 'IMDb 7+', file: 'movies-imdb-min7.json' },
  'imdb-min8': { label: 'IMDb 8+', file: 'movies-imdb-min8.json' },
  'rottentomatoes-min50': { label: 'Rotten Tomatoes 50+', file: 'movies-rottentomatoes-min50.json' },
  'rottentomatoes-min60': { label: 'Rotten Tomatoes 60+', file: 'movies-rottentomatoes-min60.json' },
  'rottentomatoes-min70': { label: 'Rotten Tomatoes 70+', file: 'movies-rottentomatoes-min70.json' },
  'rottentomatoes-min80': { label: 'Rotten Tomatoes 80+', file: 'movies-rottentomatoes-min80.json' },
} as const satisfies Record<string, StevenLuVariantInfo>;

export type StevenLuVariant = keyof typeof StevenLuVariants;

/** Default variant used for legacy lists and as the dropdown default. */
export const DEFAULT_STEVENLU_VARIANT: StevenLuVariant = 'popular';

export function stevenLuVariantUrl(variant: StevenLuVariant): string {
  return `${STEVENLU_BASE_URL}/${StevenLuVariants[variant].file}`;
}

/** All valid StevenLu URLs. Source for the SSRF guard. */
export const stevenLuVariantUrls: string[] = (
  Object.keys(StevenLuVariants) as StevenLuVariant[]
).map(stevenLuVariantUrl);

/** SSRF guard: is this URL one of the known StevenLu variants? */
export function isKnownStevenLuUrl(url: string): boolean {
  return stevenLuVariantUrls.includes(url);
}

/** Reverse lookup for the edit dialog's read-only, pre-selected dropdown. */
export function stevenLuVariantFromUrl(url: string): StevenLuVariant | null {
  for (const key of Object.keys(StevenLuVariants) as StevenLuVariant[]) {
    if (stevenLuVariantUrl(key) === url) return key;
  }
  return null;
}
