# Asset manifest

Status: **no third-party art files are bundled or downloaded.** Everything you see and
hear is generated in code at runtime. This is deliberate for the first build: it
keeps the download tiny for iPhone/iPad and avoids shipping assets whose licence I
could not verify from this environment.

| Asset | Source | Licence | Integrated? | Where |
|---|---|---|---|---|
| City layout, roads, sidewalks, markings | Procedural (this repo) | Project licence | Yes | `src/shared/world.js` |
| Buildings: apartments, houses, shops, supermarket, hospital, police station, petrol station, parking garage, warehouses, offices | Procedural modular architecture | Project licence | Yes | `src/shared/buildings.js` |
| Interiors & furniture (beds, shelves, lockers, desks, counters, cells, kitchens…) | Procedural | Project licence | Yes | `src/shared/props.js` |
| Street props (lamps, trees, traffic lights, bins, signs, carts, pallets, generator, debris) | Procedural geometry, GPU-instanced | Project licence | Yes | `src/client/models.js` |
| Vehicles (sedan, pickup, police cruiser, van, ambulance, truck, bus) | Procedural geometry | Project licence | Yes | `src/client/models.js` |
| Zombie and survivor characters | Procedural skinned meshes (18-bone skeleton, rigid skinning) | Project licence | Yes | `src/client/rig.js` |
| Character animation (walk, run, idle, attack, hit, stagger, death, crouch, aim, swing) | Procedural bone animation | Project licence | Yes | `src/client/rig.js` |
| PBR textures: asphalt, sidewalk, concrete, brick, plaster, siding, roofing, metal, rust, corrugated steel, wood, floors, tiles, carpet, fabric, grass, dirt | Canvas-painted at startup | Project licence | Yes | `src/client/materials.js` |
| Decals: blood, oil, cracks, puddles, patches, rugs, body bags, glass, helipad, posters, signage | Canvas-painted | Project licence | Yes | `src/client/materials.js` |
| Sky, clouds, stars, moon | GLSL shader | Project licence | Yes | `src/client/sky.js` |
| Sound: ambience, rain, footsteps, guns, melee, zombies, doors, engine, heartbeat, thunder, helicopter | WebAudio synthesis | Project licence | Yes | `src/client/audio.js` |
| three.js | npm `three` | MIT | Yes (library) | `package.json` |
| Vite | npm `vite` | MIT | Build tool | `package.json` |
| ws | npm `ws` | MIT | Server library | `server/package.json` |

## Adding licensed GLB/GLTF models later

The renderer is ready for imported models (three.js `GLTFLoader` ships with the
`three` package). Good CC0 sources to check, with each model's licence verified on its
own page before use:

* Quaternius — https://quaternius.com (CC0 low-poly characters with animations, city kits)
* Kenney — https://kenney.nl/assets (CC0 city kits, vehicles)
* Poly Haven — https://polyhaven.com (CC0 PBR textures, HDRIs and props)
* Khronos glTF sample assets — https://github.com/KhronosGroup/glTF-Sample-Assets (per-model licence in each folder)

Put the files in `public/models/` (e.g. `public/models/zombie.glb`). Add a row to the
table above with the source URL, the licence, and whether the model is actually wired
into the code. Nothing in this manifest claims a downloaded asset that isn't there.
