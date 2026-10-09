import fs from 'node:fs';
import path from 'node:path';

/**
 * Basit JSON dosya deposu. Yazma atomiktir (geçici dosya + yeniden adlandırma),
 * böylece yazım sırasında sunucu kapanırsa dosya bozulmaz.
 * Not: Render'ın ücretsiz planında disk kalıcı değildir; yeniden deploy'da sıfırlanır.
 */
export class FileStore {
  constructor(file) {
    this.file = file;
  }

  load() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return null;
    }
  }

  save(data) {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(data));
      fs.renameSync(tmp, this.file);
    } catch (err) {
      console.warn('[Ev] Kaydedilemedi:', err.message);
    }
  }
}
