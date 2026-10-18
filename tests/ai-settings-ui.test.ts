import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AiSettings } from '../src/AiSettings.js';

describe('provider settings markup', () => {
  it('offers actual local model IDs and honest privacy/runtime guidance in the existing disclosure', () => {
    const html = renderToStaticMarkup(createElement(AiSettings, {
      mode: 'local', onMode: () => {}, model: 'real-server-id', onModel: () => {}, models: ['real-server-id'], baseUrl: 'http://127.0.0.1:8080/v1',
      loading: false, localError: null, onRefresh: () => {}, cloud: { configured: false, provider: 'Google AI Studio', model: 'gemma-4-26b-a4b-it', message: 'Key needed' },
      busy: false, checking: false, ready: true, onCheck: () => {},
    }));
    expect(html).toContain('AI settings');
    expect(html).toContain('>Cloud</button>');
    expect(html).toContain('>Local</button>');
    expect(html).toContain('value="real-server-id" selected');
    expect(html).toContain('No automatic cloud fallback.');
    expect(html).toContain('loopback server');
    expect(html).not.toContain('I agree');
  });
});
