// Hitman contracts: a shady contact waits at the end of a hidden dead-end alley between Wrench
// Bros and the Parts Depot. "Görev Al (E)" gives one contract at a time:
//  - drive-by: shoot up a named venue with enough hits before the time runs out, from a vehicle
//    or standing in front of it;
//  - hit: a VIP or a rival gang member walks somewhere in a marked search area; find and shoot them.
// Each success pays $1,000. Values are in ECONOMY.hitman.


/** The alley (a 6 m gap between the two buildings) and the wall that closes its south end. */
export const HITMAN_ALLEY = {
  box: { minX: 110, maxX: 116, minZ: 62, maxZ: 84 },
  wall: { minX: 110, maxX: 116, minZ: 84, maxZ: 86 },
  /** Where the contact stands (in the shadows at the dead end). */
  contact: { x: 113, z: 80.5, rot: Math.PI },
};

export type ContractKind = 'driveby' | 'hit';

/** Venues a drive-by contract can name (their walls take the hits). */
export interface Venue {
  id: string;
  name: string;
  /** Building id in shared/world.ts BUILDINGS. */
  building: string;
}

export const VENUES: Venue[] = [
  { id: 'fuel', name: 'Fuel & Snacks', building: 'fuel_shop' },
  { id: 'auction', name: 'Hammerfall Auctions', building: 'auction_house' },
  { id: 'customs', name: 'Chroma Customs', building: 'custom_garage' },
  { id: 'market', name: 'Used Vehicle Market office', building: 'market_office' },
];

/** People a hit contract can name: who they are and how they look. */
export interface Mark {
  id: string;
  name: string;
  /** VIP or rival gang member. */
  kind: 'vip' | 'gang';
  look: { skin: string; shirt: string; pants: string; hair: string };
}

export const MARKS: Mark[] = [
  { id: 'vip_banker', name: 'Corrupt banker Vural', kind: 'vip', look: { skin: '#e0ac69', shirt: '#14213d', pants: '#14213d', hair: '#b5b5b5' } },
  { id: 'vip_broker', name: 'Crooked broker Selin', kind: 'vip', look: { skin: '#f1c27d', shirt: '#e9e9e4', pants: '#2b2d42', hair: '#4a2c2a' } },
  { id: 'gang_red', name: 'Kızıl Akrepler lieutenant', kind: 'gang', look: { skin: '#c68642', shirt: '#c1121f', pants: '#1b1b1b', hair: '#1b1b1b' } },
  { id: 'gang_green', name: 'Yeşil Kobralar enforcer', kind: 'gang', look: { skin: '#8d5524', shirt: '#2a9d8f', pants: '#264653', hair: '#1b1b1b' } },
];

/** What the client shows for the current contract. */
export interface ContractView {
  id: string;
  kind: ContractKind;
  title: string;
  text: string;
  /** Map marker: the venue, or the search area round the mark. */
  x: number;
  z: number;
  radius: number;
  /** Drive-by: hits so far and needed. */
  hits?: number;
  need?: number;
  reward: number;
  expiresAt: number;
  /** Hit: the mark's NPC id (labelled for the contract holder). */
  markId?: string;
}

