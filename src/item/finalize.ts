import { computeTags, generateDescription, generateName } from './describe';
import { computeStats } from './stats';
import type { Item } from './types';

/** Recompute all derived data (stats, tags, description). Pure function of the item's stored parameters. */
export function refreshDerived(item: Item, rename = false): Item {
  item.stats = computeStats(item);
  item.tags = computeTags(item);
  if (rename || !item.name || item.name === 'Unnamed Work') item.name = generateName(item);
  item.description = generateDescription(item);
  return item;
}
