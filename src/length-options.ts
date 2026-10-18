import type { LengthFilter } from '../shared/filter.js';

export const lengths: { value: LengthFilter; label: string; boundary: string }[] = [
  { value: 'all', label: 'No limit', boundary: 'All episode counts, including unknown' },
  { value: '12', label: 'Up to 12 episodes', boundary: '12 episodes or fewer (≤12)' },
  { value: '24', label: 'Up to 24 episodes', boundary: '24 episodes or fewer (≤24)' },
  { value: 'movie', label: 'Movie', boundary: 'Movie format only' },
  { value: '25', label: '25+ episodes', boundary: '25 episodes or more (≥25)' },
];
