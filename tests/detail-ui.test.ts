import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AnimeDetail } from '../src/AnimeDetail.js';
import { entry } from './fixtures.js';

describe('detail source scores and incomplete metadata', () => {
  it('labels personal and community scores separately, retaining their source scales', () => {
    const anime = { ...entry(), personalScore: { value: 4, scale: 5, format: 'POINT_5' as const, normalized100: 80 }, communityScore: { value: 73, scale: 100 } };
    const html = renderToStaticMarkup(createElement(AnimeDetail, { anime, onClose: () => {} }));
    expect(html).toContain('<dt>Your score</dt><dd>4 / 5 (stars)</dd>');
    expect(html).toContain('<dt>Community score</dt><dd>73 / 100</dd>');
  });
  it('renders missing scores, synopsis and episode count honestly while keeping previews discoverable', () => {
    const html = renderToStaticMarkup(createElement(AnimeDetail, { anime: entry(1, null), onClose: () => {} }));
    expect(html).toContain('<dt>Your score</dt><dd>Unrated</dd>');
    expect(html).toContain('<dt>Length</dt><dd>Unknown</dd>');
    expect(html).toContain('No synopsis is available from the source.');
    expect(html).toContain('Search YouTube for a trailer');
    expect(html).toContain('Find on TikTok');
  });
});
