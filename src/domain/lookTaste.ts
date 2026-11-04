import { WardrobeItem } from '../data/mock';
import { isLegwear } from './legwear';

/**
 * Thumbs on a look: what the person likes in looks in general. Not the heart (that keeps a look in the favourites) and
 * not «не сегодня» (that puts a look aside for two weeks). A vote saves nothing and only nudges the choice.
 * The nudges are capped below what the weather and the occasion weigh in buildLooks and evaluateLook.
 */
export type LookVoteKind = 'like' | 'dislike';
export type VotePiece = { id: string; category: string; color: string };
export type LookVote = { exact: string; vote: LookVoteKind; at: number; pieces: VotePiece[]; core: string };
export type LookTaste = { categories: Map<string, number>; colors: Map<string, number>; pairs: Map<string, number>; disliked: Set<string> };

const WORN = new Set(['Верх', 'Низ', 'Обувь', 'Верхняя одежда']);
const MAX_VOTES = 200;
const HALF_LIFE_MS = 60 * 86_400_000;
/** At most this per piece: less than one step of warmth off the weather costs a piece in itemScore (from 1.5 to 4). */
export const TASTE_ITEM_CAP = 0.6;
export const TASTE_PAIR_CAP = 1.5;
/** At most this many points of the match percent when ordering looks that already fit. */
export const TASTE_ORDER_CAP = 3;

const clamp = (value: number, cap: number) => Math.max(-cap, Math.min(cap, value));
const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const known = (color: string) => Boolean(color) && color !== 'Не определено';
const worn = (items: WardrobeItem[]) => items.filter(item => WORN.has(item.section) && !isLegwear(item));

/** The look as worn: the same clothes are the same look whatever bag or tights join them. */
export const lookExact = (items: WardrobeItem[]) => worn(items).map(item => item.id).sort().join(',');

const coreOf = (items: WardrobeItem[]) => items.filter(item => ['Верх', 'Низ'].includes(item.section) && !isLegwear(item)).map(item => item.id).sort().join(',');

export const voteOf = (votes: LookVote[], items: WardrobeItem[]): LookVoteKind | null => {
  const exact = lookExact(items);
  return votes.find(entry => entry.exact === exact)?.vote ?? null;
};

/** The newest word about a look replaces the older one; null takes it back. */
export function applyVote(votes: LookVote[], items: WardrobeItem[], vote: LookVoteKind | null, now: number): LookVote[] {
  const exact = lookExact(items);
  if (!exact) return votes;
  const rest = votes.filter(entry => entry.exact !== exact);
  if (!vote) return rest;
  const pieces = worn(items).map(item => ({ id: item.id, category: item.category, color: item.color }));
  return [{ exact, vote, at: now, pieces, core: coreOf(items) }, ...rest].slice(0, MAX_VOTES);
}

export function decodeLookVotes(value: unknown): LookVote[] {
  if (!Array.isArray(value)) return [];
  return value.filter(entry => entry && typeof entry.exact === 'string' && entry.exact && (entry.vote === 'like' || entry.vote === 'dislike')
    && Number.isFinite(entry.at) && Array.isArray(entry.pieces)
    && entry.pieces.every((piece: any) => piece && typeof piece.id === 'string' && typeof piece.category === 'string' && typeof piece.color === 'string'))
    .map(entry => ({ exact: entry.exact, vote: entry.vote, at: entry.at, pieces: entry.pieces, core: typeof entry.core === 'string' ? entry.core : '' }))
    .slice(0, MAX_VOTES);
}

/** What the votes add up to; an older vote counts less, half after two months. A disliked look stays out until the vote is taken back. */
export function buildTaste(votes: LookVote[], now: number): LookTaste {
  const taste: LookTaste = { categories: new Map(), colors: new Map(), pairs: new Map(), disliked: new Set() };
  const add = (map: Map<string, number>, key: string, by: number) => map.set(key, (map.get(key) || 0) + by);
  for (const entry of votes) {
    if (entry.vote === 'dislike') taste.disliked.add(entry.exact);
    const weight = (entry.vote === 'like' ? 1 : -1) * Math.pow(0.5, Math.max(0, now - entry.at) / HALF_LIFE_MS);
    entry.pieces.forEach((piece, index) => {
      add(taste.categories, piece.category, weight);
      if (known(piece.color)) add(taste.colors, piece.color, weight);
      for (const other of entry.pieces.slice(index + 1)) add(taste.pairs, pairKey(piece.id, other.id), weight);
    });
  }
  return taste;
}

export const tasteOfItem = (taste: LookTaste | undefined, item: Pick<WardrobeItem, 'category' | 'color'>) =>
  taste ? clamp((taste.categories.get(item.category) || 0) * 0.08 + (taste.colors.get(item.color) || 0) * 0.08, TASTE_ITEM_CAP) : 0;

export function tasteOfPairs(taste: LookTaste | undefined, items: Pick<WardrobeItem, 'id'>[]) {
  if (!taste) return 0;
  let total = 0;
  items.forEach((item, index) => { for (const other of items.slice(index + 1)) total += taste.pairs.get(pairKey(item.id, other.id)) || 0; });
  return clamp(total * 0.5, TASTE_PAIR_CAP);
}

/** Points of the match percent for ordering. The caller gives no lift to a look off the weather or the occasion. */
export const tasteForOrder = (taste: LookTaste | undefined, items: WardrobeItem[]) => taste
  ? clamp(items.reduce((sum, item) => sum + tasteOfItem(taste, item), 0) + tasteOfPairs(taste, items), TASTE_ORDER_CAP) : 0;

/** Sent as the stylist's `avoid`: the server has no field for what is liked, and reads only pairs to stay away from. */
export const stylistAvoid = (votes: LookVote[], dismissed: string[], limit = 20) =>
  [...new Set([...votes.filter(entry => entry.vote === 'dislike').map(entry => entry.core), ...dismissed])].filter(Boolean).slice(0, limit);
