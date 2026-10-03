# GetRich Tycoon

A multiplayer 3D browser game about trading used vehicles and building a dealership empire.
It runs in Chrome (and other WebGL browsers) with a real, server-authoritative Node.js backend and a database.

> Start with **$25,000**. Buy worn cars at the Used Vehicle Market, haggle with NPC sellers, repair,
> wash and customize them, then sell them from your own dealership to NPC customers or to other players.
> Reinvest to grow from a small lot into a Mega Dealership and climb the net-worth leaderboard.

All code, the regular catalogue's brands (Norda, Voltara, Velora, Granforge, Apexon, Solenne, Harlan & Finch), the city, the UI and
the sounds are original. Every vehicle is a `.glb` model (Draco-compressed, loaded with `GLTFLoader` + `DRACOLoader`); the default
models that ship with the game are original, made for it, and sounds are synthesized with WebAudio, so there are no third-party
assets. The 10 exclusive Rare Dealer vehicles are real cars (BMW, Mercedes-Benz, Audi), named at the owner's request; their names
live in `shared/specialVehicles.ts`, and no logos or photos are included. Licensed models of the real cars can be dropped in for
any vehicle (see [Vehicle models](#vehicle-models)).

---

## Features

| Area | What is implemented |
| --- | --- |
| **Multiplayer** | Socket.IO WebSockets. Movement is server-authoritative with client-side prediction and reconciliation. Remote players are interpolated. Vehicles, listings, dealerships, auctions, NPC customers and chat all sync in real time. |
| **World** | A procedural 3D city with 9 districts: Dealership Row (8 plots), Used Vehicle Market, Hammerfall Auction House, Wrench Bros Repair & Parts Depot, Sparkle Wash & fuel station, GetRich Bank, Chroma Customs, parking lots and Fortune Plaza (spawn). A green belt with trees surrounds the city, then the highway. A shared **10-minute day** (server clock) with an orange sunset, stars and a moon, lit windows, neon shop signs, street and highway lights, and headlights / brake lights on every car at night. **Rain** comes in random spells for everyone: falling rain, darker skies, wet glossy roads that take a minute to dry, and **20% less tyre grip**. |
| **Highway (No Hesi)** | The GetRich Expressway rings the city: 4 lanes each way (8 in total), white dashed lane lines and yellow edge lines, W-beam guardrails, a concrete median with crossovers, three junctions to the city with long, smooth S-curve on- and off-ramps (an open guardrail all along them, so you can leave or join at speed), three road bridges over it, green sign gantries and street lights standing in the middle of the median that light up the road at night. Street lamps and camera poles stand on the sidewalks, never on a road. |
| **Traffic** | 116 server-driven vehicles: cars, box trucks, coaches and TIR semis (tractor + 13.6 m trailer that bends through the corners). Lane speeds of about 120 km/h on the left down to 80 km/h for trucks on the right; drivers follow at a safe distance (IDM), blink before they change lanes (MOBIL-style), keep right, brake for stopped cars and people, and move over when you come up fast behind them or use the horn / headlight flash (**H**). Brake lights, indicators and headlights are all visible. |
| **Near misses** | Above 150 km/h, passing traffic within **50 cm** (measured between the real body outlines) without touching pays **NEAR MISS / MAKAS +$100** and XP, x1.5 for a hair's-breadth pass under 20 cm; the popup shows the gap in cm. Consecutive near misses build a combo (x2 from 3, x3 from 6, x5 from 10); the combo meter shows the combo's cash and XP and runs out after 6 s without a near miss. Any crash (or touching traffic) resets it. Near-miss cash is capped per hour. |
| **Drag racing** | An eighth-mile drag strip in the west belt with grandstand, start/finish gantries and a Christmas tree. Pay $250 and race a bot matched to your car's performance, or wait for another player; the winner takes the $500 pool. Three red lights, then green after a random delay; moving before green is a FALSE START and loses. Reaction time, elapsed time and trap speed are measured on the server; the cars run on their tuned physics, and 0-100 / top speed come from the tuning stats. |
| **The strait & bridges** | East of the city the land ends at a strait. Two big **suspension bridges** cross it (North and South): six lanes, tall towers, main cables and hangers with LED lights at night, giant lamp posts, long straights. Each bridge has **speed radars** on gantries over the deck: drive under one fast and the camera flashes, your speed is shown with your personal best and the server record. |
| **The far shore (Karşı kıyı)** | A different atmosphere across the water: the **VIP Otoban** running north-south past both bridge ends; the **Touge / Mountain Pass** that climbs a wooded hill in tight hairpins between guardrails and comes down to the boulevard; the **Liman & Depolar** container port (stacks of containers, gantry cranes, flood-light towers, a fenced yard); and the **Galeri Bulvarı** with the showrooms. The police follow you over the bridges (up on the deck or on the road underneath) and along the far shore's roads. |
| **Themed showrooms (Galeri Bulvarı)** | Eight dealerships, each with its own building and colours: **JDM Underground** (Supra A80, Skyline R34, RX-7 FD), **German Muscle & Tuning** (BMW M3 / M8, Mercedes-AMG GT, Audi RS5, 5 Series, E-Class), **Hypercar Pavilion** (Bugatti Chiron, Lamborghini Aventador SVJ, Ferrari SF90), **Classic & Vintage Garage** (Mustang Boss 429, Charger R/T and the classic cruisers), **Moto & ATV Showroom**, **Off-Road & SUV Empire** (G 63, Urus, Ranger Raptor, X7, Ridgeback), **EV / Futuristic** (Rimac Nevera, Tesla Model S Plaid, i7, Luma) and the **Black Market** (stolen, plate-wiped "Sanayi toplaması" cars, cheap, six one-of-a-kind cars that change every 10 minutes; they carry a theft record). At the door: **Galeriyi Gez (E)**. Inside, the cars spin on a **turntable** (Showroom Rotator) in 3D; pick a factory colour, **buy** it new, or take a free 2-minute **test drive**: the car waits in the showroom's bay, a clock runs on the HUD, and it goes back when the time is up (you're walked back to the door) or when you get out (**Teslim Et**). Damage on a test drive is billed (at most 5% of the price). Turntables with stock cars stand on the forecourts and behind the glass. |
| **Tolls, plate cameras, checkpoints** | Heading over to the far shore you pass a **toll plaza** (canopy, booths, a barrier arm in each lane): slow down under 40 km/h, the HGS reader bleeps and the arm lifts (**İyi Yolculuklar - $250**); crash through it and it is a **$1,500 evasion fine**. **ANPR cameras** on gantries over each bridge's city end and at the plazas read every plate, both ways: a car with a theft record (Black Market), a stolen car or a wanted driver's car gets **+1 star** and a "PLAKA TANIMA UYARISI" notice. At the Black Market you can fit a **plate flipper** (P while driving turns the plate away: unreadable) or a **fake plate** (reads clean). Drive onto a bridge with **2 stars** and the police set up a **checkpoint** at its far end: four cars in a V across the deck and a spike strip in the middle (**POLİS KONTROL NOKTASI - BARİKATI YAR VEYA KAÇ!**); ram an outer car aside at speed and get past: **+$2,000**. A live **Geçiş Geçmişi** feed under the HUD, an official-looking **Ceza Bildirimi** for fines and camera hits, and a history panel (Esc menu > Geçiş Geçmişi). |
| **Player** | Account (name + password), money, bank, XP/levels, reputation, stats, 17 achievements, settings, appearance, parts inventory. |
| **Vehicles** | 15 fictional cars in 8 categories, a **Moto & ATV** category (Yamaha MT-09, Yamaha Tracer 7, KTM 390 Duke, Yamaha YZ250 motocross and the Granforge Mudhog 700 4x4 quad: stand-in bodies in the spirit of each bike, no logos) plus 10 real exclusive models (9 cars and a motorcycle you ride visibly) from the Rare Dealer and 12 real showroom-only cars (Supra, Skyline R34, RX-7, Chiron, Aventador SVJ, SF90, Mustang Boss 429, Charger R/T, Urus, Ranger Raptor, Nevera, Model S Plaid) with real figures, each with its own detailed 3D body modelled after a real type of car (city hatch, EV, sedans, off-roader, luxury SUV, crew-cab and single-cab pickups, van, rear-engine coupe, supercar, GT, '60s cruiser with fins, roadster): curved panels, glass, wheel arches, lamps, grilles, bumpers and 6 rim styles, with small differences and no real brand names or logos. Each vehicle tracks mileage, fuel, 6 condition parts, cleanliness, mods, owner and sale status. Condition affects value, driving performance and repair cost. |
| **Driving physics** | Real longitudinal physics per car: torque curve, gearbox with shift times, clutch slip at launch, turbo spool, traction limits and weight transfer, rolling resistance and aerodynamic drag that grows with the square of speed, ABS braking (lock-up on classics). 0-100, 100-200 and 200-300 km/h match the real figures (a stock supercar needs ~25 s for 0-300). Smoothed steering, yaw inertia and speed-sensitive lock (no instant direction changes at 200+ km/h), body roll and pitch, handbrake slides. Tight body-shaped (OBB) collision boxes for every car, truck, bus and semi. |
| **Driving** | **F** gets in and out: the character walks to the driver's door (around the car if needed), the door opens, they sit down and the door shuts; drivers are visible in their seats. **C** switches between the chase camera and a **first-person cockpit** with live rev counter and speedometer needles, a steering wheel that turns 540-1080 degrees lock to lock, a gear lever that moves through the gate, pedals that go down and a gear display. A cockpit gauge (bottom right) shows speed, gear, rpm with a shift light, turbo boost (psi), the ECU stage and ABS / TCS lights. Fuel use, mileage, dirt and body damage. |
| **Passengers (Yolcu)** | Walk up to a car another player is driving and press **F** (or **E**): **Yolcu olarak bin**. You ride along in the front passenger seat or the back (a coupe takes one passenger, other cars three, motorcycles and the quad one on the back), seen sitting in the car by everyone, with the chase camera following the car and its engine sound. **F** gets you out on your side; when the driver gets out, the passengers get out too. The car has to be standing still to get in. |
| **Driving bonus** | Every 10 seconds of real driving pays a bonus scaled by the car's value ($50 for a $50k car, about $350 for a $300k G 63 or M8), shown as a small "+$150 (Driving Bonus)". |
| **Missions (Görevler)** | **L** opens the missions panel on the right: a daily set per player, for example 10 near misses without crashing ($2,500), hold 250 km/h for 5 s (a free Stage 1 ECU remap coupon), sell 2 cars within 120 s ($5,000 + 100 XP), plus extra daily goals. Rewards are paid automatically. |
| **Car theft (Araba çalma)** | A hidden **Black Market** tab in the Marketplace (and the Esc menu) sells the **Lockpick & Testere Seti** for $2,500 from a stock of 5 shared by the whole city that is full again every 10 real minutes (countdown on screen). Cars are parked at city kerbs and broken down (hazard lights on) on the highway shoulder: next to one, **Lockpick Et (E)** opens the lock mini-game: set the pick's angle (mouse, A/D, drag), turn it (W / Space / click); 3 picks (3 HAK); off the sweet spot the cylinder stops short, the pick strains and snaps, and the lock shows which way to go and how far (a green zone and an arrow on the dial). Three snapped picks lose the set, the car alarm wails and flashes and the police come at **2 stars**. An opened car is yours to drive (stolen: it can't be stored, sold or listed). Drive it to the **Sanayi / Izgara Garajı** south of the city (🔧 on the map), stop between a lift's posts and press **Aracı Lifte Kaldır (F)**: the car goes up. Walk to the glowing markers and strip the side mirrors, doors, steering wheel, seats and exhaust & catalytic converter; at the front the **engine bay** opens a diagram of the engine block, gearbox, turbo / supercharger, ECU, radiator, alternator and battery to click. Every part disappears from the car and goes into the inventory as a **Sökülmüş Parça**; the bare shell is scrapped. The **Pawn Shop** next door pays **$25,000 per car** (araç başı: all of a car's parts together; each part sells for its share) ("Parçalar Pawn Shop'a satıldı: +$25,000"). |
| **Telegram dealing** | The phone (**Y** / 📱): Telegram. Order **10 g for $500** from the supplier: you get a location and a picture of the car, its colour and the sticker in its rear window (🐺, 🦂, 🔥...). Walk up and get into the passenger seat (**E**): the camera goes into the cockpit, a **black bag (siyah poşet)** and the cash change hands, **DEAL COMPLETED**. Your own channel fills with customers' orders (10-20 g, $110-$170 a gram, paid as dirty money): deliver **by hand** (get into their car for the same handover) or through a **dead drop** (leave the package behind an alley dumpster, in the plaza planter, under the drag grandstand...; the customer collects it later and pays 80%). **15% of hand deliveries are undercover cops:** the driver pulls a badge, red and blue light fills the car, sirens, **3 stars at once**, and the package is seized. Busted with goods on you: the police take them. | 📦 / 🤝 / 📍 on the minimap; 📦 grams under the wallet; a dot on the phone for unread messages. |
| **Heists (Soygunlar)** | Seven targets, each robbed at a door: **GetRich Bankası** ($55k-$80k, 4★) and the new **Golden Palace Casino** on the far shore ($50k-$80k, 4★) behind steel-bollard forecourts, **Kuyumcu Altınsaray**, **Atlas Ofis Plaza**, **Mega Market 7/24** and **Emlak Dünyası** through their back doors in the bike-only alleys ($20k-$60k), and the **Hyper Garage car heist** (hack the showroom's immobilizer, drive the hypercar into the docks within 4 minutes). Walk up armed and press **E**: the alarm rings (spinning beacon, bell), the police know at once and their cars are 20-30 s away (**🚔 POLİS YOLDA 00:25** on the card), and a drill throws sparks or a laptop hacks away for 1-2 minutes while you (or your crew) stay at the door; step away to fight and the work stops. Police cars can't get past the bollards, officers come on foot; the doorway gives cover. Done: **ÇANTADA $72,600 · ŞİMDİ POLİSİ ATLAT!** Lose the police and the loot is yours as **dirty money (Kara para)**; busted, the police take it; wasted, it's gone. Dirty money can't be spent: launder it at **Emlak Dünyası** (🏢, the estate agent on the Chroma corner): buy legal businesses with clean money (Çamaşırhane, Berber, Oto Yıkama, Restoran, Sürücü Kursu, Gece Kulübü: $150k-$480k) and pay the dirty money in; **each business turns $100,000 of it into clean cash every 10 minutes** (it keeps going while you're offline). | 💰 bags on the minimap (flashing red while an alarm rings), 🏁 for the docks. |
| **Part-time mechanic (Tamirci)** | At the Sanayi, the **TAMİRCİ ARANIYOR** board by the office: **Tamirci Olarak Çalış (E)**. Customers' damaged cars come in one after another and go up on a free lift (four lifts now): the engine smokes, the bumper and a door hang off, the tyres are flat. Walk to each marker round the car and press **E**: **Motoru Onar**, **Kaportayı Düzelt**, **Lastikleri Değiştir** (a few seconds each; stay with it). All done: **TAMİR TAMAM, +$1,000** clean cash on the spot, the lift comes down and the next car comes in. | A card under the stars: whose car, the jobs ticked off, the work bar, the shift's takings. |
| **Police** | The chase is fair: pursuit cars have 60% of the interceptor's power and top speed (about 165 km/h), aim less far ahead of you, come back from further away (180 m behind you, only after losing you by 480 m or being stuck 9 s) and officers hit 40% softer. Near misses above 180 km/h, hitting traffic and **any gunshot** (heard even with nobody around: the nearest patrol is called to the scene, 2 stars) raise a **wanted level of 1-5 stars**. **Partners in crime:** everyone in the same car (driver and passengers) gets the same wanted level, whoever did it. From 2 stars police interceptors with flashing light bars and sirens chase you (real physics cars, along the highway lanes and through the city streets). **They only know where you are while they can see you:** each car looks ahead in a 150° cone out to 140 m, and buildings, walls, bridge piers and ramp embankments block the view (a strict line-of-sight check on the server). Out of their sight the blue **HIDDEN / GİZLENDİN - İZİNİ KAYBETTİRİYORSUN (00:45)** countdown runs; a glimpse doesn't stop it, only a police car keeping you in sight for 2 s starts it over (a yellow **👁 GÖRÜLÜYORSUN** meter warns you). Lost, the cars drive to where you were last seen and **search** the streets round it with **amber light bars**. They join the chase one by one and keep their distance from each other instead of driving in a bunch. Hidden for 45 s: **ESCAPED! +$2,000** (or $1,000 for every police car that chased you, when that is more), XP, and the wanted level is wiped clean. **Back alleys (bikes and ATVs only):** three narrow passages through the city blocks (behind Wrench Bros, behind the auction house, the Chroma passage) between old apartment rows, under zig-zag fire escapes and string lights, past dumpsters and graffiti, and behind Wrench Bros up a flight of steps to a raised courtyard and back down. Yellow-and-black steel bollards across both ends let a motorcycle or the ATV slip through but no car: dive in at 80-100 km/h with the police on your tail and the car right behind you smashes into the bollards (**🚧 Polis direğe çarptı!**) while the others race round to the far end. The alleys are orange dashed lines on the minimap. Stopped with a police car beside you for 3 s: **POLİSE YAKALANDIN! - $3,000 Ceza Ödendi** cutscene (the police car pulls up, hands up, handcuffs), always a **$3,000 fine** (cash first, then the bank), the car is towed to your garage and you walk out of the nearest garage. | **From 3 stars:** a **police helicopter** comes in overhead (rotor sound, flashing beacons, a white searchlight that follows you and lights the ground); walls don't hide you from it: 2 s in its searchlight starts the hidden countdown over, and it tells the cars where you are. Get under cover (under an overpass or a bridge, in the car-wash tunnel or the Sanayi hall) for 8 s and it loses you (**Helikopter seni kaybetti**); or shoot it down (300 HP, it spins, falls and explodes; a new one comes a minute later). The police also throw **spike strips** across the road ahead of you: the whole carriageway on the highway, the street in the city (blinking lamps, cones). Drive over one and the tyres burst (**LASTİKLER PATLADI!**): the car sits down on its rims, sparks fly from the rims, side grip is down 90% and it pulls away at about half pace until the tyres are replaced at Wrench Bros. |
| **Daily login & playtime rewards** | A **7-day login streak** (one box a day: $5,000; a Lockpick & Testere Seti; $15,000; a Stage 1 ECU coupon; $30,000; 3 sets + 3 Special Nitro; on **day 7 a free legendary car** from the Rare Dealer's pool + $50,000 + 10 VIP Coins). Missing a day starts the streak over from day 1. **Playtime rewards** for active play each day (keys, camera, menus or riding in a moving car; up to 3 hours): 15 min $2,500, 30 min a lockpick set, 1 h $15,000 + 200 XP, 2 h $35,000 + the purple **Plazma Neon** underglow, 3 h $100,000 + 5 VIP Coins + a choice of a **Pawn Shop +50%** coupon or a free **rims & paint** job. A gift box next to the wallet counts down to the next reward (**Sonraki Ödül: 04:52**), glows when one is ready and collects it with confetti and a cash-register fanfare; the panel opens by itself on the first visit of the day. Kept in the database, so a refresh or another device carries on where you left off. |
| **Nitro, air ride, plates** | **N** while driving fires a Special Nitro shot: 5 s of +60% torque past the speed limiter, blue flames from the exhausts for everyone, a NOS bar. The **Air Ride Suspension** part (Chroma Customs) lets **K** step the car down while driving: Normal, Alçak, Yerde (the body moves down gradually; everyone sees it). Every car has a Turkish-style **number plate** front and back; press your own text at Chroma Customs ($2,500). |
| **Selling cars, forged papers** | Marketplace **İlan Ver · Sell** tab: list your cars on the classifieds at your price, take them down again. A stolen car parked in the Sanayi yard can get **forged papers** at the Sanayi office (15% of its value) and becomes yours to keep or sell. |
| **CCTV & stolen-car tracking** | Ten **CCTV cameras** on junction corners turn back and forth and throw a red cone of light on the road (also on the minimap). Picking a lock, or driving a stolen car into a cone, starts **VEHICLE STOLEN - POLICE TRACKING (03:00)** with 2 stars; a camera or a police car seeing the car starts it over, and it waits while you are out of the car. Three minutes unseen: **CAR STOLEN SUCCESSFULLY! (Araç Tamamen Senindir)**, the car is yours. Arrested on the way: the car is seized. |
| **Street races** | Every 7 minutes an illegal race opens on one of three routes through the city (a flag and the route on the map, a chequered start gate with a pillar of light). Drive to the start line and press **G**; at the countdown everyone lines up on the grid (3-2-1-GO) against street racer bots. Yellow rings mark the checkpoints (green: the finish); the HUD shows position, checkpoint and time. The winner takes **$20,000**; a few seconds after the green light every racer is wanted (2 stars). |
| **Motorcycles & quad** | **Wheelie:** hold **Shift** (touch: the **WHEELIE** button) with the throttle open above 65 km/h and the front comes up; let go and it comes down, brake to drop it fast. Past the balance point it keeps going over: hold it too long and the bike flips and you come off. **Pillion:** a friend walks up to your stopped bike or quad and presses F (**Artçı olarak bin**) to ride on the back; they can draw a gun and shoot backwards and sideways while you ride, in first person over your shoulder. The rider can shoot too, with any gun (one hand on the bars), without getting off. **Exhausts** at the tuning garage: Akrapovič Full System (high, sharp race howl), Vance & Hines (loose bark), SC Project (deep bass boom), all with pops & bangs and blue and orange flames on downshifts and throttle lifts (car exhausts don't fit bikes). **Moto Gear** (beside the hospital) sells helmets: Full-Face Sport $1,200, Premium Full-Face (Shoei / Arai style) $3,500, Motocross $1,500, Custom Bubble Visor $2,500, visors Clear (free), Dark Tint $150, Iridium rainbow $400, Gold Mirror $600, in 7 colours. Riders wear their helmet on bikes and quads. **Crashes:** a flipped wheelie or a hard hit throws everyone off with sparks; without a helmet coming off at 60 km/h or more is **WASTED**, a helmet takes 60% off the damage. |
| **Guns & fights** | **Ammu-Nation** (east of the city): Pistol $5,000, Pump Shotgun $18,000, AK-47 / M4 $45,000 and ammo boxes; the premium Golden Desert Eagle, Laser-Guided RPG and Minigun only for **VIP Coins** (from the rewards; there is no real-money shop). **1-6** draws a gun and the view goes **first person**: no crosshair, you aim down the gun's own sights (iron sights, the rifle's aperture, the shotgun's bead, the RPG's optic). **Q** puts it away, left click fires. **Recoil:** the pistol kicks lightly up, the shotgun hard up and back, the AK / M4 and the minigun spray up and sideways and climb through a burst; the view settles back slowly. The server checks ammo and fire rate and traces every shot. Cars have body HP: glass breaks, the bumper and doors come off, grey then black smoke, and at zero the engine blows up (bullet holes, sparks, blood, fireballs). Pedestrians walk the sidewalks; shooting people is **3 stars** at once, the police 4, and from 3 stars **officers get out of their cars and shoot back**. Health bar with regeneration; at zero **WASTED**: you wake up at the **GetRich General Hospital** without lockpick sets, stripped parts or stolen cars. Other players and their cars take no damage (no PvP). |
| **Hitman contracts (Tetikçi)** | A narrow dead-end alley between Wrench Bros and the Parts Depot (not on the map) hides a man in black under a flickering bulb, between dumpsters and bin bags: **Görev Al (E)**. He hands out one job at a time, **$1,000 + 60 XP** each: a **drive-by** (put 6 bullets into a named venue's walls: sweep it from a vehicle - the driver, a passenger, the pillion, any gun - or get out and fire on foot; anyone who rode along still counts after getting out) or a **hit** (a corrupt VIP or a rival gang member walks the sidewalks inside a red search circle on the minimap; spot their clothes and the 🎯 label only you can see, and take them down). A card under the wanted stars shows the job, the distance (**ALANDASIN** once inside), the hit count and the clock (4-5 minutes). Everyone in the vehicle shares the job and its wanted stars. If someone else kills the mark or the clock runs out, the job is off. |
| **Shooting from vehicles** | Everyone in a vehicle can draw any gun (Pistol, Shotgun, AK-47 / M4, Deagle, RPG, Minigun) and shoot without getting out, in first person from their seat: car passengers out of the windows, the driver one-handed out of theirs, the pillion of a bike in any direction, the rider over the bars. |
| **Reputation unlocks** | Levels open more garage slots, more cars on the street at once, market discounts (up to 10%) and underglow neon kits (rainbow at level 15). |
| **Buying** | Browse, filter, sort and inspect listings; buy or negotiate with data-driven NPC seller personalities. You can also buy from other players. |
| **Repair / wash / fuel** | Per-part repairs with cost, time and a new-condition preview; parts kits; a dealership repair-bay discount; 2 wash tiers; refuelling. |
| **Tuning garage** | At Chroma Customs, with a live 3D preview (turntable, drag to rotate). **Performance:** ECU Stage 1/2/3 (+15/+30/+60% hp, +10/+20/+40% top speed), cold air intake, single/twin/twin-scroll/big turbo and supercharger kits, intercoolers (heat soak), forged pistons & rods, cams, injectors & HPFP, cat-back/Varex/downpipe/straight-pipe exhausts, sport springs and coilovers, semi-slick and slick tyres, big brake kit and carbon ceramics. Stages need their prerequisites (Stage 2: downpipe or straight pipe; Stage 3: turbo/supercharger, forged internals, fuel system), and missing ones are added for you. **Visual:** gloss, metallic, matte and chameleon (colour-shift) paint with presets or any HEX colour, front/rear bumpers, side skirts, carbon hood, ducktail/GT/swan-neck wings, BBS-, Rays- and Rotiform-style wheels in 7 finishes, camber and drop sliders, window tint, headlights and accessories. **Dyno:** hp and Nm curves against rpm (stock vs build), a live dyno pull with engine sound, heat-soak and wheelspin figures. Everything shows live on the car and in the stats (hp, Nm, 0-100, top speed, handling, braking, grip, resale value). |
| **Performance & sound** | Parts change the real driving physics (top speed, acceleration, braking, grip) on the server. Every model has real-world figures (hp, Nm, weight, 0-100, top speed, redline), shown on the speedometer too. The engine sound follows the build: exhaust tone, turbo whistle and blow-off valve, supercharger whine, intake roar, lumpy race cams, electric whine, and pops & bangs (with flames at the exhaust tips) on a throttle lift. Tuned engines wear faster unless you fit forged internals. |
| **Rare Dealer** | A Marketplace tab with 6 special offers that change every 120 seconds for everyone, with a visible countdown that survives reloads (server clock). Offer odds: common/uncommon 70%, rare/epic 25%, legendary 5% (weighted random). The legendary pool holds 10 real cars (BMW i7, M3 Competition, X7 M60i, 5 Series, F 900 GS motorcycle, M8 Competition, Mercedes-AMG GT, E-Class, G 63, Audi RS5), each showing up in at most 5% of rotations. Some offers come pre-tuned. Each offer can be bought once. |
| **Dealership** | Buy a plot, upgrade through 6 levels (each looks different), place and rotate vehicles on up to 12 display slots, and set prices. |
| **NPC customers** | Customers with 7 archetypes (budget, categories, condition and mileage limits, willingness, negotiation) walk into dealerships, buy or make offers, and also buy from the classifieds, even while you are offline. |
| **Economy** | Everything is set in `shared/economy.config.ts` (tuning parts in `shared/modificationsData.ts`). Values depend on category demand (volatile, mean-reverting), condition, mileage, rarity and mods. A full Stage 3 build is worth 150-200% of the stock car. Part prices scale with the car's value and always cost more than the value they add, so tuning pays off only through customers. Fees and taxes prevent arbitrage. |
| **Auctions** | Player and NPC consignments, escrowed bids, minimum increments, anti-sniping, NPC bidders and automatic settlement. |
| **Chat** | Global, nearby (45 m) and system messages, with rate limiting, mutes and duplicate suppression. |
| **UI** | HUD (money, bank, level/XP, reputation, minimap, prompts, speedometer, fuel), dock, and 17 panels, including a full map, settings and a profile with leaderboard and transaction history. |
| **Persistence** | PostgreSQL in production, with a SQLite fallback for local development. Every transaction is written atomically; positions and driving stats are autosaved. |
| **Audio** | Synthesized engine following the real rpm and gear changes, intake roar with an open air filter, turbo whistle and blow-off valve (with compressor flutter on Stage 2/3 builds), pops & bangs on upshifts and throttle lifts with a Varex or straight pipe, tyre screech, police sirens, rain, UI, purchase, notification and ambient city sounds. |

## Quick start (local)

Requirements: **Node.js 20.11+** (22 recommended) and npm. PostgreSQL is optional locally.

```bash
cd getrich-tycoon
npm install
npm run build        # builds the client (Vite) and the server bundle (esbuild)
npm start            # http://localhost:3000
```

Open <http://localhost:3000> in Chrome, create an account and play. Open a second browser window (or an
incognito window) with another account to see multiplayer.

### Development mode (hot reload)

```bash
npm run dev          # game server on :3000 (tsx watch) + Vite on :5173 (proxying /api and /socket.io)
```

Open <http://localhost:5173>.

### Using PostgreSQL locally

```bash
cp .env.example .env
# set DATABASE_URL=postgres://user:password@localhost:5432/getrich
npm start
```

The schema (`database/schema.sql`) is applied automatically on startup. When `DATABASE_URL` is empty the server uses
`./data/getrich.db` (SQLite) and logs a warning. That mode is for development only.

## Controls

| Key | Action |
| --- | --- |
| **W A S D** / arrows | Walk, or drive when in a vehicle |
| **Shift** | Sprint |
| **Space** | Handbrake (driving) |
| **Mouse** (click to lock) / right-drag | Camera |
| **E** | Interact (also enters / exits a vehicle); **Lockpick Et** next to a parked car; strip a part / open the engine bay at a car on a Sanayi lift |
| **F** | Get into the nearest own car / get out (animated); **Yolcu olarak bin** next to a car someone else is driving (and **Arabadan in** to get out); **Aracı Lifte Kaldır** with a stolen car between a Sanayi lift's posts |
| **G** | Use the fuel station or car wash while driving; open the drag strip at the staging lane; join a street race at its start line |
| **N** / **K** (driving) | Special Nitro / air ride height (K on foot: Auctions) |
| **P** (driving) | Plate flipper (Black Market gear): turn the number plate away so cameras can't read it, and back |
| **Shift** (on a motorcycle) | Wheelie (with the throttle, above 65 km/h); on foot: sprint |
| **1-6**, **Q**, left click | Draw a gun, put it away, fire |
| **C** | Chase camera / first-person cockpit |
| **L** | Missions panel |
| **H** | Horn and headlight flash (slower traffic ahead moves over) |
| **Enter** / **T** | Chat |
| **B** / **I** / **J** / **K** / **M** / **O** | Marketplace / Garage / Dealership / Auctions / Map / Profile |
| **Esc** | Close panel / game menu |
| Lockpick screen | Mouse / **A D** (Shift: fine) set the pick's angle; **W** / **Space** / click turns it; **Esc** gives up (the set is lost) |

**Touch screens (iPad, tablets, phones in landscape)** get on-screen controls automatically:

| Control | Action |
| --- | --- |
| Left stick | Walk or drive (push it all the way to run) |
| Drag on the right half of the screen (or anywhere on the 3D view) | Camera |
| **🔫** button | Draw a gun, switch to the next one, put it away |
| **WHEELIE** button (hold, on a motorcycle) | Lift the front wheel (with the stick pushed forward) |
| **ATEŞ ET** button (bottom right, with a gun drawn) | Fire (hold for automatic guns; slide the finger to aim while firing) |
| **E** button, or tap the prompt | Interact / enter / exit vehicle |
| **G** button | Fuel station, car wash or drag strip while driving |
| **CAM** button (while driving) | Chase camera / first-person cockpit |
| **HORN** button (hold, while driving) | Horn and headlight flash |
| **RUN** / **BRAKE** button (hold) | Sprint on foot, handbrake while driving |
| Bottom bar | Marketplace, Garage, Dealership, Auctions, Map, Profile, Chat, Menu |

`?touch=1` or `?touch=0` in the URL forces the touch controls on or off. `?hour=22` fixes the time of day and `?rain=1` the
weather (screenshots; the grip follows), `?cockpit=1` starts in the cockpit view, `?hq=0` ignores dropped-in custom models.

## Vehicle models

Every vehicle, highway truck, coach, semi and the police car is a `.glb` file; there are no built-in shapes in the code. The
default models (original, made for the game, about 3.4 MB in total with a simplified far-away copy each) are in
`client/public/assets/models/vehicles/`, and the registry is `client/src/data/highDetailVehicles.ts` (`modelUrl`, `lodUrl`,
`scale`, `rotationOffset`, `castShadow`, `receiveShadow`, `paintMaterials`, `nodes`, `interior`, `autoFit`, `credit`).

To use a real model of a car (for example a licensed BMW M3 G80 or Mercedes-AMG G 63):

1. Get a `.glb` whose licence allows use in your game (Sketchfab, CGTrader, TurboSquid...; CC BY needs a credit, many models are
   for personal use only, and car brands are trademarks). Draco compression is recommended:
   `npx @gltf-transform/cli optimize in.glb out.glb --compress draco --texture-compress webp`.
2. Put it in `client/public/assets/models/` named after the vehicle id, e.g. `bmw_m3_g80.glb` or `mercedes_g_class.glb` (the ids
   are in `shared/vehicles.ts` and `shared/specialVehicles.ts`). It replaces the default model automatically. Or point `modelUrl`
   of that vehicle at the file (a path under `client/public` or a full `https://` URL).
3. Rebuild (`npm run build`; Render does this on deploy).

Dropped-in models are fitted automatically: turned to face forward (`rotationOffset` if it comes in backwards or sideways), scaled
to the car's real length (`scale` fine-tunes), centred, and stood on its tyres so the wheels touch the road. Wheels named like
`wheel_fl` / `Wheel_FL` / "wheel front left" spin and steer; a `door_fl` node opens when you get in and out (`door_fr`,
`mirror_l` and `mirror_r` come off at the Sanayi); `seat_driver` puts the
cockpit camera at the driver's eyes; materials named "paint" (or listed in `paintMaterials`) take the car's colour. See the comment
at the top of `highDetailVehicles.ts` for the full naming convention. Distant highway traffic is drawn instanced from the same
models (the `.lod.glb` copies).

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Server + Vite dev servers |
| `npm run build` | Production build into `dist/` |
| `npm start` | Run the production server (`dist/server/index.js`) |
| `npm run typecheck` | Strict TypeScript checks (client, server, tests) |
| `npm test` | Unit + integration tests (Vitest; real sockets and a real database) |
| `npm run test:e2e` | Playwright tests in Chromium, including the two-client test (needs `npm run build` first) |
| `npm run test:all` | Everything above |
| `npm run check:secrets` | Scans tracked files for leaked credentials |
| `npm run db:reset -- --yes` | Wipe the configured database |

See [TESTING.md](TESTING.md) for details, including running the suites against PostgreSQL.

## Project structure

```
getrich-tycoon/
├── client/            Browser game (Vite + TypeScript + Three.js)
│   ├── index.html
│   └── src/
│       ├── game/      Game loop, prediction/reconciliation, input, camera, entity views
│       ├── render/    Renderer, procedural city, vehicles, characters, dealerships, effects
│       ├── ui/        HUD, chat, minimap, panels (marketplace, garage, dealership, ...)
│       ├── net/       HTTP auth + Socket.IO RPC client
│       ├── state/     Client mirror of server state
│       └── audio/     WebAudio synthesizer
├── server/            Node.js game server (Express + Socket.IO)
│   ├── game/          GameServer, simulation, state/unit-of-work, services/*
│   ├── db/            PostgreSQL + SQLite adapters, repository
│   └── http/          Express app (security headers, auth API, static files)
├── shared/            Types, economy config, vehicle catalog, world layout, physics, protocol
├── database/          schema.sql (portable PostgreSQL/SQLite)
├── scripts/           Build, dev, secret scan, DB reset
├── tests/             unit/, integration/ (Vitest), e2e/ (Playwright), helpers/
└── deploy/            Provider-specific config (Render blueprint)
```

## Environment variables

See [`.env.example`](.env.example). The important ones:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | 3000 | HTTP + WebSocket port (hosts usually inject this) |
| `DATABASE_URL` | *(empty)* | PostgreSQL connection string. Empty means local SQLite |
| `DATABASE_SSL` | false | `true` for managed Postgres that requires TLS when the URL has no `sslmode` (Supabase, ...) |
| `SQLITE_PATH` | ./data/getrich.db | SQLite file for local development |
| `CORS_ORIGINS` | *(empty)* | Only needed if the client is hosted on another origin |
| `TRUST_PROXY` | false (true on Render) | Set `true` only when the server is reachable exclusively through a reverse proxy (Northflank, Caddy). Render is detected automatically |
| `AUTH_RATE_PER_MINUTE` | 10 | Login/register attempts per IP per minute |
| `TICK_RATE` | 20 | Server simulation/snapshot rate (Hz) |
| `AUTOSAVE_SECONDS` | 30 | Position/driving autosave interval |
| `LOG_LEVEL` | info | debug / info / warn / error |
| `VITE_SERVER_URL` | *(empty)* | Build-time: game server URL if the client is hosted elsewhere |

## Documentation

- [ARCHITECTURE.md](ARCHITECTURE.md): how the client, server, multiplayer and database fit together
- [DEPLOYMENT.md](DEPLOYMENT.md): free hosting research and exact deployment steps
- [TESTING.md](TESTING.md): test suites and how to run them
- [ECONOMY.md](ECONOMY.md): the economy model and balancing
- [SECURITY.md](SECURITY.md): threat model and protections

## Known limitations

- **Single server instance.** The authoritative world state lives in one Node process, with write-through to the database.
  This fits a free-tier deployment and hundreds of concurrent players, but it does not scale horizontally
  (see ARCHITECTURE.md).
- **Physics is 2D.** Vehicles drive on a flat plane with real longitudinal physics and a simplified lateral (yaw / slip) model;
  there are no multi-level roads (the highway bridges are scenery), and players can walk through each other. Speeds are scaled
  to the small map (`SPEED_SCALE` 2.1); the speedometer and all figures are real km/h.
- **Traffic stays on the highway.** City streets have no ambient traffic, and highway traffic does not use the ramps.
- **The real cars ship with original stand-in models.** The loader and the drop-in folder are ready (see above), but no models of
  the real BMW / Mercedes / Audi cars are included, because they need a licence. A dropped-in model replaces the whole body, so
  body-kit parts only show on models that have them (named `kits > kit_*`), and aftermarket rims on models whose wheels are
  named.
- **Software rendering is slow.** Without a GPU (CI containers, some VMs) Chrome falls back to SwiftShader and the game runs at a
  few FPS. It still works, and the automated tests run that way, but real play needs hardware acceleration.
- **Free hosting sleeps.** The recommended free host spins the server down after ~15 minutes without traffic. The first visitor then
  waits about a minute. See DEPLOYMENT.md.
- **No real-money purchases.** Premium guns are bought with VIP Coins earned from the daily rewards; a real-money shop would
  need a payment provider and legal set-up.
- **No PvP.** Players can't hurt each other or each other's cars; shooting at them only brings the police.
- **Street racer bots follow the route** (ghost cars that don't collide); pedestrians walk the block sidewalks.
- **Accounts are name + password only.** There is no e-mail, so a forgotten password cannot be recovered.
