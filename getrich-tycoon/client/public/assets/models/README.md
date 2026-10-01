# Vehicle models

Every vehicle in the game is a `.glb` model.

- `vehicles/` holds the default models that ship with the game (original, made for it): one `<vehicleId>.glb` plus a simplified
  `<vehicleId>.lod.glb` for far-away traffic, the shared `rims.glb` (aftermarket rim designs) and `cockpit.glb` (the generic
  first-person interior). They are listed in `client/src/data/highDetailVehicles.ts`.
- Put your own model here, named after the vehicle id (for example `bmw_m3_g80.glb`, `mercedes_g_class.glb`), and rebuild: it
  replaces the default model automatically and is fitted to the car's real size, centred and stood on its tyres. Older names
  like `m3_g80_hq.glb` still work. Or change `modelUrl` in `highDetailVehicles.ts` (also accepts a full `https://` URL).

The default car models have separate nodes for the parts that come off at the Sanayi: `mirror_l` / `mirror_r` (side mirrors),
`door_fl` / `door_fr` (front doors) with `door_fl_cavity` / `door_fr_cavity` (the openings behind them). A model without them
still works; those parts simply stay on when stripped. The seats, steering wheel and engine-bay parts shown on a car on the
lift come from `cockpit.glb` and `client/src/render/StripRig.ts`.

Draco compression is supported and recommended:
`npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`.

Only use models you are allowed to use (check the licence on Sketchfab / CGTrader / TurboSquid, credit the author where the
licence asks for it; car brands are trademarks).
