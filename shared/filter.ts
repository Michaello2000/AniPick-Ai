import type { Anime, ListStatus } from './model.js';

export type LengthFilter = 'all' | '12' | '24' | '25' | 'movie';
export type SortOrder = 'title' | 'score' | 'shortest' | 'year';
export interface BrowseFilters {
  search?: string;
  length?: LengthFilter;
  genre?: string;
  status?: ListStatus | 'all';
  sort?: SortOrder;
}

export function filterAnime(entries: Anime[], filters: BrowseFilters): Anime[] {
  const search = filters.search?.trim().toLocaleLowerCase() ?? '';
  const status = filters.status ?? 'planning';
  return entries.filter((anime) => {
    if (status !== 'all' && anime.status !== status) return false;
    if (search && ![anime.title, anime.titles.english, anime.titles.romaji, anime.titles.native, ...anime.titles.synonyms]
      .some(title => title?.toLocaleLowerCase().includes(search))) return false;
    if (filters.genre && !anime.genres.includes(filters.genre)) return false;
    switch (filters.length) {
      case '12': if (anime.episodes === null || anime.episodes > 12) return false; break;
      case '24': if (anime.episodes === null || anime.episodes > 24) return false; break;
      case '25': if (anime.episodes === null || anime.episodes < 25) return false; break;
      case 'movie': if (anime.format !== 'MOVIE') return false; break;
    }
    return true;
  }).sort((a, b) => {
    let order = 0;
    switch (filters.sort) {
      case 'score': order = (b.communityScore ? b.communityScore.value / b.communityScore.scale : -1) - (a.communityScore ? a.communityScore.value / a.communityScore.scale : -1); break;
      case 'shortest': order = (a.episodes ?? Infinity) - (b.episodes ?? Infinity); break;
      case 'year': order = (b.year ?? -1) - (a.year ?? -1); break;
    }
    return (Number.isNaN(order) ? 0 : order) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id);
  });
}
