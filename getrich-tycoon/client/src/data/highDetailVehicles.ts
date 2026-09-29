// High-detail (HQ) 3D models for vehicles: .glb files (Draco compression supported) in
// client/public/assets/models. A vehicle uses its HQ model when the file is there; otherwise the
// built-in procedural body is drawn, so the game always has a car to show.
//
// Where to get models: Sketchfab (filter "Downloadable", check the licence - CC BY needs a credit),
// Poly Pizza (CC0 / CC BY, low-poly), CGTrader (paid / free, check the licence). Export or convert to
// .glb, ideally Draco-compressed and under ~10 MB (e.g. `npx @gltf-transform/cli optimize in.glb
// out.glb --compress draco --texture-compress webp`).
//
// Fields:
//   id              - unique id of this model entry
//   vehicleId       - the catalogue vehicle (shared/vehicles.ts) that uses it
//   modelUrl        - where the file is served from (client/public is the web root)
//   scale           - extra scale after the model is fitted to the vehicle's real length
//   rotationOffset  - rotation (radians) that turns the model to face +z (the game's "forward")
//   castShadow / receiveShadow
//   paintMaterials  - material names (case-insensitive substrings) that take the car's paint colour;
//                     leave empty to keep the model's own colours
//   credit          - author / licence note shown nowhere in game, kept for your records

export interface HighDetailVehicle {
  id: string;
  vehicleId: string;
  name: string;
  modelUrl: string;
  scale: number;
  rotationOffset: { x: number; y: number; z: number };
  castShadow: boolean;
  receiveShadow: boolean;
  paintMaterials?: string[];
  credit?: string;
}

const PAINT = ['paint', 'body', 'carpaint', 'car_paint', 'exterior'];

export const highDetailVehicles: HighDetailVehicle[] = [
  { id: 'm3_g80_hq', vehicleId: 'bmw_m3_g80', name: 'BMW M3 G80 Competition', modelUrl: './assets/models/m3_g80_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'i7_g70_hq', vehicleId: 'bmw_i7_g70', name: 'BMW i7 (G70)', modelUrl: './assets/models/i7_g70_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'x7_lci_hq', vehicleId: 'bmw_x7_facelift', name: 'BMW X7 (G07 LCI)', modelUrl: './assets/models/x7_lci_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'g60_hq', vehicleId: 'bmw_5_g60', name: 'BMW 5 Series (G60)', modelUrl: './assets/models/g60_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'f900gs_hq', vehicleId: 'bmw_gs_moto', name: 'BMW F 900 GS', modelUrl: './assets/models/f900gs_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'm8_comp_hq', vehicleId: 'bmw_m8_comp', name: 'BMW M8 Competition', modelUrl: './assets/models/m8_comp_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'amg_gt_hq', vehicleId: 'mercedes_amg_gt', name: 'Mercedes-AMG GT', modelUrl: './assets/models/amg_gt_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'w214_hq', vehicleId: 'mercedes_e_w214', name: 'Mercedes E-Class (W214)', modelUrl: './assets/models/w214_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'g63_hq', vehicleId: 'mercedes_g_class', name: 'Mercedes-AMG G 63', modelUrl: './assets/models/g63_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
  { id: 'rs5_hq', vehicleId: 'audi_rs5_coupe', name: 'Audi RS5 Coupé', modelUrl: './assets/models/rs5_hq.glb', scale: 1.0, rotationOffset: { x: 0, y: Math.PI, z: 0 }, castShadow: true, receiveShadow: true, paintMaterials: PAINT },
];
