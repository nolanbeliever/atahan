// Vite plugin for high-detail vehicle models: `virtual:hq-models` lists the .glb/.gltf files present
// in client/public/assets/models, so the game only requests models that exist (no 404s for entries
// whose file hasn't been added yet). The Draco decoder is bundled by three's DRACOLoader itself.

import fs from 'node:fs';
import type { Plugin } from 'vite';

const VIRTUAL = 'virtual:hq-models';
const RESOLVED = '\0' + VIRTUAL;

export function hqModelsPlugin(opts: { modelsDir: string }): Plugin {
  const list = (): string[] => {
    try {
      return fs
        .readdirSync(opts.modelsDir)
        .filter((f) => /\.(glb|gltf)$/i.test(f))
        .sort();
    } catch {
      return [];
    }
  };
  return {
    name: 'getrich-hq-models',
    resolveId(id) {
      return id === VIRTUAL ? RESOLVED : null;
    },
    load(id) {
      if (id !== RESOLVED) return null;
      return `export const HQ_MODEL_FILES = ${JSON.stringify(list())};`;
    },
    configureServer(server) {
      // Added or removed model files show up after a page reload.
      server.watcher.add(opts.modelsDir);
      const refresh = (file: string) => {
        if (!file.startsWith(opts.modelsDir)) return;
        const mod = server.moduleGraph.getModuleById(RESOLVED);
        if (mod) server.moduleGraph.invalidateModule(mod);
      };
      server.watcher.on('add', refresh);
      server.watcher.on('unlink', refresh);
    },
  };
}
