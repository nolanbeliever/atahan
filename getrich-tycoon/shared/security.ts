// Security gear for your cars at Chroma Customs: the hidden compartment (Gizli Zula: Z hides the
// goods you carry in it; a police search finds it one time in ten, the goods on you or in the boot
// always), run-flat tyres (spike strips and bullets don't burst them) and level-3 armour (the
// glass cracks but holds, nothing gets through for at least 30 bullets; the Armor HP % shows while
// you drive it), and the police scanner / radar jammer (listens in on the police radio: the live
// countdown to the police arriving at a reported scene). Values in ECONOMY.security.

import { ECONOMY } from './economy.config';
import type { VehicleMods } from './types';

export const SECURITY = ECONOMY.security;

export type SecurityItem = 'stash' | 'runflat' | 'armor' | 'scanner';
export const SECURITY_ITEMS: SecurityItem[] = ['stash', 'runflat', 'armor', 'scanner'];

export interface SecurityDef {
  id: SecurityItem;
  name: string;
  icon: string;
  price: number;
  text: string;
  /** Not for motorcycles and ATVs. */
  carsOnly: boolean;
}

export const SECURITY_DEFS: Record<SecurityItem, SecurityDef> = {
  stash: {
    id: 'stash',
    name: 'Gizli Zula',
    icon: '🗄️',
    price: SECURITY.stashPrice,
    text: `Bagaj tabanının altında gizli bölme (${SECURITY.stashCapacity} gr). Araçtayken Z: malı zulaya sakla / geri al. Polis aramasında üzerindeki ve bagajdaki mal her zaman, zuladaki ise sadece %${Math.round(SECURITY.stashFindChance * 100)} ihtimalle bulunur.`,
    carsOnly: false,
  },
  runflat: {
    id: 'runflat',
    name: 'Patlamaz Lastik (Run-Flat)',
    icon: '🛞',
    price: SECURITY.runflatPrice,
    text: 'Takviyeli yanaklı lastikler: çivili barikat ve polis kurşunları patlatamaz.',
    carsOnly: false,
  },
  armor: {
    id: 'armor',
    name: 'Seviye 3 Zırh',
    icon: '🛡️',
    price: SECURITY.armorPrice,
    text: `Çelik kaporta panelleri ve kurşun geçirmez cam: en az ${SECURITY.armorHits} mermiye dayanır, cam çatlar ama delinmez, içeridekilere kurşun işlemez. +${SECURITY.armorKg} kg (biraz daha yavaş hızlanır).`,
    carsOnly: true,
  },
  scanner: {
    id: 'scanner',
    name: 'Polis Telsiz Dinleyici · Radar Karartıcı',
    icon: '📻',
    price: SECURITY.scannerPrice,
    text: `Gizli telsiz tarayıcı: polis ihbarı yapıldığında ekiplerin olay yerine kaçıncı saniyede varacağını CANLI SAYAÇ olarak gösterir, yoldaki ekipleri haritada işaretler. Araçtayken ya da araca ${SECURITY.scannerRange} m yakınken çalışır.`,
    carsOnly: false,
  },
};

export function hasSecurity(mods: VehicleMods, item: SecurityItem): boolean {
  return !!mods[item];
}

/** Armour (%) a hit takes off: every bullet the same (so it lasts `armorHits` of any gun); a blast more. */
export function armorCost(kind: 'bullet' | 'blast', damage: number): number {
  return kind === 'bullet' ? 100 / SECURITY.armorHits : damage * SECURITY.armorBlast;
}

/** Patching up worn armour at Chroma Customs: $120 per % missing (a full patch-up $12,000). */
export function armorRepairPrice(armor: number): number {
  return Math.ceil(Math.max(0, 100 - armor)) * Math.round(SECURITY.armorPrice * 0.003);
}

/** How cracked the armoured glass looks: 0 clean, 1-3 more and more cracks (armour % left). */
export function crackLevel(armor: number): 0 | 1 | 2 | 3 {
  if (armor >= 99.5) return 0;
  if (armor > 66) return 1;
  if (armor > 33) return 2;
  return 3;
}
