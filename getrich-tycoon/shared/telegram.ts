// Telegram dealing (the phone, Y): order a package from the supplier ($100 for 10 g, clean money);
// the supplier sends a location and a picture of the car with its colour and window sticker. Get
// into that car: the camera goes to the passenger seat, the money and a black bag (siyah poşet)
// change hands, "DEAL COMPLETED". Then your own channel: customers post orders; deliver by hand
// (get into their car: same cockpit handover, they pay dirty money) or leave the package at a
// hidden dead drop (safer, pays a little less, the customer collects later). One customer in
// seven is an undercover cop: the badge comes out in the car, sirens, three stars at once.

import { ECONOMY } from './economy.config';
import { BOULEVARD } from './farShore';

export const DEALS = ECONOMY.deals;

/** A parked car for a deal: where, and what it looks like. */
export interface DealSpot {
  x: number;
  z: number;
  rot: number;
}

/** Kerbside spots for the deal cars: the city's other kerbs (the lockpick cars use the first ones)
 *  and the far shore's boulevard. */
export const DEAL_SPOTS: DealSpot[] = (() => {
  const spots: DealSpot[] = [];
  const lines = [-150, -50, 50, 150];
  const mids = [-125, -75, -25, 25, 75, 125];
  const kerb = 4.6;
  lines.forEach((l, i) => {
    mids.forEach((m, j) => {
      if ((i + j) % 2 === 0) spots.push({ x: m, z: l + kerb, rot: -Math.PI / 2 });
      else spots.push({ x: l - kerb, z: m, rot: Math.PI });
    });
  });
  for (const x of [738, 822, 893, 962, 1026]) spots.push({ x, z: BOULEVARD.minZ + 2.2, rot: Math.PI / 2 });
  for (const x of [772, 852, 1004]) spots.push({ x, z: BOULEVARD.maxZ - 2.2, rot: -Math.PI / 2 });
  return spots;
})();

/** Hidden places to leave a package. */
export interface DeadDrop {
  id: string;
  name: string;
  x: number;
  z: number;
}

export const DEAD_DROPS: DeadDrop[] = [
  { id: 'dumpster_wrench', name: 'Tamirhane Arka Sokağı · çöp konteynerinin arkası', x: 69.4, z: 119.6 },
  { id: 'dumpster_auction', name: 'Müzayede Arka Sokağı · konteynerin yanı', x: 76.8, z: 29.3 },
  { id: 'chroma_pipe', name: 'Chroma Pasajı · yağmur borusunun dibi', x: -71.6, z: 90 },
  { id: 'plaza_planter', name: 'Fortune Plaza · çiçekliğin içi', x: 21.5, z: -12 },
  { id: 'grandstand', name: 'Drag pisti tribünü · alt basamak', x: -170.6, z: 30 },
  { id: 'sanayi_tyres', name: 'Sanayi · lastik yığınının arkası', x: 129.2, z: 207 },
  { id: 'docks_crate', name: 'Liman · kırık kasanın altı', x: 905, z: 156 },
  { id: 'casino_palm', name: 'Golden Palace · palmiyenin dibi', x: 1009, z: 22 },
];

export function findDrop(id: string): DeadDrop | undefined {
  return DEAD_DROPS.find((d) => d.id === id);
}

/** The cars the supplier and the customers sit in, their colours and window stickers. */
export const DEAL_MODELS = ['norda_workmate', 'norda_arlo', 'velora_serene', 'granforge_ridgeback', 'norda_pixi', 'harlan_bellwether', 'voltara_luma'];
export const DEAL_COLORS: { hex: string; name: string }[] = [
  { hex: '#111214', name: 'Siyah' },
  { hex: '#3a3d42', name: 'Füme' },
  { hex: '#e9e9e4', name: 'Beyaz' },
  { hex: '#6b1420', name: 'Bordo' },
  { hex: '#1b2a4a', name: 'Lacivert' },
  { hex: '#a7abb0', name: 'Gri' },
];
export const STICKERS = ['🐺', '🦂', '🔥', '☠️', '🐍', '⚡', '🌙', '🎲', '👁️', '🃏'];

/** A deal car in the world (everyone sees it parked; only its player can get in). */
export interface DealCar {
  id: string;
  /** Who it waits for. */
  forId: string;
  kind: 'supplier' | 'customer';
  modelId: string;
  color: string;
  colorName: string;
  sticker: string;
  x: number;
  z: number;
  rot: number;
}

/** A Telegram message. */
export interface TgMessage {
  id: number;
  /** supplier: the supplier's chat; channel: your channel (customers' orders and your posts). */
  chat: 'supplier' | 'channel';
  from: 'them' | 'me' | 'system';
  /** The customer's handle in the channel. */
  name?: string;
  text: string;
  /** A picture of the car (location and looks). */
  car?: { modelId: string; color: string; colorName: string; sticker: string; x: number; z: number };
  /** A pin on the map. */
  pin?: { x: number; z: number; label: string };
  /** The order it is about (channel). */
  orderId?: string;
  at: number;
}

/** A customer's order in your channel. */
export interface DealOrder {
  id: string;
  name: string;
  grams: number;
  /** Paid for a hand delivery; a dead drop pays `dropShare` of it. */
  price: number;
  status: 'open' | 'hand' | 'drop' | 'dropped';
  /** Hand delivery: their car; dead drop: the spot. */
  carId?: string;
  dropId?: string;
  until: number;
}

/** Your phone as the server sees it. */
export interface TgState {
  goods: number;
  messages: TgMessage[];
  orders: DealOrder[];
  /** The package waiting in the supplier's car (null: none). */
  pickup: { carId: string; until: number } | null;
  unread: number;
}

/** The cockpit handover: buying from the supplier, selling to a customer; a cop at the wheel. */
export interface DealScene {
  carId: string;
  kind: 'buy' | 'sell';
  cop: boolean;
  modelId: string;
  color: string;
  x: number;
  z: number;
  rot: number;
  grams: number;
  money: number;
  ms: number;
}

/** A dead drop pays this much of the hand-delivery price. */
export function dropPrice(price: number): number {
  return Math.round((price * DEALS.dropShare) / 10) * 10;
}
