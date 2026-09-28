// Persistence mapping between records and SQL rows.

import type { AuctionStatus, SellerPersonalityId, Transaction, Vehicle, VehicleStatus } from '../../shared/types';
import type { AuctionRecord, DealershipRecord, ListingRecord, NoticeRecord, PlayerRecord } from '../game/records';
import type { Database, Queryable, Row } from './types';

const num = (v: unknown): number => (typeof v === 'number' ? v : Number(v ?? 0));
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const str = (v: unknown): string => String(v ?? '');
const strOrNull = (v: unknown): string | null => (v === null || v === undefined ? null : String(v));
function json<T>(v: unknown, fallback: T): T {
  try {
    return typeof v === 'string' ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------- players

export function rowToPlayer(r: Row): PlayerRecord {
  return {
    id: str(r.id),
    name: str(r.name),
    nameLower: str(r.name_lower),
    passwordHash: str(r.password_hash),
    money: num(r.money),
    bank: num(r.bank),
    xp: num(r.xp),
    level: num(r.level),
    reputation: num(r.reputation),
    stats: json(r.stats, {} as PlayerRecord['stats']),
    achievements: json(r.achievements, [] as string[]),
    settings: json(r.settings, {} as PlayerRecord['settings']),
    inventory: json(r.inventory, {} as Record<string, number>),
    appearance: json(r.appearance, {} as PlayerRecord['appearance']),
    dealershipPlotId: null,
    posX: num(r.pos_x),
    posZ: num(r.pos_z),
    rot: num(r.rot),
    lastInterestAt: num(r.last_interest_at),
    createdAt: num(r.created_at),
    lastSeenAt: num(r.last_seen_at),
  };
}

export async function insertPlayer(q: Queryable, p: PlayerRecord): Promise<void> {
  await q.query(
    `INSERT INTO players (id, name, name_lower, password_hash, money, bank, xp, level, reputation, stats, achievements, settings, inventory, appearance, pos_x, pos_z, rot, last_interest_at, created_at, last_seen_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
    [
      p.id,
      p.name,
      p.nameLower,
      p.passwordHash,
      p.money,
      p.bank,
      p.xp,
      p.level,
      p.reputation,
      JSON.stringify(p.stats),
      JSON.stringify(p.achievements),
      JSON.stringify(p.settings),
      JSON.stringify(p.inventory),
      JSON.stringify(p.appearance),
      p.posX,
      p.posZ,
      p.rot,
      p.lastInterestAt,
      p.createdAt,
      p.lastSeenAt,
    ],
  );
}

/** Save economic/progression state. Position is saved separately (savePlayerPosition). */
export async function updatePlayer(q: Queryable, p: PlayerRecord): Promise<void> {
  await q.query(
    `UPDATE players SET money=$2, bank=$3, xp=$4, level=$5, reputation=$6, stats=$7, achievements=$8, settings=$9,
       inventory=$10, appearance=$11, last_interest_at=$12, last_seen_at=$13 WHERE id=$1`,
    [
      p.id,
      p.money,
      p.bank,
      p.xp,
      p.level,
      p.reputation,
      JSON.stringify(p.stats),
      JSON.stringify(p.achievements),
      JSON.stringify(p.settings),
      JSON.stringify(p.inventory),
      JSON.stringify(p.appearance),
      p.lastInterestAt,
      p.lastSeenAt,
    ],
  );
}

export async function savePlayerPosition(q: Queryable, id: string, x: number, z: number, rot: number, lastSeenAt: number): Promise<void> {
  await q.query('UPDATE players SET pos_x=$2, pos_z=$3, rot=$4, last_seen_at=$5 WHERE id=$1', [id, x, z, rot, lastSeenAt]);
}

// ---------------------------------------------------------------- vehicles

export function rowToVehicle(r: Row): Vehicle {
  return {
    id: str(r.id),
    modelId: str(r.model_id),
    ownerId: strOrNull(r.owner_id),
    color: str(r.color),
    mileage: num(r.mileage),
    fuel: num(r.fuel),
    condition: json(r.condition, {} as Vehicle['condition']),
    mods: json(r.mods, {} as Vehicle['mods']),
    status: str(r.status) as VehicleStatus,
    purchasePrice: num(r.purchase_price),
    salePrice: numOrNull(r.sale_price),
    plotId: strOrNull(r.plot_id),
    slot: numOrNull(r.slot),
    rotation: num(r.rotation),
    x: num(r.x),
    z: num(r.z),
    serviceUntil: num(r.service_until),
    createdAt: num(r.created_at),
  };
}

export async function upsertVehicle(q: Queryable, v: Vehicle, now: number): Promise<void> {
  await q.query(
    `INSERT INTO vehicles (id, model_id, owner_id, color, mileage, fuel, condition, mods, status, purchase_price, sale_price, plot_id, slot, rotation, x, z, service_until, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     ON CONFLICT (id) DO UPDATE SET owner_id=excluded.owner_id, color=excluded.color, mileage=excluded.mileage, fuel=excluded.fuel,
       condition=excluded.condition, mods=excluded.mods, status=excluded.status, purchase_price=excluded.purchase_price,
       sale_price=excluded.sale_price, plot_id=excluded.plot_id, slot=excluded.slot, rotation=excluded.rotation, x=excluded.x, z=excluded.z,
       service_until=excluded.service_until, updated_at=excluded.updated_at`,
    [
      v.id,
      v.modelId,
      v.ownerId,
      v.color,
      v.mileage,
      v.fuel,
      JSON.stringify(v.condition),
      JSON.stringify(v.mods),
      v.status,
      v.purchasePrice,
      v.salePrice,
      v.plotId,
      v.slot,
      v.rotation,
      v.x,
      v.z,
      v.serviceUntil,
      v.createdAt,
      now,
    ],
  );
}

export async function deleteVehicle(q: Queryable, id: string): Promise<void> {
  await q.query('DELETE FROM vehicles WHERE id=$1', [id]);
}

// ---------------------------------------------------------------- dealerships

export function rowToDealership(r: Row): Omit<DealershipRecord, 'ownerName'> {
  return { plotId: str(r.plot_id), ownerId: str(r.owner_id), name: str(r.name), level: num(r.level), createdAt: num(r.created_at) };
}

export async function upsertDealership(q: Queryable, d: DealershipRecord): Promise<void> {
  await q.query(
    `INSERT INTO dealerships (plot_id, owner_id, name, level, created_at) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (plot_id) DO UPDATE SET owner_id=excluded.owner_id, name=excluded.name, level=excluded.level`,
    [d.plotId, d.ownerId, d.name, d.level, d.createdAt],
  );
}

// ---------------------------------------------------------------- market listings

export function rowToListing(r: Row): ListingRecord {
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    askingPrice: num(r.asking_price),
    minPrice: num(r.min_price),
    sellerName: str(r.seller_name),
    personality: str(r.personality) as SellerPersonalityId,
    lotSlot: num(r.lot_slot),
    expiresAt: num(r.expires_at),
    createdAt: num(r.created_at),
  };
}

export async function insertListing(q: Queryable, l: ListingRecord): Promise<void> {
  await q.query(
    `INSERT INTO market_listings (id, vehicle_id, asking_price, min_price, seller_name, personality, lot_slot, expires_at, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [l.id, l.vehicleId, l.askingPrice, l.minPrice, l.sellerName, l.personality, l.lotSlot, l.expiresAt, l.createdAt],
  );
}

export async function deleteListing(q: Queryable, id: string): Promise<void> {
  await q.query('DELETE FROM market_listings WHERE id=$1', [id]);
}

// ---------------------------------------------------------------- auctions

export function rowToAuction(r: Row): AuctionRecord {
  return {
    id: str(r.id),
    vehicleId: str(r.vehicle_id),
    sellerId: strOrNull(r.seller_id),
    sellerName: str(r.seller_name),
    startingBid: num(r.starting_bid),
    currentBid: numOrNull(r.current_bid),
    currentBidderId: strOrNull(r.current_bidder_id),
    currentBidderName: strOrNull(r.current_bidder_name),
    bidCount: num(r.bid_count),
    npcCap: num(r.npc_cap),
    endsAt: num(r.ends_at),
    status: str(r.status) as AuctionStatus,
    createdAt: num(r.created_at),
  };
}

export async function upsertAuction(q: Queryable, a: AuctionRecord): Promise<void> {
  await q.query(
    `INSERT INTO auctions (id, vehicle_id, seller_id, seller_name, starting_bid, current_bid, current_bidder_id, current_bidder_name, bid_count, npc_cap, ends_at, status, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (id) DO UPDATE SET current_bid=excluded.current_bid, current_bidder_id=excluded.current_bidder_id,
       current_bidder_name=excluded.current_bidder_name, bid_count=excluded.bid_count, ends_at=excluded.ends_at, status=excluded.status`,
    [a.id, a.vehicleId, a.sellerId, a.sellerName, a.startingBid, a.currentBid, a.currentBidderId, a.currentBidderName, a.bidCount, a.npcCap, a.endsAt, a.status, a.createdAt],
  );
}

// ---------------------------------------------------------------- transactions & notices

export async function insertTransaction(q: Queryable, t: Transaction): Promise<void> {
  await q.query(
    `INSERT INTO transactions (id, player_id, kind, amount, vehicle_id, counterparty_id, note, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [t.id, t.playerId, t.kind, t.amount, t.vehicleId, t.counterpartyId, t.note, t.createdAt],
  );
}

export async function recentTransactions(db: Database, playerId: string, limit = 50): Promise<Transaction[]> {
  const rows = await db.query(
    'SELECT * FROM transactions WHERE player_id=$1 ORDER BY created_at DESC, id DESC LIMIT $2',
    [playerId, limit],
  );
  return rows.map((r) => ({
    id: str(r.id),
    playerId: str(r.player_id),
    kind: str(r.kind) as Transaction['kind'],
    amount: num(r.amount),
    vehicleId: strOrNull(r.vehicle_id),
    counterpartyId: strOrNull(r.counterparty_id),
    note: str(r.note),
    createdAt: num(r.created_at),
  }));
}

export async function insertNotice(q: Queryable, n: NoticeRecord): Promise<void> {
  await q.query('INSERT INTO notices (id, player_id, kind, title, text, created_at) VALUES ($1,$2,$3,$4,$5,$6)', [
    n.id,
    n.playerId,
    n.kind,
    n.title,
    n.text,
    n.createdAt,
  ]);
}

export async function takeNotices(db: Database, playerId: string): Promise<NoticeRecord[]> {
  return db.tx(async (q) => {
    const rows = await q.query('SELECT * FROM notices WHERE player_id=$1 ORDER BY created_at ASC', [playerId]);
    await q.query('DELETE FROM notices WHERE player_id=$1', [playerId]);
    return rows.map((r) => ({
      id: str(r.id),
      playerId: str(r.player_id),
      kind: str(r.kind),
      title: str(r.title),
      text: str(r.text),
      createdAt: num(r.created_at),
    }));
  });
}

// ---------------------------------------------------------------- sessions

export async function insertSession(db: Database, tokenHash: string, playerId: string, now: number, expiresAt: number): Promise<void> {
  await db.query('INSERT INTO sessions (token_hash, player_id, created_at, expires_at) VALUES ($1,$2,$3,$4)', [tokenHash, playerId, now, expiresAt]);
}

export async function findSession(db: Database, tokenHash: string, now: number): Promise<string | null> {
  const rows = await db.query('SELECT player_id FROM sessions WHERE token_hash=$1 AND expires_at > $2', [tokenHash, now]);
  return rows[0] ? str(rows[0].player_id) : null;
}

export async function deleteSession(db: Database, tokenHash: string): Promise<void> {
  await db.query('DELETE FROM sessions WHERE token_hash=$1', [tokenHash]);
}

export async function purgeExpiredSessions(db: Database, now: number): Promise<void> {
  await db.query('DELETE FROM sessions WHERE expires_at <= $1', [now]);
}

// ---------------------------------------------------------------- world state

export async function getWorldValue(db: Database, key: string): Promise<string | null> {
  const rows = await db.query('SELECT value FROM world_state WHERE key=$1', [key]);
  return rows[0] ? str(rows[0].value) : null;
}

export async function setWorldValue(q: Queryable, key: string, value: string): Promise<void> {
  await q.query('INSERT INTO world_state (key, value) VALUES ($1,$2) ON CONFLICT (key) DO UPDATE SET value=excluded.value', [key, value]);
}

// ---------------------------------------------------------------- bulk load

export async function loadAll(db: Database) {
  const [players, vehicles, dealerships, listings, auctions] = await Promise.all([
    db.query('SELECT * FROM players'),
    db.query('SELECT * FROM vehicles'),
    db.query('SELECT * FROM dealerships'),
    db.query('SELECT * FROM market_listings'),
    db.query("SELECT * FROM auctions WHERE status='active'"),
  ]);
  return {
    players: players.map(rowToPlayer),
    vehicles: vehicles.map(rowToVehicle),
    dealerships: dealerships.map(rowToDealership),
    listings: listings.map(rowToListing),
    auctions: auctions.map(rowToAuction),
  };
}
