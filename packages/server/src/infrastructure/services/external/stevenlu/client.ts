import { LoggerService } from '@/server/infrastructure/services/core/logger.adapter';
import { db } from '@/server/infrastructure/db/client';
import { providerCache } from '@/server/infrastructure/db/schema';
import { eq } from 'drizzle-orm';
import { isKnownStevenLuUrl } from 'shared/domain/logic';
import { MAX_ITEMS } from 'shared/presentation/schemas';
import type { StevenLuItem } from './types';
import type { MediaItemDTO } from 'shared/application/dtos';

const logger = new LoggerService('stevenlu-client');

const CACHE_DURATION_MS = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Fetch a StevenLu list variant with 24-hour caching, keyed by URL.
 *
 * @param url - One of the known StevenLu variant URLs (validated against the
 *   shared map; rejected otherwise to prevent fetching arbitrary hosts)
 * @param maxItems - Maximum number of items to return (takes first N items)
 * @returns Array of MediaItem objects
 */
export async function fetchStevenLuList(
  url: string,
  maxItems: number | null
): Promise<MediaItemDTO[]> {
  // Defense in depth: the API schema already restricts this, but the URL is
  // read from storage (a separate trust boundary) and flows into a raw fetch.
  if (!isKnownStevenLuUrl(url)) {
    throw new Error(`Refusing to fetch unrecognized StevenLu URL: ${url}`);
  }

  try {
    logger.info({ url, maxItems }, 'Fetching StevenLu list');

    // Check cache first (keyed by variant URL)
    const [cachedData] = await db
      .select()
      .from(providerCache)
      .where(eq(providerCache.cacheKey, url))
      .limit(1);

    const now = new Date();
    let items: StevenLuItem[] = [];

    // Check if cache exists and is still valid (< 24 hours old)
    if (cachedData) {
      const cacheAge = now.getTime() - cachedData.cachedAt.getTime();

      if (cacheAge < CACHE_DURATION_MS) {
        logger.debug(
          {
            cacheAge: Math.floor(cacheAge / 1000 / 60), // minutes
            cacheExpiresIn: Math.floor((CACHE_DURATION_MS - cacheAge) / 1000 / 60), // minutes
          },
          'Using cached StevenLu data'
        );
        items = JSON.parse(cachedData.data) as StevenLuItem[];
      } else {
        logger.info(
          { cacheAge: Math.floor(cacheAge / 1000 / 60) },
          'Cache expired, fetching fresh data'
        );
      }
    } else {
      logger.info('No cache found, fetching fresh data');
    }

    // Fetch fresh data if cache is invalid or doesn't exist
    if (items.length === 0) {
      logger.info({ url }, 'Fetching from StevenLu API');

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        const errorBody = await response.text();
        logger.error(
          {
            status: response.status,
            statusText: response.statusText,
            url,
            responseBody: errorBody,
          },
          'StevenLu API request failed'
        );
        throw new Error(`StevenLu API error: ${response.statusText}`);
      }

      items = (await response.json()) as StevenLuItem[];
      logger.info({ count: items.length }, 'Received items from StevenLu API');

      // Cap what we persist: no list can request more than MAX_ITEMS, so storing
      // beyond that just bloats the cache (matters for the full all-movies dump).
      items = items.slice(0, MAX_ITEMS);

      // Update cache
      const dataJson = JSON.stringify(items);

      if (cachedData) {
        // Update existing cache
        await db
          .update(providerCache)
          .set({
            data: dataJson,
            cachedAt: now,
          })
          .where(eq(providerCache.cacheKey, url));

        logger.info('Updated StevenLu cache');
      } else {
        // Insert new cache entry
        await db.insert(providerCache).values({
          cacheKey: url,
          data: dataJson,
          cachedAt: now,
        });

        logger.info('Created StevenLu cache');
      }
    }

    // Apply maxItems limit if specified (take first N items)
    let limitedItems = items;
    if (maxItems && maxItems > 0) {
      limitedItems = items.slice(0, maxItems);
      logger.info(
        {
          totalItems: items.length,
          requestedMax: maxItems,
          returnedItems: limitedItems.length,
        },
        'Applied maxItems limit'
      );
    }

    // Transform to MediaItemDTO format
    const mediaItems = limitedItems
      .map(transformStevenLuItem)
      .filter((item): item is MediaItemDTO => item !== null);

    logger.debug(
      {
        total: limitedItems.length,
        withTmdbId: mediaItems.length,
      },
      'Transformed StevenLu items'
    );

    return mediaItems;
  } catch (error) {
    logger.error({ error }, 'Error fetching StevenLu list');
    throw error;
  }
}

function transformStevenLuItem(item: StevenLuItem): MediaItemDTO | null {
  // Skip items without TMDB ID (required for Seerr)
  if (!item.tmdb_id) {
    return null;
  }

  return {
    title: item.title,
    year: null, // StevenLu doesn't provide year information
    tmdbId: item.tmdb_id,
    mediaType: 'movie', // All items in StevenLu list are movies
  };
}
