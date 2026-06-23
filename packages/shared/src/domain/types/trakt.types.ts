/**
 * Trakt Types
 *
 * Pure TypeScript contracts for Trakt-related data.
 * Schemas must satisfy these types.
 */

export type TraktClientIdPrimitive = string;

export const TraktChartTypeValues = {
  TRENDING: 'trending',
  POPULAR: 'popular',
  FAVORITED: 'favorited',
  PLAYED: 'played',
  WATCHED: 'watched',
  COLLECTED: 'collected',
  ANTICIPATED: 'anticipated',
} as const;

export type TraktChartType = (typeof TraktChartTypeValues)[keyof typeof TraktChartTypeValues];

export const TraktMediaTypeValues = {
  MOVIES: 'movies',
  SHOWS: 'shows',
} as const;

export type TraktMediaType = (typeof TraktMediaTypeValues)[keyof typeof TraktMediaTypeValues];

export const TraktChartPeriodValues = {
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
  YEARLY: 'yearly',
  ALL: 'all',
} as const;

export type TraktChartPeriod = (typeof TraktChartPeriodValues)[keyof typeof TraktChartPeriodValues];

/** Trakt's own default period for period-based charts. */
export const DEFAULT_TRAKT_CHART_PERIOD: TraktChartPeriod = TraktChartPeriodValues.WEEKLY;

export interface TraktConfigPrimitive {
  clientId: TraktClientIdPrimitive;
}
