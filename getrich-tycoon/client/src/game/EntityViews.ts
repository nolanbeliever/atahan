// Scene objects for everything dynamic: players, NPCs, vehicles, price tags.

import * as THREE from 'three';
import { Anim, type Appearance, type MarketListing, type PublicVehicle, type Vehicle } from '../../../shared/types';
import { formatMoney } from '../../../shared/util';
import { modelDisplayName } from '../../../shared/vehicles';
import { groundHeight } from '../render/City';
import { CharacterView, NPC_PALETTE } from '../render/Character';
import { Label } from '../render/Labels';
import { VehicleView } from '../render/VehicleMesh';
import { INTERP_DELAY_MS, InterpBuffer } from './Interpolation';

export interface CharEntity {
  view: CharacterView;
  label: Label | null;
  buffer: InterpBuffer;
  anim: number;
  driving: string | null;
  lastSeen: number;
}

export interface VehEntity {
  view: VehicleView;
  label: Label | null;
  data: Vehicle;
  kind: 'public' | 'market';
  listing?: MarketListing;
  buffer: InterpBuffer;
  driven: boolean;
  lastDriven: number;
  x: number;
  z: number;
  rot: number;
}

export class EntityViews {
  readonly players = new Map<string, CharEntity>();
  readonly npcs = new Map<string, CharEntity>();
  readonly vehicles = new Map<string, VehEntity>();
  showNames = true;

  constructor(
    private readonly scene: THREE.Scene,
    private readonly myId: () => string,
  ) {}

  // ------------------------------------------------------------ characters

  ensurePlayer(id: string, name: string, level: number, appearance: Appearance): CharEntity {
    let e = this.players.get(id);
    if (!e) {
      const view = new CharacterView(appearance);
      this.scene.add(view.root);
      const isMe = id === this.myId();
      const label = isMe ? null : new Label(name, { badge: String(level), badgeColor: '#7a5cff' });
      if (label) this.scene.add(label.sprite);
      e = { view, label, buffer: new InterpBuffer(), anim: Anim.Idle, driving: null, lastSeen: performance.now() };
      this.players.set(id, e);
    } else {
      e.view.setAppearance(appearance);
      e.label?.set(name, { badge: String(level), badgeColor: '#7a5cff' });
    }
    return e;
  }

  removePlayer(id: string): void {
    const e = this.players.get(id);
    if (!e) return;
    this.scene.remove(e.view.root);
    if (e.label) {
      this.scene.remove(e.label.sprite);
      e.label.dispose();
    }
    e.view.dispose();
    this.players.delete(id);
  }

  upsertNpc(id: string, style: number, t: number, x: number, z: number, r: number, a: number): void {
    let e = this.npcs.get(id);
    if (!e) {
      const view = new CharacterView(NPC_PALETTE[style % NPC_PALETTE.length]!);
      this.scene.add(view.root);
      const label = new Label('Customer', { color: '#ffd166', height: 0.3 });
      this.scene.add(label.sprite);
      e = { view, label, buffer: new InterpBuffer(), anim: Anim.Idle, driving: null, lastSeen: t };
      this.npcs.set(id, e);
    }
    e.buffer.push({ t, x, z, r, a, b: 0 });
    e.lastSeen = t;
  }

  pruneNpcs(alive: Set<string>): void {
    for (const [id, e] of this.npcs) {
      if (alive.has(id)) continue;
      this.scene.remove(e.view.root);
      if (e.label) {
        this.scene.remove(e.label.sprite);
        e.label.dispose();
      }
      e.view.dispose();
      this.npcs.delete(id);
    }
  }

  // ------------------------------------------------------------ vehicles

  upsertVehicle(v: PublicVehicle | Vehicle, kind: 'public' | 'market', listing?: MarketListing, ownerName?: string | null): void {
    let e = this.vehicles.get(v.id);
    if (!e) {
      const view = new VehicleView(v);
      this.scene.add(view.root);
      e = { view, label: null, data: v, kind, listing, buffer: new InterpBuffer(), driven: false, lastDriven: 0, x: v.x, z: v.z, rot: v.rotation };
      this.vehicles.set(v.id, e);
    } else {
      e.view.update(v);
      e.data = v;
      e.kind = kind;
      e.listing = listing;
    }
    if (!e.driven) {
      e.x = v.x;
      e.z = v.z;
      e.rot = v.rotation;
    }
    this.updateVehicleLabel(e, ownerName ?? null);
  }

  private updateVehicleLabel(e: VehEntity, ownerName: string | null): void {
    const v = e.data;
    let text: string | null = null;
    let opts: ConstructorParameters<typeof Label>[1] = {};
    if (e.kind === 'market' && e.listing) {
      text = modelDisplayName(v.modelId);
      opts = { sub: formatMoney(e.listing.askingPrice), bg: 'rgba(40,24,6,0.8)', subColor: '#ffc53d' };
    } else if (v.status === 'displayed' && v.salePrice !== null) {
      const mine = v.ownerId === this.myId();
      text = mine ? 'YOUR LISTING' : 'FOR SALE';
      opts = { sub: formatMoney(v.salePrice), bg: mine ? 'rgba(60,44,0,0.82)' : 'rgba(6,40,24,0.82)', color: mine ? '#ffc53d' : '#2ee59d', subColor: '#ffffff' };
    } else if (v.status === 'world' && ownerName) {
      text = `${ownerName}'s ${modelDisplayName(v.modelId)}`;
      opts = { height: 0.3, bg: 'rgba(12,16,28,0.55)' };
    }
    if (!text) {
      if (e.label) {
        this.scene.remove(e.label.sprite);
        e.label.dispose();
        e.label = null;
      }
      return;
    }
    if (!e.label) {
      e.label = new Label(text, opts);
      this.scene.add(e.label.sprite);
    } else e.label.set(text, opts);
  }

  removeVehicle(id: string): void {
    const e = this.vehicles.get(id);
    if (!e) return;
    this.scene.remove(e.view.root);
    if (e.label) {
      this.scene.remove(e.label.sprite);
      e.label.dispose();
    }
    e.view.dispose();
    this.vehicles.delete(id);
  }

  /** Sync market lot vehicles with the listing set. */
  syncMarket(listings: MarketListing[]): void {
    const ids = new Set(listings.map((l) => l.vehicle.id));
    for (const [id, e] of this.vehicles) if (e.kind === 'market' && !ids.has(id)) this.removeVehicle(id);
    for (const l of listings) this.upsertVehicle(l.vehicle, 'market', l);
  }

  // ------------------------------------------------------------ per-frame

  update(dt: number, now: number, local: { id: string; x: number; z: number; rot: number; anim: number; driving: string | null; speed: number; steer: number }): void {
    const renderT = now - INTERP_DELAY_MS;
    // Vehicles
    for (const [id, e] of this.vehicles) {
      let speed = 0;
      let steer = 0;
      if (local.driving === id) {
        e.x = local.x;
        e.z = local.z;
        e.rot = local.rot;
        speed = local.speed;
        steer = local.steer;
        e.driven = true;
      } else if (e.driven && now - e.lastDriven < 400) {
        const s = e.buffer.sample(renderT);
        if (s) {
          e.x = s.x;
          e.z = s.z;
          e.rot = s.r;
          speed = s.a;
          steer = s.b;
        }
      } else if (e.driven && local.driving !== id) {
        e.driven = false;
        e.x = e.data.x;
        e.z = e.data.z;
        e.rot = e.data.rotation;
      }
      const y = groundHeight(e.x, e.z);
      e.view.root.position.set(e.x, y, e.z);
      e.view.root.rotation.y = e.rot;
      e.view.animate(speed, steer, dt);
      if (e.label) {
        e.label.sprite.visible = this.showNames || e.kind === 'market' || e.data.status === 'displayed';
        e.label.sprite.position.set(e.x, y + e.view.height + 0.75, e.z);
      }
    }
    // Players
    for (const [id, e] of this.players) {
      let x: number, z: number, r: number, anim: number;
      let driving: string | null;
      if (id === local.id) {
        x = local.x;
        z = local.z;
        r = local.rot;
        anim = local.anim;
        driving = local.driving;
      } else {
        const s = e.buffer.sample(renderT);
        if (!s) {
          e.view.root.visible = false;
          if (e.label) e.label.sprite.visible = false;
          continue;
        }
        x = s.x;
        z = s.z;
        r = s.r;
        anim = s.a;
        driving = e.driving;
      }
      const y = groundHeight(x, z);
      e.view.root.visible = !driving;
      e.view.root.position.set(x, y, z);
      e.view.root.rotation.y = r;
      e.view.animate(anim, dt);
      if (e.label) {
        e.label.sprite.visible = this.showNames;
        const veh = driving ? this.vehicles.get(driving) : undefined;
        e.label.sprite.position.set(x, y + (driving ? (veh?.view.height ?? 1.5) + 1.3 : 2.35), z);
      }
    }
    // NPCs
    for (const e of this.npcs.values()) {
      const s = e.buffer.sample(renderT);
      if (!s) continue;
      const y = groundHeight(s.x, s.z);
      e.view.root.position.set(s.x, y, s.z);
      e.view.root.rotation.y = s.r;
      e.view.animate(s.a, dt);
      if (e.label) e.label.sprite.position.set(s.x, y + 2.2, s.z);
    }
  }

  clear(): void {
    for (const id of [...this.players.keys()]) this.removePlayer(id);
    for (const id of [...this.vehicles.keys()]) this.removeVehicle(id);
    this.pruneNpcs(new Set());
  }
}
