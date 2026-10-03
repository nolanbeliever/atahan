// Emlak Dünyası, the estate agent on the Chroma corner (its back door is a heist target): legal
// businesses for sale with clean money, and the laundry. Pay your dirty money (Kara Para) into a
// business you own; every business turns up to $100,000 of it into clean cash every 10 minutes
// (the cycles keep running while you're away: they're paid when you come back).

import { ECONOMY } from './economy.config';

export type BusinessId = 'laundromat' | 'barber' | 'carwash' | 'restaurant' | 'driving' | 'nightclub';

export interface Business {
  id: BusinessId;
  name: string;
  emoji: string;
  /** Where it is (flavour). */
  district: string;
  price: number;
  text: string;
}

export const BUSINESSES: Business[] = [
  { id: 'laundromat', name: 'Beyaz Çamaşırhane', emoji: '🧺', district: 'Sanayi yolu', price: 150_000, text: 'Kimse çamaşırhanenin kasasını saymaz. Klasik.' },
  { id: 'barber', name: 'Makas Berber Salonu', emoji: '💈', district: 'Fortune Plaza', price: 175_000, text: 'Nakit çalışan, sorgusuz bir esnaf dükkânı.' },
  { id: 'carwash', name: 'Köpük Oto Yıkama', emoji: '🚿', district: 'Sparkle Wash yanı', price: 220_000, text: 'Günde yüz araç, hepsi nakit: kimse kaç araç yıkandığını bilmez.' },
  { id: 'restaurant', name: 'Lezzet Durağı Restoran', emoji: '🍽️', district: 'Müzayede Sokağı', price: 280_000, text: 'Akşamları dolu salon; hesap fişleri her şeyi açıklar.' },
  { id: 'driving', name: 'Direksiyon Sürücü Kursu', emoji: '🚦', district: 'Galeri Bulvarı', price: 340_000, text: 'Kurs paraları peşin ödenir; kayıtlar kâğıt üstünde.' },
  { id: 'nightclub', name: 'Neon Gece Kulübü', emoji: '🪩', district: 'Karşı kıyı', price: 480_000, text: 'Kapıda nakit, içeride kalabalık: en büyük kasa.' },
];

export const BUSINESS_IDS = BUSINESSES.map((b) => b.id);

export function findBusiness(id: string): Business | undefined {
  return BUSINESSES.find((b) => b.id === id);
}

/** A business a player owns: the dirty money waiting in it, and when the current cycle started. */
export interface OwnedBusiness {
  id: BusinessId;
  boughtAt: number;
  pending: number;
  cycleAt: number;
}

/** Run the laundry up to `now`: whole cycles since `cycleAt`, each turning up to perCycle of the
 *  pending dirty money clean. Returns the clean money and moves the business on. */
export function launder(b: OwnedBusiness, now: number): number {
  const L = ECONOMY.laundering;
  const cycleMs = L.cycleSec * 1000;
  const cycles = Math.floor((now - b.cycleAt) / cycleMs);
  if (cycles <= 0) return 0;
  b.cycleAt += cycles * cycleMs;
  const clean = Math.min(b.pending, cycles * L.perCycle);
  b.pending -= clean;
  return clean;
}

/** What the estate agent's window shows. */
export interface BusinessView {
  id: BusinessId;
  owned: boolean;
  pending: number;
  /** Next cycle (ms, server clock), owned businesses only. */
  nextAt: number | null;
}
