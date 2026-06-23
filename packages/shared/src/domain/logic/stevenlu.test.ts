import { describe, it, expect } from 'bun:test';
import {
  StevenLuVariants,
  stevenLuVariantUrl,
  stevenLuVariantUrls,
  isKnownStevenLuUrl,
  stevenLuVariantFromUrl,
  DEFAULT_STEVENLU_VARIANT,
} from './stevenlu.logic';

describe('stevenLu variants', () => {
  it('round-trips every variant: url -> variant -> url', () => {
    for (const key of Object.keys(StevenLuVariants) as (keyof typeof StevenLuVariants)[]) {
      const url = stevenLuVariantUrl(key);
      expect(stevenLuVariantFromUrl(url)).toBe(key);
    }
  });

  it('accepts every published variant URL', () => {
    expect(stevenLuVariantUrls.every(isKnownStevenLuUrl)).toBe(true);
    expect(stevenLuVariantUrls.length).toBe(Object.keys(StevenLuVariants).length);
  });

  it('rejects unknown / SSRF URLs', () => {
    for (const bad of [
      'http://169.254.169.254/latest/meta-data/',
      'https://popular-movies-data.stevenlu.com/../secrets',
      'https://s3.amazonaws.com/popular-movies/movies.json', // legacy domain, no longer accepted
      'https://evil.example.com/movies.json',
      '',
    ]) {
      expect(isKnownStevenLuUrl(bad)).toBe(false);
      expect(stevenLuVariantFromUrl(bad)).toBeNull();
    }
  });

  it('default variant is a known variant', () => {
    expect(StevenLuVariants[DEFAULT_STEVENLU_VARIANT]).toBeDefined();
    expect(isKnownStevenLuUrl(stevenLuVariantUrl(DEFAULT_STEVENLU_VARIANT))).toBe(true);
  });
});
