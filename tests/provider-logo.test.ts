import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ProviderLogo } from '../src/ProviderLogo.js';

describe('local provider marks', () => {
  it.each(['anilist', 'mal'] as const)('renders %s as an inline mark without a remote image dependency', provider => {
    const html = renderToStaticMarkup(createElement(ProviderLogo, { provider }));
    expect(html).toContain('<svg');
    expect(html).toContain('<path d=');
    expect(html).toContain('aria-hidden="true"');
    expect(html).not.toContain('<img');
  });
});
