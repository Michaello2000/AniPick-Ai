import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { MediaPlayer } from '../src/MediaPlayer.js';
import { AnimePreviews } from '../src/AnimePreviews.js';
import { entry } from './fixtures.js';

describe('media privacy and fallback rendering', () => {
  it('does not mount a third-party player before the viewer requests it', () => {
    for (const kind of ['youtube', 'tiktok'] as const) {
      const html = renderToStaticMarkup(createElement(MediaPlayer, { kind, videoId: kind === 'youtube' ? 'Abc_def-123' : '6718335390845095173', title: 'Test title', externalUrl: kind === 'youtube' ? 'https://www.youtube.com/watch?v=Abc_def-123' : 'https://www.tiktok.com/@scout2015/video/6718335390845095173' }));
      expect(html).not.toContain('<iframe');
      expect(html).not.toContain('<script');
      expect(html).toContain('Load ');
      expect(html).toContain('Playback stays off');
    }
  });
  it('keeps search fallbacks and spoiler disclosure available while metadata loads', () => {
    const html = renderToStaticMarkup(createElement(AnimePreviews, { anime: entry() }));
    expect(html).toContain('Search YouTube for a trailer');
    expect(html).toContain('Find on TikTok');
    expect(html).toContain('may contain spoilers');
    expect(html).toContain('Checking source trailer metadata');
    expect(html).not.toContain('<iframe');
  });
});
