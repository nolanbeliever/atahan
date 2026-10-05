// Dealership plot visuals (changes with level) and signage.

import * as THREE from 'three';
import { dealershipLevel } from '../../../shared/economy.config';
import type { Dealership } from '../../../shared/types';
import { PLOTS, PLOT_HALF, plotSlot, plotSlotCount, plotStructuresLocal, type Plot } from '../../../shared/world';
import { SIDEWALK_HEIGHT } from './City';
import { batchStatic } from './batch';
import { Tex } from './Textures';

const boxGeo = new THREE.BoxGeometry(1, 1, 1);

function box(mat: THREE.Material | THREE.Material[], sx: number, sy: number, sz: number, x: number, y: number, z: number, shadow = true): THREE.Mesh {
  const m = new THREE.Mesh(boxGeo, mat);
  m.scale.set(sx, sy, sz);
  m.position.set(x, y, z);
  m.castShadow = shadow;
  m.receiveShadow = true;
  return m;
}

const M = {
  pad: new THREE.MeshStandardMaterial({ color: '#7f858e', roughness: 0.9 }),
  padEmpty: new THREE.MeshStandardMaterial({ color: '#6f8f5a', roughness: 1 }),
  padLux: new THREE.MeshStandardMaterial({ color: '#2b2f38', roughness: 0.35, metalness: 0.3 }),
  line: new THREE.MeshStandardMaterial({ color: '#f8f9fa', roughness: 0.6 }),
  lineGold: new THREE.MeshStandardMaterial({ color: '#ffc53d', roughness: 0.4, metalness: 0.6 }),
  fence: new THREE.MeshStandardMaterial({ color: '#495057', metalness: 0.5, roughness: 0.4 }),
  office: new THREE.MeshStandardMaterial({ color: '#f1f3f5', roughness: 0.6 }),
  glass: new THREE.MeshStandardMaterial({ color: '#9fd3ff', metalness: 0.8, roughness: 0.05, transparent: true, opacity: 0.35, envMapIntensity: 1.5 }),
  darkGlass: new THREE.MeshStandardMaterial({ color: '#1a2233', metalness: 0.9, roughness: 0.08, transparent: true, opacity: 0.6 }),
  frame: new THREE.MeshStandardMaterial({ color: '#dee2e6', metalness: 0.7, roughness: 0.3 }),
  frameGold: new THREE.MeshStandardMaterial({ color: '#d4a017', metalness: 1, roughness: 0.22 }),
  roof: new THREE.MeshStandardMaterial({ color: '#343a40', roughness: 0.8 }),
  floor: new THREE.MeshStandardMaterial({ color: '#e9ecef', roughness: 0.25, metalness: 0.1 }),
  pole: new THREE.MeshStandardMaterial({ color: '#6c757d', metalness: 0.6, roughness: 0.35 }),
  forSale: new THREE.MeshStandardMaterial({ color: '#ffffff' }),
};

const FLAG_COLORS = ['#e63946', '#ffbe0b', '#3a86ff', '#2ee59d', '#ff006e', '#8338ec'];

export class DealershipsView {
  readonly group = new THREE.Group();
  private plots = new Map<string, { group: THREE.Group; key: string }>();

  constructor() {
    for (const plot of PLOTS) this.update(plot, undefined, false, 0);
  }

  update(plot: Plot, d: Dealership | undefined, mine: boolean, price: number): void {
    const key = d ? `${d.level}|${d.name}|${mine}` : `empty|${price}`;
    const existing = this.plots.get(plot.id);
    if (existing?.key === key) return;
    if (existing) {
      this.group.remove(existing.group);
      existing.group.traverse((o) => {
        const mesh = o as THREE.Mesh;
        const mat = mesh.material as THREE.MeshStandardMaterial | undefined;
        if (mat?.map && mat.userData.owned) {
          mat.map.dispose();
          mat.dispose();
        }
      });
    }
    const g = this.build(plot, d, mine, price);
    g.position.set(plot.cx, SIDEWALK_HEIGHT, plot.cz);
    g.rotation.y = plot.rot;
    g.updateMatrixWorld(true);
    batchStatic(g);
    g.traverse((o) => {
      o.matrixAutoUpdate = false;
      o.updateMatrix();
    });
    this.group.add(g);
    this.plots.set(plot.id, { group: g, key });
  }

  private sign(text: string, sub: string, accent: string, w: number, h: number): THREE.Mesh {
    const tex = Tex.sign(text, { bg: '#0f1626', fg: '#ffffff', accent, sub, h: 256 });
    const mat = new THREE.MeshStandardMaterial({ map: tex, emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.4, roughness: 0.4, side: THREE.DoubleSide });
    mat.userData.owned = true;
    return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
  }

  private build(plot: Plot, d: Dealership | undefined, mine: boolean, price: number): THREE.Group {
    const g = new THREE.Group();
    const level = d?.level ?? 0;
    const lux = level >= 5;
    // Pad
    g.add(box(!d ? M.padEmpty : lux ? M.padLux : M.pad, PLOT_HALF * 2, 0.04, PLOT_HALF * 2, 0, 0.02, 0, false));
    // Border lines
    const lineMat = lux ? M.lineGold : M.line;
    for (const [sx, sz, x, z] of [
      [PLOT_HALF * 2, 0.2, 0, -PLOT_HALF + 0.1],
      [0.2, PLOT_HALF * 2, -PLOT_HALF + 0.1, 0],
      [0.2, PLOT_HALF * 2, PLOT_HALF - 0.1, 0],
    ] as const)
      g.add(box(lineMat, sx, 0.05, sz, x, 0.045, z, false));

    if (!d) {
      // Empty plot: FOR SALE sign
      const s = this.sign(`PLOT ${plot.index} FOR SALE`, `$${price.toLocaleString('en-US')}  -  Press E here to buy`, '#2ee59d', 9, 2.3);
      s.position.set(0, 3, PLOT_HALF - 3);
      g.add(s);
      for (const x of [-4.2, 4.2]) g.add(box(M.pole, 0.18, 4.1, 0.18, x, 2.05, PLOT_HALF - 3.05));
      // Survey stakes at the corners
      const stake = new THREE.MeshStandardMaterial({ color: '#ff9f1c', roughness: 0.6 });
      for (const [x, z] of [[-PLOT_HALF + 1, -PLOT_HALF + 1], [PLOT_HALF - 1, -PLOT_HALF + 1], [-PLOT_HALF + 1, PLOT_HALF - 1], [PLOT_HALF - 1, PLOT_HALF - 1]] as const) {
        g.add(box(stake, 0.2, 1.2, 0.2, x, 0.6, z));
      }
      return g;
    }

    // Slot markings
    const slots = plotSlotCount(level);
    for (let i = 0; i < slots; i++) {
      const w = plotSlot(plot, i);
      // Convert back to plot-local coordinates
      const dx = w.x - plot.cx;
      const dz = w.z - plot.cz;
      const c = Math.cos(-plot.rot);
      const s = Math.sin(-plot.rot);
      const lx = dx * c + dz * s;
      const lz = -dx * s + dz * c;
      for (const side of [-1, 1]) g.add(box(lineMat, 0.12, 0.05, 5.8, lx + side * 3.6, 0.05, lz, false));
      if (level >= 3) {
        const disc = new THREE.Mesh(new THREE.CylinderGeometry(3.1, 3.1, 0.06, 32), lux ? M.frameGold : M.floor);
        disc.position.set(lx, 0.06, lz);
        disc.receiveShadow = true;
        g.add(disc);
      }
    }

    // Fence posts along sides and back
    for (let i = -PLOT_HALF; i <= PLOT_HALF; i += 4) {
      g.add(box(M.fence, 0.12, 0.9, 0.12, -PLOT_HALF + 0.3, 0.45, i));
      g.add(box(M.fence, 0.12, 0.9, 0.12, PLOT_HALF - 0.3, 0.45, i));
    }
    g.add(box(M.fence, 0.05, 0.08, PLOT_HALF * 2, -PLOT_HALF + 0.3, 0.85, 0));
    g.add(box(M.fence, 0.05, 0.08, PLOT_HALF * 2, PLOT_HALF - 0.3, 0.85, 0));

    // Buildings
    for (const st of plotStructuresLocal(level)) {
      const w = st.box.maxX - st.box.minX;
      const dd = st.box.maxZ - st.box.minZ;
      const cx = (st.box.minX + st.box.maxX) / 2;
      const cz = (st.box.minZ + st.box.maxZ) / 2;
      const h = st.height;
      if (st.kind === 'office') {
        const win = Tex.windows('dealer-office', '#f1f3f5', '#27415f', '#ffe7a8', 4, 1);
        const side = new THREE.MeshStandardMaterial({ map: win, roughness: 0.6 });
        g.add(box([side, side, M.roof, M.roof, side, side], w, h, dd, cx, h / 2, cz));
        g.add(box(M.roof, w + 1, 0.25, dd + 1, cx, h + 0.1, cz));
      } else if (st.kind === 'bay') {
        const roller = new THREE.MeshStandardMaterial({ map: Tex.rollerDoor(), roughness: 0.6, metalness: 0.3 });
        g.add(box([M.office, M.office, M.roof, M.roof, roller, M.office], w, h, dd, cx, h / 2, cz));
        const bay = this.sign('REPAIR BAY', '', '#e76f51', w * 0.8, 0.9);
        bay.position.set(cx, h + 0.5, st.box.maxZ + 0.05);
        g.add(bay);
      } else {
        // Glass showroom
        const gm = st.kind === 'luxury' || st.kind === 'mega' ? M.darkGlass : M.glass;
        const fm = st.kind === 'luxury' ? M.frameGold : M.frame;
        g.add(box(M.floor, w, 0.1, dd, cx, 0.05, cz, false));
        g.add(box(gm, w, h, dd, cx, h / 2, cz, false));
        g.add(box(fm, w + 0.3, 0.4, dd + 0.3, cx, h, cz));
        for (let x = st.box.minX; x <= st.box.maxX + 0.01; x += (st.box.maxX - st.box.minX) / 5) {
          g.add(box(fm, 0.18, h, 0.18, x, h / 2, st.box.maxZ));
          g.add(box(fm, 0.18, h, 0.18, x, h / 2, st.box.minZ));
        }
        if (st.kind === 'mega') {
          g.add(box(fm, w, 0.3, dd, cx, h / 2, cz));
          // Tall sign pylon
          g.add(box(M.frame, 1.2, 14, 1.2, st.box.maxX + 1.5, 7, st.box.maxZ + 1));
        }
      }
    }

    // Name sign at the front
    const cfg = dealershipLevel(level);
    const accent = mine ? '#ffc53d' : lux ? '#d4a017' : '#4f8cff';
    const sign = this.sign(d.name.toUpperCase(), `${d.ownerName}  -  ${cfg.name}`, accent, 9, 2);
    sign.position.set(0, level >= 6 ? 4.2 : 3.2, PLOT_HALF - 1.2);
    g.add(sign);
    for (const x of [-4.3, 4.3]) g.add(box(M.pole, 0.18, level >= 6 ? 5.2 : 4.2, 0.18, x, level >= 6 ? 2.6 : 2.1, PLOT_HALF - 1.25));

    // Pennant flags from level 2
    if (level >= 2) {
      const flagGeo = new THREE.ConeGeometry(0.3, 0.6, 3);
      flagGeo.rotateX(Math.PI);
      const flagMats = FLAG_COLORS.map((c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7 }));
      for (const side of [-1, 1]) {
        g.add(box(M.pole, 0.12, 5, 0.12, side * (PLOT_HALF - 0.5), 2.5, PLOT_HALF - 0.5));
        g.add(box(M.pole, 0.12, 5, 0.12, side * (PLOT_HALF - 0.5), 2.5, -PLOT_HALF + 0.5));
        for (let i = 0; i < 24; i++) {
          const t = i / 23;
          const f = new THREE.Mesh(flagGeo, flagMats[i % flagMats.length]!);
          f.position.set(side * (PLOT_HALF - 0.5), 4.7 - Math.sin(t * Math.PI) * 0.8, PLOT_HALF - 0.5 - t * (PLOT_HALF * 2 - 1));
          g.add(f);
        }
      }
    }
    // Spotlights for luxury levels
    if (lux) {
      const lamp = new THREE.MeshStandardMaterial({ color: '#fff8e1', emissive: '#fff1c1', emissiveIntensity: 1.2 });
      for (const x of [-12, -4, 4, 12]) g.add(box(lamp, 0.4, 0.4, 0.4, x, 0.25, PLOT_HALF - 0.6));
    }
    return g;
  }
}
