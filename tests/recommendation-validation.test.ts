import { describe, expect, it } from 'vitest';
import { validateProfile, validateRanking, validateSelection, parseModelJson } from '../server/recommendations/validation.js';
import { entry } from './fixtures.js';
import { compactAnime } from '../server/recommendations/data.js';

const history = [compactAnime({ ...entry(1), status: 'completed', genres: ['Drama'], tags: ['Space'] })];
const candidates = [compactAnime({ ...entry(2), genres: ['Drama'], tags: ['Space'] })];
const profile = { summary: 'You gravitate toward drama.', likes: [{ pattern: 'Dramatic stories', history_ids: ['anilist:1'] }], possible_dislikes: [], limitations: ['One history entry; taste is uncertain.'] };
const ranking = { recommendations: [{ candidate_id: 'anilist:2', reason: 'Its dramatic themes align with your history.', history_ids: ['anilist:1'], shared_genres: ['Drama'], shared_tags: ['Space'], confidence: 'low', tradeoff: null }] };
const selection = { recommendations: [{ candidate_id: 'anilist:2', reason: 'Its dramatic themes align with your history.', history_ids: ['anilist:1'], confidence: 'low', tradeoff: null }] };

describe('semantic AI response validation', () => {
  it('accepts structured results grounded in the supplied source IDs', () => {
    expect(validateProfile(profile, history)).toEqual(profile);
    expect(validateRanking(ranking, history, candidates, 5).recommendations).toHaveLength(1);
  });
  it('reports safe validation categories and fields without echoing rejected values', () => {
    expect(() => parseModelJson('private model prose')).toThrow(expect.objectContaining({ reason: 'json' }));
    expect(() => validateProfile({ ...profile, summary: 7, secret_private_field: 'never echo this' }, history)).toThrow(expect.objectContaining({ reason: 'schema', fields: expect.arrayContaining(['summary']) }));
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], candidate_id: 'private-invented-id' }] }, history, candidates, 5)).toThrow(expect.objectContaining({ reason: 'candidate_ids' }));
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], shared_tags: ['private invented trait'] }] }, history, candidates, 5)).toThrow(expect.objectContaining({ reason: 'shared_traits' }));
    try { validateProfile({ ...profile, summary: 7, secret_private_field: 'never echo this' }, history); }
    catch (error) { expect(String(error)).not.toMatch(/secret_private_field|never echo this/); }
  });
  it('distinguishes unsupported prose claims from malformed JSON', () => {
    expect(() => validateProfile({ ...profile, summary: 'You gave this 9/10.' }, history)).toThrow(expect.objectContaining({ reason: 'prose' }));
  });
  it('derives factual shared traits from the selected candidate and cited history', () => {
    expect(validateSelection(selection, history, candidates, 5)).toEqual(ranking);
    const extraHistory = compactAnime({ ...entry(3), status: 'completed', genres: ['Comedy'], tags: [] });
    const mixedCandidate = { ...candidates[0]!, genres: ['Drama', 'Comedy'] };
    const cited = { recommendations: [{ ...selection.recommendations[0], history_ids: ['anilist:3'] }] };
    expect(validateSelection(cited, [...history, extraHistory], [mixedCandidate], 5).recommendations[0]).toMatchObject({ shared_genres: ['Comedy'], shared_tags: [] });
  });
  it('keeps strict ID, citation, prose, and result-count checks on model selections', () => {
    for (const candidate_id of ['invented:9', 'anilist:1']) {
      expect(() => validateSelection({ recommendations: [{ ...selection.recommendations[0], candidate_id }] }, history, candidates, 5)).toThrow();
    }
    expect(() => validateSelection({ recommendations: [{ ...selection.recommendations[0], history_ids: ['not-sent'] }] }, history, candidates, 5)).toThrow();
    expect(() => validateSelection({ recommendations: [{ ...selection.recommendations[0], reason: 'A 99% match.' }] }, history, candidates, 5)).toThrow();
    expect(() => validateSelection(selection, history, candidates, 0)).toThrow();
    expect(() => validateSelection({ recommendations: [selection.recommendations[0], selection.recommendations[0]] }, history, candidates, 5)).toThrow();
  });
  it('does not let model selections inject metadata fields', () => {
    expect(() => validateSelection({ recommendations: [{ ...selection.recommendations[0], shared_genres: ['Invented'] }] }, history, candidates, 5)).toThrow();
    expect(() => validateSelection({ recommendations: [{ ...selection.recommendations[0], episodes: 12 }] }, history, candidates, 5)).toThrow();
  });
  it('rejects invented IDs, duplicate candidates and excess recommendations', () => {
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], candidate_id: 'invented:9' }] }, history, candidates, 5)).toThrow();
    expect(() => validateRanking({ recommendations: [ranking.recommendations[0], ranking.recommendations[0]] }, history, candidates, 5)).toThrow();
    expect(() => validateRanking(ranking, history, candidates, 0)).toThrow();
  });
  it('rejects invented history, source traits and extra metadata fields', () => {
    expect(() => validateProfile({ ...profile, likes: [{ pattern: 'Unknown', history_ids: ['not-sent'] }] }, history)).toThrow();
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], shared_genres: ['Comedy'] }] }, history, candidates, 5)).toThrow();
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], episodes: 12 }] }, history, candidates, 5)).toThrow();
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], history_ids: ['not-sent'] }] }, history, candidates, 5)).toThrow();
  });
  it('requires history citations when history exists and forbids fabricated preferences when empty', () => {
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], history_ids: [] }] }, history, candidates, 5)).toThrow();
    expect(() => validateProfile(profile, [])).toThrow();
    expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], shared_tags: ['Invented'] }] }, history, candidates, 5)).toThrow();
  });
  it('rejects generated numeric rating, length, percentage and availability claims', () => {
    for (const reason of ['You rated it 9/10.', 'This has 12 episodes.', 'A 95% match.', 'It is dubbed on Netflix.']) {
      expect(() => validateRanking({ recommendations: [{ ...ranking.recommendations[0], reason }] }, history, candidates, 5)).toThrow();
    }
  });
  it('parses only a bounded JSON document, optionally inside a single JSON fence', () => {
    expect(parseModelJson('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(() => parseModelJson('Here is a result: {"a":1}')).toThrow();
    expect(() => parseModelJson('x'.repeat(100000))).toThrow();
  });
});
