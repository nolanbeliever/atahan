import * as THREE from 'three';
import {
  drawMarble, drawPlanks, drawCarpet, drawWallpaper, drawBrick, drawCobble, drawWood,
  drawSkyline, drawWindmill, signDrawer,
} from './Textures.js';

// Doku ölçeği: dünya metresi başına doku tekrarı (StaticBatcher.worldUV için)
export const UV = Object.freeze({
  floorLobby: 0.62,
  floorRoom: 0.9,
  floorCorridor: 0.9,
  wall: 0.8,
  brick: 1.6,
  cobble: 1.1,
  wood: 1.0,
  wainscot: 1.0,
  shopWall: 0.7,
  barWall: 1 / 3.2, // bir karo = duvar yüksekliği (lambri + sıva tek dokuda)
});

/**
 * Tüm malzemeler MeshLambertMaterial (köşe başı aydınlatma, PBR'den çok daha
 * ucuz) ya da ışıktan etkilenmeyen MeshBasicMaterial'dır.
 */
export function createMaterials(factory) {
  const tex = {
    marble: factory.make(drawMarble, { seed: 11 }),
    parquet: factory.make(drawPlanks, { seed: 12 }),
    carpet: factory.make(drawCarpet, { seed: 13 }),
    wallpaper: factory.make(drawWallpaper, { seed: 14 }),
    brick: factory.make(drawBrick, { seed: 15 }),
    cobble: factory.make(drawCobble, { seed: 16 }),
    wood: factory.make(drawWood, { seed: 17, w: 0.5, h: 0.5 }),
    skyline: factory.make(drawSkyline, { seed: 18, w: 2, h: 1 }),
    windmill: factory.make(drawWindmill, { seed: 19, w: 0.75, h: 0.55, repeat: false }),
    signHotel: factory.make(signDrawer({ title: 'HOTEL DE TULP', sub: 'Amsterdam · sinds 1902' }), { w: 2, h: 0.36, repeat: false }),
    signReception: factory.make(signDrawer({ title: 'RESEPSİYON', sub: 'Receptie · Reception', bg: '#203a5c' }), { w: 1.6, h: 0.36, repeat: false }),
    signOpen: factory.make(signDrawer({ title: 'AÇIK', sub: 'Open · Geopend', bg: '#1f6b3a', fg: '#ffffff' }), { w: 1, h: 0.4, repeat: false }),
    signClosed: factory.make(signDrawer({ title: 'KAPALI', sub: 'Gesloten · Hafta sonu', bg: '#8f2420', fg: '#ffffff' }), { w: 1, h: 0.4, repeat: false }),
  };

  const L = (o) => new THREE.MeshLambertMaterial(o);
  const B = (o) => new THREE.MeshBasicMaterial(o);

  const mats = {
    floorLobby: L({ map: tex.marble }),
    floorRoom: L({ map: tex.parquet }),
    floorCorridor: L({ map: tex.carpet }),
    wall: L({ map: tex.wallpaper }),
    brick: L({ map: tex.brick }),
    cobble: L({ map: tex.cobble }),
    wood: L({ map: tex.wood }),
    wainscot: L({ map: tex.wood, color: 0x9c7a5c }),
    white: L({ color: 0xf2efe8 }),
    linen: L({ color: 0xfbfaf6 }),
    paintGreen: L({ color: 0x1f4d3a }),
    roomDoor: L({ color: 0x5c3a24 }),
    fabricBlue: L({ color: 0x2d4f7c }),
    fabricRed: L({ color: 0x9c2f2f }),
    fabricGreen: L({ color: 0x3e6b48 }),
    fabricOrange: L({ color: 0xe36f1e }),
    metal: L({ color: 0x3b3d42 }),
    brass: L({ color: 0xc9a25e }),
    stone: L({ color: 0x8d8a84 }),
    water: L({ color: 0x2c5a70 }),
    leaf: L({ color: 0x3f7d3a }),
    soil: L({ color: 0x3a2a1c }),
    tulipRed: L({ color: 0xd7263d }),
    tulipYellow: L({ color: 0xf6c90e }),
    tulipPink: L({ color: 0xf28ab2 }),
    delft: L({ color: 0x2b5ea7 }),
    bollard: L({ color: 0x5a2418 }),
    black: L({ color: 0x1c1c1f }),
    rugRed: L({ color: 0x7d2433 }),
    rugBlue: L({ color: 0x23395b }),
    glassDark: L({ color: 0x2c3a46 }),
    // Işıktan etkilenmeyen (ucuz) malzemeler: tavan, lambalar, cam, manzara
    // (tavan aşağı baktığı için yarım küre ışığının koyu zemin rengini alırdı)
    ceiling: B({ color: 0xd9d1c3 }),
    lamp: B({ color: 0xfff1c8 }),
    glassDay: B({ color: 0xd3e8f5 }),
    skyline: B({ map: tex.skyline }),
    painting: L({ map: tex.windmill }),
    signHotel: L({ map: tex.signHotel }),
    signReception: L({ map: tex.signReception }),
    signOpen: B({ map: tex.signOpen }),
    // Çöpler (dinamik)
    paper: L({ color: 0xe8e4d8 }),
    canRed: L({ color: 0xc8202f }),
    cardboard: L({ color: 0xb08850 }),
    bottle: L({ color: 0x7fc4d8 }),
  };

  return { mats, tex };
}
