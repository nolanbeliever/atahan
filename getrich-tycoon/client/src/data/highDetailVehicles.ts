// 3D models of every vehicle in the game. Each vehicle is a .glb / .gltf file (Draco compression is
// supported) loaded with GLTFLoader + DRACOLoader - there are no built-in / procedural car shapes.
//
// HOW TO USE REAL CAR MODELS
//   1. Get a .glb of the real car (Sketchfab, CGTrader, TurboSquid... check that the licence allows
//      use in your game, and credit the author when it asks for it).
//   2. Either put it in client/public/assets/models/ named after the vehicle id
//      (e.g. client/public/assets/models/bmw_m3_g80.glb) - it replaces the default model
//      automatically - or change `modelUrl` of that vehicle below (a path under client/public, or a
//      full https:// URL).
//   3. The game fits every model to the vehicle's real size (length from the catalogue), centres it,
//      stands the tyres on the road and turns it to face forward (+z). If a model comes in facing
//      backwards or sideways, set `rotationOffset` (radians, e.g. { x: 0, y: Math.PI, z: 0 }); use
//      `scale` to fine-tune the size.
//
// NAMING CONVENTION (optional, makes more things work with your own models)
//   wheel_fl / wheel_fr / wheel_rl / wheel_rr   wheels that spin and steer (fl = front left)
//   door_fl                                       driver's door (opens when you get in and out)
//   door_fl_cavity / door_fr_cavity               the door openings (shown when a door is open or stripped)
//   door_fr, mirror_l, mirror_r                   passenger door and side mirrors (stripped at the Sanayi)
//   seat_driver                                   empty at the driver's eyes (first-person camera)
//   exhaust_0..3                                  exhaust tips (backfire flames)
//   headlights / taillights                       lamp meshes (they light up at night / braking)
//   materials named "paint" (or listed in paintMaterials) take the car's colour
//   kits > kit_wing_gt, kit_fb_aero, acc_roofrack ... optional body-kit parts shown when fitted
// Common names like "Wheel_FL", "wheel front left", "Door_L" are recognised too, and you can map
// your model's own node names with `nodes`.
//
// Fields:
//   id              unique id of this entry
//   vehicleId       catalogue vehicle (shared/vehicles.ts), traffic kind or 'police'
//   modelUrl        the model file
//   lodUrl          optional simplified copy used far away (traffic); null = use modelUrl
//   scale           extra scale after fitting to the real length
//   rotationOffset  radians that turn the model to face +z
//   castShadow / receiveShadow
//   paintMaterials  material names (case-insensitive substrings) that take the paint colour
//   nodes           your model's node names for wheels / door / seat, if they differ
//   interior        true when the model has its own detailed cockpit (the generic one is not added)
//   autoFit         false keeps the model's own size and origin (the default models are built to size)
//   credit          author / licence note for your records

export interface HighDetailVehicle {
  id: string;
  vehicleId: string;
  name: string;
  modelUrl: string;
  lodUrl?: string | null;
  scale: number;
  rotationOffset: { x: number; y: number; z: number };
  castShadow: boolean;
  receiveShadow: boolean;
  paintMaterials?: string[];
  nodes?: { wheels?: Partial<Record<'fl' | 'fr' | 'rl' | 'rr' | 'front' | 'rear', string>>; door?: string; seat?: string };
  interior?: boolean;
  /**
   * Fit the model to the catalogue size (scale to the length, centre it, stand it on its tyres).
   * Default true; the models that ship with the game are already built to size (a rear spare wheel
   * may stick out past the body) and use false.
   */
  autoFit?: boolean;
  credit?: string;
}

/** Folder of the default models that ship with the game. */
export const DEFAULT_MODEL_DIR = './assets/models/vehicles/';
/** Folder for your own models (drop-in replacements named <vehicleId>.glb). */
export const CUSTOM_MODEL_DIR = './assets/models/';

export const PAINT_MATERIALS = ['paint', 'body', 'carpaint', 'car_paint', 'exterior'];

function car(vehicleId: string, name: string, extra: Partial<HighDetailVehicle> = {}): HighDetailVehicle {
  return {
    id: vehicleId,
    vehicleId,
    name,
    modelUrl: `${DEFAULT_MODEL_DIR}${vehicleId}.glb`,
    lodUrl: `${DEFAULT_MODEL_DIR}${vehicleId}.lod.glb`,
    scale: 1,
    rotationOffset: { x: 0, y: 0, z: 0 },
    castShadow: true,
    receiveShadow: true,
    paintMaterials: PAINT_MATERIALS,
    autoFit: false,
    credit: 'GetRich Tycoon default model',
    ...extra,
  };
}

export const highDetailVehicles: HighDetailVehicle[] = [
  // Everyday catalogue
  car('norda_pixi', 'Norda Pixi'),
  car('voltara_luma', 'Voltara Luma EV'),
  car('norda_arlo', 'Norda Arlo'),
  car('velora_serene', 'Velora Serene'),
  car('granforge_ridgeback', 'Granforge Ridgeback'),
  car('solenne_marquee', 'Solenne Marquee'),
  car('granforge_hauler', 'Granforge Hauler 2500'),
  car('granforge_packmule', 'Granforge Packmule'),
  car('norda_workmate', 'Norda Workmate Van'),
  car('apexon_strix', 'Apexon Strix'),
  car('apexon_vanta', 'Apexon Vanta GT'),
  car('velora_aurelian', 'Velora Aurelian'),
  car('solenne_monarch', 'Solenne Monarch'),
  car('harlan_bellwether', "Harlan & Finch Bellwether '62"),
  car('harlan_duchess', "Harlan & Finch Duchess '58"),
  // Rare Dealer (real cars): replace these with licensed models of the real vehicles.
  car('bmw_i7_g70', 'BMW i7 (G70)'),
  car('bmw_m3_g80', 'BMW M3 Competition (G80)'),
  car('bmw_x7_facelift', 'BMW X7 M60i'),
  car('bmw_5_g60', 'BMW 5 Series (G60)'),
  car('bmw_gs_moto', 'BMW F 900 GS'),
  car('bmw_m8_comp', 'BMW M8 Competition Coupe'),
  car('mercedes_amg_gt', 'Mercedes-AMG GT Coupe'),
  car('mercedes_e_w214', 'Mercedes-Benz E-Class (W214)'),
  car('mercedes_g_class', 'Mercedes-AMG G 63'),
  car('audi_rs5_coupe', 'Audi RS5 Coupe'),
  // Highway traffic (trucks, coaches, semis) and the police interceptor
  car('truck', 'Box truck', { paintMaterials: ['paint'] }),
  car('bus', 'Intercity coach', { paintMaterials: ['paint'] }),
  car('semi_tractor', 'Semi tractor unit', { paintMaterials: ['paint'] }),
  car('semi_trailer', 'Semi trailer', { paintMaterials: ['paint'] }),
  car('police', 'Police Interceptor', { paintMaterials: [] }),
];

/**
 * Older high-detail file names (from the first HQ pipeline) still work: drop the file in
 * client/public/assets/models and it replaces that vehicle's model.
 */
export const LEGACY_HQ_FILES: Record<string, { vehicleId: string; rotationOffset?: { x: number; y: number; z: number } }> = {
  'm3_g80_hq.glb': { vehicleId: 'bmw_m3_g80', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'i7_g70_hq.glb': { vehicleId: 'bmw_i7_g70', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'x7_lci_hq.glb': { vehicleId: 'bmw_x7_facelift', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'g60_hq.glb': { vehicleId: 'bmw_5_g60', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'f900gs_hq.glb': { vehicleId: 'bmw_gs_moto', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'm8_comp_hq.glb': { vehicleId: 'bmw_m8_comp', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'amg_gt_hq.glb': { vehicleId: 'mercedes_amg_gt', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'w214_hq.glb': { vehicleId: 'mercedes_e_w214', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'g63_hq.glb': { vehicleId: 'mercedes_g_class', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
  'rs5_hq.glb': { vehicleId: 'audi_rs5_coupe', rotationOffset: { x: 0, y: Math.PI, z: 0 } },
};

/** Shared parts: aftermarket rim designs and the generic cockpit interior. */
export const PART_MODELS = {
  rims: `${DEFAULT_MODEL_DIR}rims.glb`,
  cockpit: `${DEFAULT_MODEL_DIR}cockpit.glb`,
};
