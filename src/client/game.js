// Game orchestration: renderer, world streaming, session (local or online), player,
// zombie/vehicle/player views, interactions, events, lighting, audio, HUD and saves.
import * as THREE from 'three';
import { Materials } from './materials.js';
import { WorldView } from './worldView.js';
import { Sky } from './sky.js';
import { Effects } from './effects.js';
import { Hud } from './hud.js';
import { Player } from './player.js';
import { Missions } from './missions.js';
import { Character, humanGeometry, ZOMBIE_LOOKS, SURVIVOR_LOOKS } from './rig.js';
import { vehicleGeometry, wheelGeometry, CAR_SPECS } from './models.js';
import { ITEMS } from '../shared/items.js';
import { VTYPES, updateVehicleCollider } from '../shared/vehicle.js';
import { districtName } from '../shared/world.js';
import { ceilingAt } from '../shared/physics.js';
import { mulberry32, angleDiff, hash2 } from '../shared/util.js';
import { ZTYPES } from '../shared/sim.js';
import { loadModel, instantiate, loadWeapon } from './assets.js';

const VCOLORS = { sedan: [0x7a1a14, 0x2a3a5a, 0x5a5a60, 0x1a1a1a], pickup: [0x2a4a6a, 0x6a5a3a, 0x8a2a1a], police: [0xe8e8e8], van: [0xd8d4c8, 0x8a8a7a] };
const LIGHT_T = {
  street: { c: 0xffc880, i: 30, d: 24, night: true }, flood: { c: 0xe8f0ff, i: 70, d: 34, night: true }, fluoro: { c: 0xdfefff, i: 7, d: 10 },
  porch: { c: 0xffb070, i: 6, d: 8, night: true }, canopy: { c: 0xe8f4ff, i: 12, d: 13 }, emergency: { c: 0xff2020, i: 10, d: 14 },
  beacon: { c: 0xff3030, i: 6, d: 10 }, room: { c: 0xffc890, i: 4, d: 7 },
};

export class Game {
  constructor(canvas, settings, audio, input) {
    this.canvas = canvas; this.settings = settings; this.audio = audio; this.input = input;
    const gfx = settings.gfx;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: gfx.antialias, powerPreference: 'high-performance', stencil: false });
    const r = this.renderer;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.15;
    r.shadowMap.enabled = gfx.shadows;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.autoClear = false;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(settings.fov, 1, 0.1, 900);
    this.scene.add(this.camera);
    this.adapt = 1; this.ft = []; this.fps = 60; this._fpsAcc = 0; this._fpsN = 0;
    this.paused = false; this.running = false;
    this.hud = new Hud(this);
    this.stats = { kills: 0, driven: 0, refuels: 0, shots: 0 };
    this.zoneName = 'Street';
    this.renderInfo = '';
    this.resize = this.resize.bind(this);
    addEventListener('resize', this.resize);
    if (window.visualViewport) visualViewport.addEventListener('resize', this.resize);
    addEventListener('orientationchange', () => setTimeout(this.resize, 250));
    this.resize();
  }

  resize() {
    const w = window.visualViewport ? visualViewport.width : innerWidth, h = window.visualViewport ? visualViewport.height : innerHeight;
    const gfx = this.settings.gfx;
    const pr = Math.min(devicePixelRatio || 1, gfx.maxPixelRatio) * gfx.pixelRatio * this.settings.renderScale * this.adapt;
    this.renderer.setPixelRatio(Math.max(0.4, pr));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
    if (this.player) { this.player.vm.cam.aspect = w / h; this.player.vm.cam.updateProjectionMatrix(); }
    if (this.composer) { this.composer.setSize(w, h); this.composer.setPixelRatio(this.renderer.getPixelRatio()); }
  }

  // ------------------------------------------------------------------ setup
  async init(W, session, progress) {
    this.W = W; this.session = session;
    const gfx = this.settings.gfx;
    progress(0.35, 'Painting textures');
    await tick();
    this.mats = new Materials(gfx.texQ, Math.min(8, this.renderer.capabilities.getMaxAnisotropy()));
    for (const k of ['asphalt', 'sidewalk', 'concrete', 'brick', 'plaster', 'wallInt', 'tile', 'glass', 'solid', 'dirt', 'grass', 'wood']) this.mats.get(k);
    this.charMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    progress(0.45, 'Lighting the sky');
    await tick();
    this.sky = new Sky(this.scene, this.settings);
    this.effects = new Effects(this.scene, this.mats, this.settings);
    this.world = new WorldView(this.scene, W, this.mats, this.settings);
    this.hud.buildMap();
    progress(0.55, 'Spawning the dead');
    await tick();
    // character geometry variants
    const rnd = mulberry32(7);
    this.zgeo = ZOMBIE_LOOKS.map(l => humanGeometry({ ...l, zombie: true, rand: rnd }));
    this.bgeo = [humanGeometry({ ...ZOMBIE_LOOKS[6], zombie: true, rand: rnd, bulk: 1.35 }), humanGeometry({ ...ZOMBIE_LOOKS[1], zombie: true, rand: rnd, bulk: 1.4 })];
    this.sgeo = SURVIVOR_LOOKS.map(l => humanGeometry(l));
    this.zviews = new Map(); this.pviews = new Map(); this.vviews = new Map(); this.kviews = new Map();
    this.missions = new Missions(this);
    this.player = new Player(this);
    this.resize();
    // user-supplied models (fall back to procedural ones if missing)
    loadModel('pickup').then((m) => {
      if (!m) return;
      this.hilux = m;
      for (const [id, vv] of this.vviews) if (vv.type === 'pickup') { this.scene.remove(vv.group); this.vviews.delete(id); }
    });
    for (const w of ['pistol', 'm4']) loadWeapon(w, this.settings.gfx.texQ).then((h) => {
      if (h && this.player.inv.equipped === w) { this.player.vm.setWeapon(w); this.player._attachTPWeapon(w); }
    });
    // light pool
    this.pool = [];
    for (let i = 0; i < gfx.lights; i++) { const l = new THREE.PointLight(0xffffff, 0, 10, 2); this.scene.add(l); this.pool.push({ l, spot: null, want: 0 }); }
    this.poolT = 0;
    // headlights for the vehicle we drive
    this.headlight = new THREE.SpotLight(0xfff4e0, 0, 45, 0.55, 0.5, 1.2);
    this.scene.add(this.headlight); this.scene.add(this.headlight.target);
    if (gfx.bloom) await this.setupBloom();
    this.input.enabled = true;
  }

  async setupBloom() {
    try {
      const [{ EffectComposer }, { RenderPass }, { UnrealBloomPass }, { OutputPass }] = await Promise.all([
        import('three/addons/postprocessing/EffectComposer.js'), import('three/addons/postprocessing/RenderPass.js'),
        import('three/addons/postprocessing/UnrealBloomPass.js'), import('three/addons/postprocessing/OutputPass.js')]);
      const size = this.renderer.getSize(new THREE.Vector2());
      this.composer = new EffectComposer(this.renderer);
      this.composer.addPass(new RenderPass(this.scene, this.camera));
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.5, 0.82);
      this.composer.addPass(this.bloom);
      this.composer.addPass(new OutputPass());
      this.composer.setPixelRatio(this.renderer.getPixelRatio());
      this.composer.setSize(size.x, size.y);
    } catch (e) { console.warn('Bloom unavailable', e); this.composer = null; }
  }

  // spawn the local player (new game or loaded state)
  begin(save, mpSave) {
    const p = this.player, W = this.W, s = this.session;
    const st = W.pois.start;
    p.spawn(st.x, 0, st.z, 0);
    if (save) this.applySave(save);
    else if (mpSave) this.applyMpSave(mpSave);
    else {
      p.inv.add('crowbar', 1); p.inv.add('bandage', 1); p.inv.add('water', 1); p.inv.add('chips', 1);
      p.equip('crowbar');
    }
    p.vm.setWeapon(p.inv.equipped); p._attachTPWeapon(p.inv.equipped);
    p.inv.onChange = () => { this.hud.weapon(p); if (this.panel === 'inv') this.hud.renderInventory(this.invSel || 0); };
    s.join(this.settings.name || 'Survivor', { x: p.body.x, y: p.body.y, z: p.body.z });
    this.world.loadNowAround(p.body.x, p.body.z, 60);
    this.hud.weapon(p);
    this.hud.show(true);
    this.running = true;
    this.last = performance.now();
    this.saveT = 60;
    this.sendT = 0;
    if (!save) setTimeout(() => { this.hud.toast('Police Station safehouse — Quarantine Zone 4', true); }, 600);
    this.renderer.setAnimationLoop((t) => this.frame(t));
  }

  vehicle(id) { return this.session.view.vehicles[id]; }
  vtype(v) { return VTYPES[v.type] || VTYPES.sedan; }
  inSafe() { const p = this.player.body; for (const z of this.W.zones) if (z.kind === 'safe' && p.x > z.x0 && p.x < z.x1 && p.z > z.z0 && p.z < z.z1) return true; return false; }
  surfaceAt(x, z, y) {
    if (this.indoor) return y > 0.5 ? 'hard' : 'hard';
    const i = Math.floor((x - 16) / 72), j = Math.floor((z - 16) / 72);
    const lx = x - 16 - i * 72, lz = z - 16 - j * 72;
    const cell = this.W.cells.find(c => c.i === i && c.j === j);
    if (cell && lx > 0 && lz > 0 && lx < 56 && lz < 56 && ['park', 'house', 'apt'].includes(cell.type)) return 'soft';
    return 'hard';
  }

  // ------------------------------------------------------------------ main loop
  frame(now) {
    let dt = (now - this.last) / 1000;
    this.last = now;
    if (!(dt > 0)) dt = 0.016;
    dt = Math.min(dt, 0.05);
    this._fpsAcc += dt; this._fpsN++;
    if (this._fpsAcc > 0.5) { this.fps = Math.round(this._fpsN / this._fpsAcc); this.adaptive(this._fpsAcc / this._fpsN); this._fpsAcc = 0; this._fpsN = 0; }
    const inp = this.input, p = this.player;
    const simPaused = this.paused && !this.session.mp;
    // global hotkeys
    if (inp.pressed('pause')) { if (this.panel) this.closePanels(); else this.pause(true); }
    if (!this.paused && !this.panel) {
      if (inp.pressed('inv')) this.openPanel('inv');
      if (inp.pressed('map')) this.openPanel('map');
      if (inp.pressed('cam') && p.veh === null) p.setThirdPerson(!p.tp);
      if (inp.pressed('light') && p.veh === null) p.toggleLight();
      if (inp.pressed('heal')) this.quickHeal();
      if (inp.pressed('interact')) this.interact();
      const [dx, dy] = inp.takeLook();
      p.look(dx, dy);
      p.update(dt, inp);
    } else { inp.takeLook(); if (!simPaused) p.update(0, { move: () => ({ x: 0, y: 0, mag: 0 }), pressed: () => false, down: () => false, sprinting: () => false }); }
    if (!simPaused) {
      // network / sim
      this.sendT -= dt;
      if (this.sendT <= 0) {
        this.sendT = this.session.mp ? 1 / 15 : 0;
        const w = p.inv.equipped;
        this.session.sendState({ x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.facing, pitch: p.pitch, crouch: p.crouch, sprint: !!p.sprinting, light: p.light, veh: p.veh === null ? -1 : p.veh, hp: p.hp, weapon: w, anim: 0 });
      }
      const evs = this.session.step(dt);
      for (const e of evs) this.onEvent(e);
      this.missions.update(dt);
      if (p.veh !== null) this.stats.driven = p.distDriven + (this.stats.drivenBase || 0);
    }
    this.syncZombies(dt);
    this.syncPlayers(dt);
    this.syncVehicles(dt);
    this.syncPickups(dt);
    const cam = this.camera;
    this.world.update(dt, p.body.x, p.body.z, cam.position);
    // environment
    this._envT = (this._envT || 0) - dt;
    if (this._envT <= 0) {
      this._envT = 0.4;
      this.zoneName = districtName(p.body.x, p.body.z);
      this.indoor = ceilingAt(this.W.cs, p.body.x, p.body.z, p.body.y + 1.9, 0.2) < p.body.y + 12 && p.veh === null;
    }
    const v = this.session.view;
    const rain = v.rain || 0;
    this.sky.update(dt, this.session.time, rain, p.body, cam.position, this.settings.brightness, this.indoor);
    this.darkness = this.sky.darkness;
    this.world.setNight(this.darkness);
    this.mats.setWet(rain);
    if (rain > 0.7 && Math.random() < dt * 0.04) { this.sky.lightning(); setTimeout(() => this.audio.thunder(), 600 + Math.random() * 2000); }
    this.updateLights(dt);
    this.effects.update(dt, cam, rain);
    this.audio.setListener(cam);
    this.audio.update(dt, { rain, indoor: this.indoor, pos: p.body, hp: p.hp, dead: p.dead });
    this.focus = this.paused || this.panel ? null : this.findFocus();
    this.hud.prompt(this.focus ? this.focus.label : '');
    this.hud.mission(this.missions.current());
    this.hud.update(dt, this.fps);
    const touchEl = document.getElementById('touch');
    touchEl.classList.toggle('driving', p.veh !== null);
    // render
    this.camera.fov += (this.settings.fov + (p.sprinting ? 6 : 0) - this.camera.fov) * Math.min(1, dt * 6);
    this.camera.updateProjectionMatrix();
    const r = this.renderer;
    r.autoClear = true;
    if (this.composer) this.composer.render(dt); else r.render(this.scene, this.camera);
    const info = r.info.render;
    this.renderInfo = `${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris · ${(r.getPixelRatio()).toFixed(2)}x`;
    if (p.vm.group.visible) {
      const vm = p.vm;
      vm.cam.fov = 62; vm.cam.aspect = this.camera.aspect; vm.cam.updateProjectionMatrix();
      r.autoClear = false;
      r.clearDepth();
      r.render(vm.scene, vm.cam);
    }
    if (!this.paused || this.session.mp) { this.saveT -= dt; if (this.saveT <= 0) { this.saveT = this.session.mp ? 60 : 90; this.autosave(); } }
  }

  adaptive(avg) {
    if (!this.settings.adaptive) { if (this.adapt !== 1) { this.adapt = 1; this.resize(); } return; }
    const prev = this.adapt;
    if (avg > 1 / 40) this.adapt = Math.max(0.55, this.adapt - 0.08);
    else if (avg < 1 / 57 && this.adapt < 1) this.adapt = Math.min(1, this.adapt + 0.04);
    if (prev !== this.adapt) this.resize();
  }

  // ------------------------------------------------------------------ views
  syncZombies(dt) {
    const camP = this.camera.position, draw = this.settings.gfx.drawDist * 0.75;
    const seen = new Set();
    for (const z of this.session.view.zombies) {
      const d = Math.hypot(z.x - camP.x, z.z - camP.z);
      if (d > draw) continue;
      seen.add(z.id);
      let v = this.zviews.get(z.id);
      if (!v) {
        const seed = z.seed || z.id;
        const geo = z.type === 'brute' ? this.bgeo[seed % this.bgeo.length] : this.zgeo[seed % this.zgeo.length];
        const ch = new Character(geo, this.charMat, ZTYPES[z.type].scale);
        ch.root.rotation.y = z.yaw;
        this.scene.add(ch.root);
        v = { ch, yaw: z.yaw, deadInit: false, deadT: 0, animSkip: 0 };
        this.zviews.set(z.id, v);
      }
      const ch = v.ch;
      v.yaw += angleDiff(v.yaw, z.yaw) * Math.min(1, dt * 10);
      ch.root.position.set(z.x, z.y, z.z);
      ch.root.rotation.y = v.yaw;
      if (z.dead) {
        if (!v.deadInit) { v.deadInit = true; ch.fallDir = Math.cos((z.fall || 0) - z.yaw) > 0 ? -1 : 1; }
        v.deadT += dt;
        if (v.deadT > 25) ch.root.position.y -= Math.min(1, (v.deadT - 25) * 0.04);
      }
      // cheaper animation at distance
      v.animSkip += dt;
      const every = d < 25 ? 0 : d < 50 ? 1 / 30 : 1 / 15;
      if (v.animSkip >= every) { ch.animZombie(v.animSkip, { state: z.state, speed: z.speed, atk: z.atk, hitT: z.hitT, dead: z.dead }); v.animSkip = 0; }
    }
    for (const [id, v] of this.zviews) if (!seen.has(id)) { this.scene.remove(v.ch.root); this.zviews.delete(id); }
  }

  syncPlayers(dt) {
    if (!this.session.mp) return;
    const seen = new Set();
    for (const o of this.session.view.players.values()) {
      if (o.id === this.session.id) continue;
      seen.add(o.id);
      let v = this.pviews.get(o.id);
      if (!v) {
        const ch = new Character(this.sgeo[(hash2(o.id.length, o.id.charCodeAt(0)) * 4) | 0], this.charMat);
        ch.root.add(nameTag(o.name));
        this.scene.add(ch.root);
        const flash = new THREE.SpotLight(0xfff2d8, 0, 26, 0.42, 0.55, 1.4);
        this.scene.add(flash); this.scene.add(flash.target);
        v = { ch, flash, wpn: null, wid: null, lx: o.x, lz: o.z };
        this.pviews.set(o.id, v);
      }
      const ch = v.ch;
      ch.root.visible = o.veh < 0;
      ch.root.position.set(o.x, o.y, o.z);
      ch.root.rotation.y = o.yaw;
      const sp = Math.hypot(o.x - v.lx, o.z - v.lz) / Math.max(dt, 0.001);
      v.lx = o.x; v.lz = o.z;
      if (v.wid !== o.weapon) {
        if (v.wpn) ch.b.handR.remove(v.wpn);
        v.wpn = this.player.vm.makeWeapon(o.weapon, true);
        if (v.wpn) { v.wpn.rotation.x = -Math.PI / 2; ch.b.handR.add(v.wpn); }
        v.wid = o.weapon;
      }
      const w = ITEMS[o.weapon];
      ch.animHuman(dt, { speed: Math.min(7, sp), crouch: o.crouch, weapon: w && w.type === 'gun' ? 'gun' : w && o.weapon !== 'fists' ? 'melee' : 'none', pitch: o.pitch, dead: !o.alive });
      v.flash.intensity = o.light && o.veh < 0 ? 30 : 0;
      v.flash.position.set(o.x, o.y + 1.5, o.z);
      v.flash.target.position.set(o.x + Math.sin(o.yaw) * 10, o.y + 1.5 + Math.sin(o.pitch) * 10, o.z + Math.cos(o.yaw) * 10);
    }
    for (const [id, v] of this.pviews) if (!seen.has(id)) { this.scene.remove(v.ch.root); this.scene.remove(v.flash); this.pviews.delete(id); }
  }

  syncVehicles(dt) {
    const p = this.player;
    for (const v of this.session.view.vehicles) {
      if (!v) continue;
      let vv = this.vviews.get(v.id);
      if (!vv) vv = this.makeVehicleView(v);
      if (this.session.mp && v.col && v.driver !== this.session.id) { updateVehicleCollider(v); v.col.en = v.driver === null || v.driver === undefined; }
      const g = vv.group;
      g.position.set(v.x, v.y || 0, v.z);
      g.rotation.set(0, v.yaw, 0);
      vv.body.rotation.set(v.pitch || 0, 0, v.roll || 0);
      const spec = vv.spec;
      vv.wheels.forEach((w, i) => { w.rotation.x = v.wheel || 0; if (i < 2) w.parent.rotation.y = v.steer || 0; });
      vv.tail.material.emissiveIntensity = v.brake ? 3 : v.lights ? 0.8 : 0.05;
      vv.head.material.emissiveIntensity = v.lights ? 3 : 0.02;
      if (vv.bar) { const t = performance.now() * 0.008; vv.bar[0].material.emissiveIntensity = v.driver !== null && v.driver !== undefined && Math.sin(t) > 0 ? 4 : 0.1; vv.bar[1].material.emissiveIntensity = v.driver !== null && v.driver !== undefined && Math.sin(t) <= 0 ? 4 : 0.1; }
      const mine = p.veh === v.id;
      if (!mine && v.driver !== null && v.driver !== undefined && this.session.mp) this.audio.engine('r' + v.id, true, v.rpm || 0.2, v.x, 1, v.z, false);
      else if (!mine) this.audio.engine('r' + v.id, false);
      void spec;
    }
    // our headlights
    const v = p.veh !== null ? this.vehicle(p.veh) : null;
    if (v && v.lights) {
      const fx = Math.sin(v.yaw), fz = Math.cos(v.yaw), hl = this.vtype(v).hl;
      this.headlight.intensity = 90;
      this.headlight.position.set(v.x + fx * (hl + 0.1), 0.9, v.z + fz * (hl + 0.1));
      this.headlight.target.position.set(v.x + fx * 20, 0, v.z + fz * 20);
    } else this.headlight.intensity = 0;
  }

  makeVehicleView(v) {
    const kind = v.type === 'sedan' ? 'sedan' : v.type;
    const spec = CAR_SPECS[kind];
    const cols = VCOLORS[v.type] || VCOLORS.sedan;
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.5, color: cols[v.id % cols.length] });
    const group = new THREE.Group(), body = new THREE.Group();
    group.add(body);
    const shadows = this.settings.gfx.shadows;
    const useModel = v.type === 'pickup' && this.hilux;
    if (useModel) body.add(instantiate(this.hilux).holder);
    else {
      const bm = new THREE.Mesh(vehicleGeometry(kind, { wheels: false }), mat);
      bm.castShadow = shadows; bm.receiveShadow = shadows;
      body.add(bm);
    }
    if (v.type === 'police') { const stripe = new THREE.Mesh(new THREE.BoxGeometry(spec.w + 0.02, 0.18, 2.2), new THREE.MeshStandardMaterial({ color: 0x101820 })); stripe.position.set(0, 0.62, 0.1); body.add(stripe); }
    const wg = wheelGeometry(kind), wm = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8 });
    const wn = new THREE.Mesh(wg, wm);
    void wn;
    const wheels = [];
    for (const [zz, sd] of useModel ? [] : [[spec.wheelZ, -1], [spec.wheelZ, 1], [-spec.wheelZ, -1], [-spec.wheelZ, 1]]) {
      const piv = new THREE.Group(); piv.position.set(sd * (spec.w / 2 - 0.14), spec.wheelR, zz);
      const m = new THREE.Mesh(wg, wm); m.castShadow = shadows;
      piv.add(m); group.add(piv); wheels.push(m);
    }
    const hl = new THREE.MeshStandardMaterial({ color: 0x111111, emissive: 0xfff2d0, emissiveIntensity: 0 });
    const tl = new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010, emissiveIntensity: 0 });
    const y1 = spec.bodyH[1];
    for (const sd of [-1, 1]) {
      if (useModel) break;
      const h = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.11, 0.03), hl); h.position.set(sd * (spec.w / 2 - 0.3), y1 - 0.15, spec.l / 2 + 0.005); body.add(h);
      const t = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.11, 0.03), tl); t.position.set(sd * (spec.w / 2 - 0.25), y1 - 0.12, -spec.l / 2 - 0.005); body.add(t);
    }
    let bar = null;
    if (spec.bar) {
      const r = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0x220000, emissive: 0xff1010 }));
      const b = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.1, 0.22), new THREE.MeshStandardMaterial({ color: 0x000022, emissive: 0x1030ff }));
      r.position.set(0.28, spec.cab[1] + 0.14, (spec.cab[4] + spec.cab[5]) / 2); b.position.set(-0.28, spec.cab[1] + 0.14, (spec.cab[4] + spec.cab[5]) / 2);
      body.add(r); body.add(b); bar = [r, b];
    }
    this.scene.add(group);
    if (this.session.mp && !v.col) { v.col = { x0: 0, y0: 0, z0: 0, x1: 0, y1: 1.5, z1: 0, en: true, veh: v.id }; updateVehicleCollider(v); this.W.cs.dyn.push(v.col); for (const k of ['vx', 'vz', 'pitch', 'roll', 'wheel', 'rpm', 'steer']) if (v[k] === undefined) v[k] = 0; if (v.hp === undefined) v.hp = 100; }
    const vv = { group, body, wheels, head: { material: hl }, tail: { material: tl }, bar, spec, type: v.type };
    this.vviews.set(v.id, vv);
    return vv;
  }

  syncPickups(dt) {
    const pk = this.session.view.pickups;
    for (const [id, p] of pk) {
      let m = this.kviews.get(id);
      if (!m) {
        const d = ITEMS[p.item];
        const col = { gun: 0x3a3c40, melee: 0x8a6a4a, ammo: 0xc8a040, heal: 0xe8e8e8, food: 0xc87a3a, drink: 0x4a8ac8, fuel: 0xc82a1a, battery: 0x3a8a3a }[d.type] || 0x8a8a8a;
        m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.18, 0.22), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.25, roughness: 0.6 }));
        m.castShadow = true;
        this.scene.add(m); this.kviews.set(id, m);
      }
      m.position.set(p.x, p.y + 0.15 + Math.sin(performance.now() * 0.003 + id) * 0.04, p.z);
      m.rotation.y += dt;
    }
    for (const [id, m] of this.kviews) if (!pk.has(id)) { this.scene.remove(m); m.geometry.dispose(); m.material.dispose(); this.kviews.delete(id); }
  }

  updateLights(dt) {
    const p = this.camera.position, dark = this.darkness || 0;
    this.poolT -= dt;
    if (this.poolT <= 0) {
      this.poolT = 0.25;
      const spots = this.world.lightsNear(p.x, p.z, 55);
      const chosen = [];
      for (const [, s] of spots) {
        const t = LIGHT_T[s.type] || LIGHT_T.room;
        if (t.night && dark < 0.15) continue;
        const h = hash2(Math.floor(s.x * 3), Math.floor(s.z * 3));
        if ((s.type === 'fluoro' || s.type === 'room') && h < 0.45) continue; // dead bulbs
        chosen.push(s);
        if (chosen.length >= this.pool.length) break;
      }
      // keep lights that are still wanted on the same slot
      const free = this.pool.filter(pl => !pl.spot || !chosen.includes(pl.spot));
      for (const pl of this.pool) if (pl.spot && !chosen.includes(pl.spot)) pl.spot = null;
      for (const s of chosen) {
        if (this.pool.some(pl => pl.spot === s)) continue;
        const pl = free.shift(); if (!pl) break;
        pl.spot = s; const t = LIGHT_T[s.type] || LIGHT_T.room;
        pl.l.color.setHex(t.c); pl.l.distance = t.d; pl.l.position.set(s.x, s.y, s.z); pl.l.intensity = 0;
      }
    }
    const tm = performance.now() / 1000;
    for (const pl of this.pool) {
      let want = 0;
      if (pl.spot) {
        const t = LIGHT_T[pl.spot.type] || LIGHT_T.room;
        want = t.i * (t.night ? Math.min(1, dark * 1.3) : 0.4 + 0.6 * dark);
        const h = hash2(Math.floor(pl.spot.x * 7), Math.floor(pl.spot.z * 7));
        if (pl.spot.type === 'fluoro' && h < 0.3) want *= Math.sin(tm * 23 + h * 50) > 0.6 ? 0.1 : 1; // flicker
        if (pl.spot.type === 'emergency') want *= 0.5 + 0.5 * Math.sin(tm * 6 + h * 9);
        if (pl.spot.type === 'beacon') want *= Math.sin(tm * 3) > 0.7 ? 1 : 0;
        if (pl.spot.type === 'street' && h < 0.15) want *= Math.random() < 0.08 ? 0.2 : 1;
      }
      pl.l.intensity += (want - pl.l.intensity) * Math.min(1, dt * 10);
      pl.l.visible = pl.l.intensity > 0.05;
    }
  }

  // ------------------------------------------------------------------ interactions
  findFocus() {
    const p = this.player, W = this.W, v = this.session.view;
    if (p.dead) return null;
    if (p.veh !== null) return { label: 'Exit vehicle', act: () => this.session.vexit() };
    const eye = this.camera.position, f = p.forward;
    const ex = p.body.x, ey = p.body.y + p.eye, ez = p.body.z;
    let best = null, bestS = Infinity;
    const consider = (x, y, z, r, mk) => {
      const dx = x - ex, dy = y - ey, dz = z - ez, d = Math.hypot(dx, dy, dz);
      if (d > r) return;
      const dot = (dx * f.x + dy * f.y + dz * f.z) / Math.max(d, 0.01);
      if (dot < 0.45 && d > 1.0) return;
      const s = d * (1.6 - dot);
      if (s < bestS) { bestS = s; best = mk; }
    };
    void eye;
    for (const d of W.doors) {
      if (Math.abs(d.x - ex) > 4 || Math.abs(d.z - ez) > 4) continue;
      const cx = d.x + d.dx * d.w / 2, cz = d.z + d.dz * d.w / 2;
      consider(cx, d.y0 + 1.2, cz, 2.4, { label: d.open ? 'Close door' : 'Open door', act: () => this.session.door(d.id) });
    }
    for (const c of W.containers) {
      if (Math.abs(c.x - ex) > 3 || Math.abs(c.z - ez) > 3) continue;
      const items = this.session.contItems(c.id);
      const empty = items && !items.length;
      consider(c.x, c.y, c.z, 2.3, { label: empty ? `${c.name} (empty)` : `Search ${c.name.toLowerCase()}`, act: () => { this.pendingLoot = c.id; this.session.open(c.id); } });
    }
    for (const it of v.pickups.values()) {
      const d = ITEMS[it.item];
      consider(it.x, it.y + 0.2, it.z, 2.3, { label: `Pick up ${d.name}${it.n > 1 ? ' ×' + it.n : ''}`, act: () => this.session.pick(it.id) });
    }
    for (const it of W.interacts) {
      if (Math.abs(it.x - ex) > 4 || Math.abs(it.z - ez) > 4) continue;
      if (it.type === 'bed') consider(it.x, it.y, it.z, 2.5, { label: this.session.mp ? 'Rest & save progress' : 'Sleep until morning & save', act: () => this.sleep() });
      if (it.type === 'radio') consider(it.x, it.y, it.z, 2.3, { label: 'Use emergency radio', act: () => this.useRadio() });
      if (it.type === 'pump') consider(it.x, it.y, it.z, 2.4, { label: 'Use fuel pump (refuels a car within 7 m)', act: () => this.session.pump(it.id) });
    }
    for (const veh of v.vehicles) {
      if (!veh || (veh.driver !== null && veh.driver !== undefined)) continue;
      const t = this.vtype(veh);
      const d = Math.hypot(veh.x - ex, veh.z - ez);
      if (d > t.hl + 1.6) continue;
      const s = (d - t.hl) + 0.5;
      if (s < bestS) { bestS = s; best = { label: `Drive ${t.name} · fuel ${Math.round(veh.fuel / t.tank * 100)}%${veh.hp <= 0 ? ' (wrecked)' : ''}`, act: () => this.session.venter(veh.id) }; }
    }
    return best;
  }
  interact() { if (this.focus) { this.focus.act(); this.audio.ui(); } }

  useItem(id) {
    const d = ITEMS[id], p = this.player;
    if (!d || !p.inv.has(id) || p.useT > 0) return;
    if (d.type === 'fuel' && !this.nearestVehicle(7)) { this.hud.toast('Stand next to a vehicle to pour fuel'); return; }
    if (d.type === 'battery' && p.battery >= 99) { this.hud.toast('Flashlight is already charged'); return; }
    if (d.type === 'heal' && p.hp >= 100 && !(d.stopBleed && p.bleed > 0) && !(d.cure && p.infection > 0)) { this.hud.toast('You are not hurt'); return; }
    p.useT = d.useTime; p.useTotal = d.useTime; p.useItem = id;
  }
  finishUse(id) {
    const d = ITEMS[id], p = this.player;
    if (!d || !p.inv.has(id)) return;
    if (d.type === 'heal') { p.hp = Math.min(100, p.hp + d.heal); if (d.stopBleed) p.bleed = 0; if (d.cure) p.infection = 0; if (d.stamina) p.stamina = Math.min(100, p.stamina + d.stamina); }
    if (d.type === 'food' || d.type === 'drink') { p.hunger = Math.min(100, p.hunger + (d.hunger || 0)); p.thirst = Math.max(0, Math.min(100, p.thirst + (d.thirst || 0))); }
    if (d.type === 'battery') p.battery = 100;
    if (d.type === 'fuel') { const v = this.nearestVehicle(7); if (!v) return; this.session.refuel(v.id, d.fuel); this.stats.refuels++; this.hud.toast(`Poured ${d.fuel} L into the ${this.vtype(v).name}`); }
    p.inv.remove(id, 1);
    this.audio.pickup();
  }
  quickHeal() {
    const p = this.player;
    const order = p.bleed > 0 ? ['bandage', 'medkit'] : p.infection > 30 ? ['antibiotics'] : p.hp < 45 ? ['medkit', 'bandage', 'painkillers'] : ['bandage', 'painkillers'];
    for (const id of order) if (p.inv.has(id)) { this.useItem(id); return; }
    this.hud.toast('No suitable medical items');
  }
  nearestVehicle(r) {
    let best = null, bd = r;
    for (const v of this.session.view.vehicles) { if (!v) continue; const d = Math.hypot(v.x - this.player.body.x, v.z - this.player.body.z); if (d < bd) { bd = d; best = v; } }
    return best;
  }
  dropItem(id, n) { const k = this.player.inv.remove(id, n); if (k) this.session.drop(id, k); }

  sleep() {
    if (this.session.mp) { this.player.hp = Math.min(100, this.player.hp + 10); this.hud.toast('You rest for a moment.'); return; }
    const near = this.session.view.zombies.some(z => !z.dead && (z.state === 'chase' || z.state === 'attack') && Math.hypot(z.x - this.player.body.x, z.z - this.player.body.z) < 40);
    if (near) { this.hud.toast('You can\'t sleep with zombies nearby!'); return; }
    this.session.sleep(7);
    const p = this.player;
    p.hp = Math.min(100, p.hp + 35); p.stamina = 100; p.hunger = Math.max(0, p.hunger - 15); p.thirst = Math.max(0, p.thirst - 20);
    this.hud.toast('You slept until morning. Game saved.', true);
    this.autosave(true);
  }
  useRadio() {
    if (this.settings.missions && this.missions.id() === 'radio') {
      const poi = this.W.pois.police;
      this.session.radio(poi.x, poi.z);
      this.hud.toast('"…Zone 4 survivor, we read you. Evac inbound in three minutes. Hold out!"', true);
      this.missions.advance();
    } else if (this.missions.done) this.hud.toast('Only static now.');
    else this.hud.toast('Static… you need to be better prepared before calling for evac.');
  }

  // ------------------------------------------------------------------ events
  onEvent(e) {
    const me = this.session.id, p = this.player, a = this.audio;
    switch (e.t) {
      case 'shot': {
        const own = e.pid === me;
        if (own && !this.session.mp) break; // already handled locally
        if (!own) { this.effects.flash(e.ox, e.oy, e.oz); a.gunshot(e.ox, e.oy, e.oz, e.w); }
        this.shotEffects(e, own);
        break;
      }
      case 'zhit': {
        this.effects.bloodSpray(e.x, e.y + (e.part === 'head' ? 1.6 : e.part === 'legs' ? 0.6 : 1.2), e.z, 0, 0, e.part === 'head' ? 18 : 10);
        if (Math.random() < 0.4) this.effects.splat(e.x + (Math.random() - 0.5), e.y, e.z + (Math.random() - 0.5), 0.8);
        a.hit(e.x, e.y + 1.2, e.z, true);
        if (e.pid === me) this.hud.hitmark(false);
        break;
      }
      case 'zdie': {
        this.effects.bloodSpray(e.x, e.y + 1.0, e.z, e.dx, e.dz, 24);
        this.effects.splat(e.x, e.y, e.z, 1.6);
        a.hit(e.x, e.y + 0.5, e.z, true);
        if (e.pid === me) { this.stats.kills++; this.hud.hitmark(true); }
        if (p.veh !== null && e.part === 'car' && e.pid === me) { const v = this.vehicle(p.veh); v.vx *= 0.9; v.vz *= 0.9; }
        break;
      }
      case 'hurt': {
        if (e.pid !== me) break;
        p.damage(e.dmg, 'zombie');
        this.hud.damageFrom(e.x, e.z);
        if (Math.random() < 0.3) p.bleed = Math.max(p.bleed, 12 + Math.random() * 12);
        if (e.bite && p.infection <= 0) { p.infection = 1; this.hud.toast('You were bitten! Find antibiotics.', true); }
        a.groan(e.x, 1.5, e.z, 'alert', 0.6);
        break;
      }
      case 'whiff': { const z = this.findZ(e.id); if (z) a.swing(0.25); break; }
      case 'groan': { const z = this.findZ(e.id); if (z && Math.hypot(z.x - p.body.x, z.z - p.body.z) < 45) a.groan(z.x, z.y + 1.6, z.z, e.k); break; }
      case 'door': { const d = this.W.doors[e.id]; if (d) a.door(d.x, d.y0 + 1, d.z, e.by === 'zombie'); break; }
      case 'cont': if (this.pendingLoot === e.id) { this.pendingLoot = null; this.openPanel('loot', e.id); } else if (this.panel === 'loot' && this.lootId === e.id) this.hud.renderLoot(e.id); break;
      case 'got': {
        if (e.pid !== me) break;
        const left = p.inv.add(e.id, e.n);
        if (left > 0) { this.session.drop(e.id, left); this.hud.toast('Backpack full!'); }
        if (left < e.n) { this.hud.toast(`+ ${ITEMS[e.id].name}${e.n - left > 1 ? ' ×' + (e.n - left) : ''}`); a.pickup(); this.missions.onItem(e.id, e.n - left); }
        if (ITEMS[e.id].type === 'melee' || ITEMS[e.id].type === 'gun') { if (p.inv.equipped === 'fists' || ITEMS[p.inv.equipped].type === 'melee' && ITEMS[e.id].type === 'gun') p.equip(e.id); }
        if (this.panel === 'loot') this.hud.renderLoot(this.lootId);
        break;
      }
      case 'venter': if (e.pid === me) { p.enterVehicle(this.vehicle(e.vid)); this.hud.toast(`${this.vtype(this.vehicle(e.vid)).name} — joystick/WASD to drive, ${this.input.touchMode ? 'BRAKE' : 'Space'} for handbrake`); } break;
      case 'vexit': if (e.pid === me) { this.stats.drivenBase = (this.stats.drivenBase || 0) + p.distDriven; p.distDriven = 0; p.exitVehicle({ x: e.x, z: e.z }); } break;
      case 'vhit': { if (p.veh === e.vid) { const v = this.vehicle(e.vid); v.vx *= 0.93; v.vz *= 0.93; p.shake = 0.3; } break; }
      case 'fuel': if (e.pump !== undefined) { this.stats.refuels++; this.hud.toast(`Refuelled the ${this.vtype(this.vehicle(e.vid)).name}`); } break;
      case 'pumped': if (e.pid === me) { if (e.empty) this.hud.toast('This pump is dry.'); else if (e.can) { this.hud.toast('No car nearby — filled a fuel can'); const l = p.inv.add('fuelcan', 1); if (l) this.session.drop('fuelcan', 1); } } break;
      case 'pump': break;
      case 'horde': this.hud.toast('A HORDE IS COMING!', true); a.groan(e.x + 40, 2, e.z, 'alert', 1); break;
      case 'pdead': if (e.pid !== me) this.hud.toast(`${(this.session.view.players.get(e.pid) || {}).name || 'A survivor'} has died`); break;
      case 'chat': this.hud.toast(`${e.name}: ${e.msg}`); break;
      case 'joinedp': this.hud.toast(`${e.name} joined`); break;
      case 'leftp': this.hud.toast(`${e.name} left`); break;
      case 'melee': if (e.pid !== me) { const o = this.session.view.players.get(e.pid); if (o) a.swing(0.3); } break;
      case 'corr': p.body.x = e.x; p.body.y = e.y; p.body.z = e.z; break;
      case 'disconnected': if (this.running) { this.hud.toast('Disconnected from server', true); setTimeout(() => this.onQuit && this.onQuit('Disconnected from the server.'), 1500); } break;
    }
  }
  findZ(id) { return this.session.view.zombies.find(z => z.id === id); }
  shotEffects(e, own) {
    for (const h of e.hits) {
      if (!own || this.session.mp || true) this.effects.tracer(e.ox, e.oy, e.oz, h.x, h.y, h.z);
      if (h.z_ !== undefined) continue;
      if (!h.miss) { this.effects.impact(h.x, h.y, h.z, h.glass); if (h.glass) this.audio.glass(h.x, h.y, h.z); else if (Math.random() < 0.3) this.audio.ricochet(h.x, h.y, h.z); }
    }
    if (own) this.stats.shots++;
  }

  // ------------------------------------------------------------------ panels
  openPanel(name, arg) {
    this.panel = name;
    this.input.releaseAll(); this.input.unlock();
    document.getElementById(name === 'loot' ? 'loot' : name === 'inv' ? 'inv' : 'map').classList.remove('hidden');
    if (name === 'inv') { this.invSel = 0; this.hud.renderInventory(0); }
    if (name === 'loot') { this.lootId = arg; this.hud.renderLoot(arg); }
    if (name === 'map') this.hud.drawMap(document.getElementById('mapCanvas'));
  }
  closePanels() {
    for (const id of ['inv', 'loot', 'map']) document.getElementById(id).classList.add('hidden');
    this.panel = null; this.lootId = null;
    this.input.releaseAll();
  }
  pause(on) {
    this.paused = on;
    document.getElementById('pause').classList.toggle('hidden', !on);
    if (on) { this.input.releaseAll(); this.input.unlock(); document.getElementById('pauseInfo').textContent = this.session.mp ? `Online room ${this.roomCode} — the world keeps running while paused.` : `Day ${this.session.view.day} · Kills ${this.stats.kills}`; }
  }

  onDeath(kind) {
    this.input.releaseAll(); this.input.unlock();
    const msg = { zombie: 'Torn apart by the dead.', fall: 'You fell to your death.', starve: 'You starved.', thirst: 'You died of thirst.', bleed: 'You bled out.', infection: 'The infection took you.', crash: 'You died in a crash.' }[kind] || 'You died.';
    setTimeout(() => {
      document.getElementById('death').classList.remove('hidden');
      document.getElementById('deathTxt').textContent = `${msg} Survived until day ${this.session.view.day || 1} with ${this.stats.kills} kills.`;
      document.getElementById('dLoad').classList.toggle('hidden', this.session.mp || !localStorage.getItem('dd_save'));
    }, 1600);
  }
  respawn() {
    const p = this.player;
    // leave your stuff where you died
    for (const s of [...p.inv.slots]) this.session.drop(s.id, s.n);
    p.inv.slots = []; p.inv.mag = {}; p.inv.equipped = 'fists'; p.inv.changed();
    p.vm.setWeapon('fists'); p._attachTPWeapon('fists');
    Object.assign(p, { hp: 100, stamina: 100, hunger: 80, thirst: 80, infection: 0, bleed: 0, dead: false, crouch: false });
    if (p.veh !== null) this.session.vexit();
    const st = this.W.pois.safebed || this.W.pois.start;
    this.session.respawn();
    p.spawn(st.x, 0, st.z, 0);
    p.inv.add('bandage', 1);
    document.getElementById('death').classList.add('hidden');
    this.hud.toast('You wake up at the safehouse. Your gear is where you fell.', true);
  }
  onWin() {
    this.input.releaseAll(); this.input.unlock();
    document.getElementById('win').classList.remove('hidden');
    document.getElementById('winTxt').textContent = `The helicopter lifts off from the police station. You survived ${this.session.view.day || 1} day(s), killed ${this.stats.kills} zombies and drove ${Math.round(this.stats.driven)} m.`;
    this.autosave(true);
  }

  // ------------------------------------------------------------------ saves
  // Singleplayer: localStorage + cloud slot 'sp' (whole world state).
  // Multiplayer: cloud slot 'mp' (your character: backpack, vitals, stats).
  autosave(force = false) {
    if (this.player.dead) return;
    if (this.session.mp) { if (this.cloud) this.cloud.save('mp', this.makeMpSave(), force); return; }
    const data = this.makeSave();
    try { localStorage.setItem('dd_save', JSON.stringify(data)); } catch (e) { console.warn('save failed', e); }
    if (this.cloud) this.cloud.save('sp', data, force);
  }
  makeMpSave() {
    const p = this.player;
    return { v: 1, saved: Date.now(), inv: p.inv.toJSON(), vitals: { hp: Math.max(25, p.hp), hunger: p.hunger, thirst: p.thirst, infection: p.infection, battery: p.battery }, stats: this.stats };
  }
  applyMpSave(d) {
    const p = this.player;
    if (d.inv) p.inv.load(d.inv);
    if (d.vitals) Object.assign(p, d.vitals);
    if (d.stats) Object.assign(this.stats, d.stats);
  }
  makeSave() {
    const s = this.session.sim, p = this.player, W = this.W;
    return {
      v: 2, seed: W.seed, time: s.time, day: s.day, saved: Date.now(),
      player: { x: p.body.x, y: p.body.y, z: p.body.z, yaw: p.yaw, hp: p.hp, stamina: p.stamina, hunger: p.hunger, thirst: p.thirst, infection: p.infection, bleed: p.bleed, battery: p.battery, veh: p.veh },
      inv: p.inv.toJSON(), missions: this.missions.toJSON(), stats: this.stats,
      doors: W.doors.filter(d => d.open !== d.open0).map(d => d.id),
      conts: s.containers.map((c, i) => (c.gen ? [i, c.items] : null)).filter(Boolean),
      vehicles: s.vehicles.map(v => [v.id, v.x, v.z, v.yaw, v.fuel, v.hp]),
      pumps: W.interacts.filter(i => i.type === 'pump').map(i => [i.id, i.fuel]),
    };
  }
  applySave(d) {
    const s = this.session.sim, p = this.player, W = this.W;
    s.time = d.time; s.day = d.day;
    for (const id of d.doors || []) s.setDoor(id, !W.doors[id].open0, 'load');
    s.drain();
    for (const [i, items] of d.conts || []) { const c = s.containers[i]; if (c) { c.gen = true; c.items = items; W.containers[i].guaranteed = null; } }
    for (const [id, x, z, yaw, fuel, hp] of d.vehicles || []) { const v = s.vehicles[id]; if (v) { Object.assign(v, { x, z, yaw, fuel, hp }); updateVehicleCollider(v); } }
    for (const [id, f] of d.pumps || []) if (W.interacts[id]) W.interacts[id].fuel = f;
    const pp = d.player;
    p.spawn(pp.x, pp.y, pp.z, pp.yaw);
    Object.assign(p, { hp: pp.hp, stamina: pp.stamina, hunger: pp.hunger, thirst: pp.thirst, infection: pp.infection, bleed: pp.bleed, battery: pp.battery });
    p.inv.load(d.inv);
    this.missions.load(d.missions || {});
    Object.assign(this.stats, d.stats || {});
    this.stats.drivenBase = this.stats.driven || 0;
  }

  dispose() {
    this.renderer.setAnimationLoop(null);
    this.running = false;
    this.world.dispose();
    this.mats.dispose();
    for (const id of [...this.audio.engines.keys()]) this.audio.engine(id, false);
    this.session.close();
    this.renderer.dispose();
    removeEventListener('resize', this.resize);
  }
}

function tick() { return new Promise(r => setTimeout(r, 0)); }

function nameTag(name) {
  const c = document.createElement('canvas'); c.width = 256; c.height = 64;
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.5)'; x.fillRect(0, 8, 256, 48);
  x.fillStyle = '#9ff0c0'; x.font = 'bold 30px system-ui'; x.textAlign = 'center'; x.fillText(name.slice(0, 16), 128, 43);
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), depthTest: true, transparent: true }));
  s.scale.set(1.2, 0.3, 1); s.position.y = 2.1;
  return s;
}
