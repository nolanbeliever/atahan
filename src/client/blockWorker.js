// Builds block geometry off the main thread and transfers the typed arrays back.
import { buildBlockGeometry } from '../shared/world.js';

self.onmessage = (e) => {
  const { seed, cell } = e.data;
  const parts = buildBlockGeometry(seed, cell);
  const tr = [];
  for (const p of parts) tr.push(p.pos.buffer, p.nor.buffer, p.uv.buffer, p.col.buffer, p.idx.buffer);
  self.postMessage({ id: cell.id, parts }, tr);
};
