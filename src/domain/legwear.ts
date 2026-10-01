/**
 * Tights live with the bottoms in the wardrobe but are worn under them: a skirt
 * or a dress with tights is one look. They go to the try-on as their own layer
 * (the server's `legwear` slot), never as the look's bottom.
 */
export const LEGWEAR = new Set(['Колготки']);
export const isLegwear = (item: { category: string }) => LEGWEAR.has(item.category);
