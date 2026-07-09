/** Coin packs sold for real money in the coin store (checkout via api/shop/*). */
export interface StorePackDef {
  id: string;
  name: string;
  coins: number;
  bonusCoins: number;
  priceCents: number; // BRL
  badge?: 'popular' | 'best';
}

export const STORE_PACKS: readonly StorePackDef[] = [
  { id: 'pack_s', name: 'Punhado de Moedas', coins: 500, bonusCoins: 0, priceCents: 490 },
  { id: 'pack_m', name: 'Cofre de Moedas', coins: 1200, bonusCoins: 300, priceCents: 990, badge: 'popular' },
  { id: 'pack_l', name: 'Baú Blindado', coins: 3000, bonusCoins: 1200, priceCents: 1990, badge: 'best' },
  { id: 'pack_xl', name: 'Arsenal Completo', coins: 7000, bonusCoins: 5000, priceCents: 4990 },
];

export function packById(id: string): StorePackDef | undefined {
  return STORE_PACKS.find((p) => p.id === id);
}

export function totalCoins(pack: StorePackDef): number {
  return pack.coins + pack.bonusCoins;
}

export function formatBRL(cents: number): string {
  return (cents / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
