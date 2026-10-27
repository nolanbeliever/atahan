// Item definitions and loot tables (shared so the server can roll loot).

export const ITEMS = {
  fists: { name: 'Fists', type: 'melee', dmg: 9, range: 1.6, rate: 0.45, stack: 1, icon: '✊', hidden: true },
  knife: { name: 'Kitchen knife', type: 'melee', dmg: 24, range: 1.7, rate: 0.38, stack: 1, icon: '🔪' },
  crowbar: { name: 'Crowbar', type: 'melee', dmg: 36, range: 2.0, rate: 0.62, stack: 1, icon: '🪛' },
  bat: { name: 'Baseball bat', type: 'melee', dmg: 32, range: 2.2, rate: 0.6, stack: 1, icon: '🏏' },
  axe: { name: 'Fire axe', type: 'melee', dmg: 62, range: 2.2, rate: 0.95, stack: 1, icon: '🪓' },
  pistol: { name: 'Glock 19 pistol', type: 'gun', dmg: 40, range: 70, rate: 0.2, mag: 12, ammo: 'ammo9', spread: 0.01, pellets: 1, noise: 55, reload: 1.4, stack: 1, icon: '🔫' },
  shotgun: { name: 'Pump shotgun', type: 'gun', dmg: 17, range: 30, rate: 0.85, mag: 6, ammo: 'shells', spread: 0.065, pellets: 8, noise: 75, reload: 2.4, stack: 1, icon: '💥' },
  m4: { name: 'M4A1 carbine', type: 'gun', dmg: 30, range: 95, rate: 0.095, auto: true, mag: 30, ammo: 'ammo556', spread: 0.014, pellets: 1, noise: 85, reload: 2.1, stack: 1, icon: '🔫' },
  rifle: { name: 'Hunting rifle', type: 'gun', dmg: 110, range: 140, rate: 1.1, mag: 5, ammo: 'ammo308', spread: 0.002, pellets: 1, noise: 90, reload: 2.2, stack: 1, icon: '🎯' },
  ammo9: { name: '9mm rounds', type: 'ammo', stack: 90, icon: '•' },
  shells: { name: 'Shotgun shells', type: 'ammo', stack: 36, icon: '▪' },
  ammo308: { name: '.308 rounds', type: 'ammo', stack: 30, icon: '▸' },
  ammo556: { name: '5.56 rounds', type: 'ammo', stack: 120, icon: '▹' },
  bandage: { name: 'Bandage', type: 'heal', heal: 18, useTime: 2.0, stack: 6, stopBleed: true, icon: '🩹' },
  medkit: { name: 'Medkit', type: 'heal', heal: 65, useTime: 4.0, stack: 3, stopBleed: true, icon: '⛑️' },
  painkillers: { name: 'Painkillers', type: 'heal', heal: 10, useTime: 1.0, stack: 6, stamina: 40, icon: '💊' },
  antibiotics: { name: 'Antibiotics', type: 'heal', heal: 5, useTime: 1.5, stack: 4, cure: true, icon: '🧪' },
  water: { name: 'Bottled water', type: 'drink', thirst: 40, useTime: 1.5, stack: 4, icon: '💧' },
  soda: { name: 'Soda can', type: 'drink', thirst: 22, hunger: 4, useTime: 1.0, stack: 6, icon: '🥤' },
  canned: { name: 'Canned beans', type: 'food', hunger: 35, useTime: 2.5, stack: 4, icon: '🥫' },
  chips: { name: 'Chips', type: 'food', hunger: 14, thirst: -4, useTime: 1.2, stack: 6, icon: '🍟' },
  mre: { name: 'Military ration', type: 'food', hunger: 60, thirst: 10, useTime: 3.0, stack: 3, icon: '🍱' },
  fuelcan: { name: 'Fuel can (10 L)', type: 'fuel', fuel: 10, useTime: 2.5, stack: 2, icon: '⛽' },
  batteries: { name: 'Batteries', type: 'battery', charge: 100, useTime: 1.0, stack: 6, icon: '🔋' },
  scrap: { name: 'Scrap metal', type: 'junk', stack: 10, icon: '⚙️' },
};

export const isWeapon = (id) => ITEMS[id] && (ITEMS[id].type === 'melee' || ITEMS[id].type === 'gun');

// [item, weight, min, max]
export const LOOT = {
  kitchen: [['canned', 4, 1, 2], ['water', 3, 1, 2], ['soda', 3, 1, 2], ['chips', 3, 1, 2], ['knife', 1.5, 1, 1]],
  wardrobe: [['bandage', 2, 1, 2], ['batteries', 1.5, 1, 1], ['painkillers', 1, 1, 1], ['bat', 0.6, 1, 1], ['ammo9', 0.8, 4, 10], ['scrap', 1, 1, 2]],
  medical: [['bandage', 4, 1, 3], ['painkillers', 3, 1, 2], ['antibiotics', 1.5, 1, 1], ['medkit', 1, 1, 1]],
  pharmacy: [['painkillers', 4, 1, 3], ['antibiotics', 3, 1, 2], ['bandage', 3, 1, 3], ['medkit', 1.5, 1, 1], ['water', 1, 1, 1]],
  office: [['soda', 2, 1, 1], ['chips', 2, 1, 1], ['batteries', 2, 1, 2], ['painkillers', 1, 1, 1], ['scrap', 1, 1, 1]],
  shop: [['canned', 3, 1, 2], ['chips', 3, 1, 3], ['soda', 3, 1, 2], ['water', 2, 1, 2], ['batteries', 1.5, 1, 2], ['bandage', 1, 1, 1]],
  food: [['canned', 4, 1, 3], ['chips', 3, 1, 3], ['mre', 0.6, 1, 1], ['water', 2, 1, 2]],
  drinks: [['water', 4, 1, 3], ['soda', 4, 1, 3]],
  general: [['canned', 2, 1, 1], ['water', 2, 1, 1], ['bandage', 2, 1, 2], ['batteries', 2, 1, 2], ['scrap', 1.5, 1, 2], ['soda', 1.5, 1, 1]],
  tools: [['crowbar', 1.5, 1, 1], ['axe', 0.8, 1, 1], ['scrap', 3, 1, 3], ['batteries', 2, 1, 2], ['fuelcan', 1, 1, 1]],
  pawn: [['pistol', 1, 1, 1], ['ammo9', 3, 6, 18], ['shells', 2, 4, 10], ['bat', 1.5, 1, 1], ['batteries', 2, 1, 2], ['rifle', 0.35, 1, 1], ['ammo308', 0.8, 3, 8]],
  weapons: [['pistol', 3, 1, 1], ['shotgun', 2, 1, 1], ['m4', 1.4, 1, 1], ['ammo556', 2.5, 20, 45], ['rifle', 0.8, 1, 1], ['ammo9', 4, 12, 30], ['shells', 3, 6, 14]],
  ammo: [['ammo9', 5, 12, 30], ['shells', 4, 6, 14], ['ammo556', 3, 15, 40], ['ammo308', 2, 5, 10]],
  police: [['ammo9', 3, 6, 18], ['ammo556', 1, 10, 30], ['m4', 0.25, 1, 1], ['bandage', 2, 1, 2], ['batteries', 2, 1, 2], ['soda', 1, 1, 1], ['painkillers', 1, 1, 1], ['pistol', 0.5, 1, 1]],
  crate: [['mre', 2, 1, 2], ['water', 3, 1, 3], ['bandage', 2, 1, 3], ['medkit', 0.7, 1, 1], ['ammo9', 1.5, 6, 18], ['shells', 1, 4, 8], ['batteries', 1.5, 1, 2], ['fuelcan', 0.6, 1, 1]],
  trash: [['scrap', 3, 1, 2], ['chips', 1, 1, 1], ['soda', 1, 1, 1], ['batteries', 0.5, 1, 1], ['bandage', 0.5, 1, 1]],
  fuel: [['fuelcan', 3, 1, 2], ['scrap', 1, 1, 1]],
  zombie: [['ammo9', 2, 3, 8], ['bandage', 2, 1, 1], ['soda', 1, 1, 1], ['chips', 1, 1, 1], ['batteries', 1, 1, 1], ['painkillers', 1, 1, 1], ['shells', 1, 2, 4]],
};

export const EMPTY_CHANCE = { trash: 0.45, wardrobe: 0.35, office: 0.4, shop: 0.35, kitchen: 0.3, general: 0.35, medical: 0.25, pharmacy: 0.15, food: 0.2, drinks: 0.2, tools: 0.3, pawn: 0.25, police: 0.25, crate: 0.15, weapons: 0.05, ammo: 0.05, fuel: 0.1 };

export function rollLoot(table, rng, guaranteed) {
  const out = [];
  if (guaranteed) for (const g of guaranteed) out.push({ id: g, n: g.startsWith('ammo') ? 24 : 1 });
  const t = LOOT[table] || LOOT.general;
  if (!guaranteed && rng.chance(EMPTY_CHANCE[table] ?? 0.3)) return out;
  const rolls = rng.chance(0.35) ? 2 : 1;
  const total = t.reduce((s, e) => s + e[1], 0);
  for (let r = 0; r < rolls; r++) {
    let x = rng.next() * total;
    for (const [id, w, a, b] of t) {
      x -= w;
      if (x <= 0) {
        const n = rng.int(a, b);
        const ex = out.find(o => o.id === id);
        if (ex && ITEMS[id].stack > 1) ex.n += n;
        else if (!ex || !isWeapon(id)) out.push({ id, n }); // never two of the same weapon in one container
        break;
      }
    }
  }
  return out;
}
