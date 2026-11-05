/**
 * A small built-in product taxonomy (not Shopify's full standard taxonomy): enough for a category picker and a stable `Product.category`.
 * Ids look like the real ones (`gid://shopify/TaxonomyCategory/<code>`), the code being the position in the tree.
 */
export interface TaxonomyCategory { id: string; name: string; fullName: string; level: number; parentId: string | null; isLeaf: boolean }

const TREE: Record<string, string[]> = {
  'Animals & Pet Supplies': ['Pet Food', 'Pet Toys', 'Pet Beds'],
  'Apparel & Accessories': ['Clothing', 'Shoes', 'Jewelry', 'Handbags & Wallets', 'Clothing Accessories'],
  'Arts & Entertainment': ['Books', 'Music', 'Hobbies & Creative Arts'],
  'Baby & Toddler': ['Baby Clothing', 'Baby Toys', 'Baby Care'],
  'Electronics': ['Computers', 'Phones & Tablets', 'Audio', 'Cameras', 'Video Games'],
  'Food, Beverages & Tobacco': ['Beverages', 'Food Items', 'Coffee & Tea'],
  'Furniture': ['Chairs', 'Tables', 'Storage & Shelving', 'Beds & Bed Frames'],
  'Health & Beauty': ['Personal Care', 'Cosmetics', 'Skin Care', 'Vitamins & Supplements'],
  'Home & Garden': ['Kitchen & Dining', 'Decor', 'Bedding', 'Lawn & Garden', 'Lighting'],
  'Sporting Goods': ['Outdoor Recreation', 'Fitness', 'Team Sports'],
  'Toys & Games': ['Games', 'Puzzles', 'Toys'],
};

export const TAXONOMY: TaxonomyCategory[] = Object.entries(TREE).flatMap(([root, kids], i) => {
  const rootId = `gid://shopify/TaxonomyCategory/${['aa', 'ap', 'ae', 'bt', 'el', 'fb', 'fu', 'hb', 'hg', 'sg', 'tg'][i] ?? `x${i}`}`;
  return [
    { id: rootId, name: root, fullName: root, level: 0, parentId: null, isLeaf: false },
    ...kids.map((k, j): TaxonomyCategory => ({ id: `${rootId}-${j + 1}`, name: k, fullName: `${root} > ${k}`, level: 1, parentId: rootId, isLeaf: true })),
  ];
});

export const getCategory = (id: string | null | undefined): TaxonomyCategory | null => (id ? TAXONOMY.find((c) => c.id === id) ?? null : null);

export function searchCategories(search?: string | null): TaxonomyCategory[] {
  const q = search?.trim().toLowerCase();
  return q ? TAXONOMY.filter((c) => c.fullName.toLowerCase().includes(q)) : TAXONOMY;
}
