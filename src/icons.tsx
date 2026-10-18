import type { CSSProperties } from 'react';

const paths = {
  play: 'm9 5 11 7-11 7V5Z',
  arrow: 'M5 12h14m-6-6 6 6-6 6',
  search: 'm21 21-5-5M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z',
  refresh: 'M20 7v5h-5M4 17v-5h5m-4-4a8 8 0 0 1 13-3l2 2M4 17l2 2a8 8 0 0 0 13-3',
  close: 'm6 6 12 12M6 18 18 6',
  library: 'M4 4v16M9 4v16m5-16 6 15',
  check: 'm5 12 4 4L19 6',
  globe: 'M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM3 12h18M12 3a17 17 0 0 1 0 18 17 17 0 0 1 0-18Z',
  external: 'M14 3h7v7m0-7L10 14m0-9H4v15h15v-6',
  plus: 'M12 5v14M5 12h14',
  chevron: 'm8 10 4 4 4-4',
  sliders: 'M4 7h9m4 0h3M4 17h3m4 0h9M13 4v6M7 14v6',
  shuffle: 'M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3-2 4-4m4-4c1-2 2-4 4-4h3m-4-4 4 4-4 4',
  lock: 'M7 10V7a5 5 0 0 1 10 0v3M5 10h14v11H5V10Zm7 4v3',
  star: 'm12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9L12 3Z',
} satisfies Record<string, string>;

export function Icon({ name, size = 20, style }: { name: keyof typeof paths; size?: number; style?: CSSProperties }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style}><path d={paths[name]} /></svg>;
}
