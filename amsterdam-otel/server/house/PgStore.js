import pg from 'pg';

const TABLE = 'amsterdam_otel_state';
const RETRY_MS = 5000;

/**
 * PostgreSQL deposu (ör. ücretsiz Neon veritabanı) — FileStore ile aynı arayüz:
 * load() senkron (açılışta okunan kaydı döner), save(data) arka planda yazar.
 * Render'ın ücretsiz planında disk her yeniden başlatmada silindiği için kalıcı
 * kayıt (evler, eşyalar, cüzdanlar, kasa, oyun saati) buraya yazılır.
 *
 * Tüm durum tek bir JSONB satırında tutulur; ard arda gelen kayıtlar birleştirilir
 * (yalnızca en son durum yazılır), veritabanı yorulmaz.
 */
export class PgStore {
  /** Bağlanır, tabloyu hazırlar ve kaydı okur. Ulaşılamazsa birkaç kez dener, sonra hata fırlatır. */
  static async create(url, { key = 'main', attempts = 5 } = {}) {
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    const pool = new pg.Pool({
      connectionString: url,
      max: 2,
      // Neon gibi bulut veritabanları TLS ister (adreste sslmode yoksa da açık tut)
      ssl: local || /sslmode=/.test(url) ? undefined : true,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 10_000,
    });
    pool.on('error', (err) => console.warn('[Kayıt] Veritabanı bağlantı hatası:', err.message));
    let lastErr = null;
    for (let i = 0; i < attempts; i++) {
      try {
        await pool.query(`CREATE TABLE IF NOT EXISTS ${TABLE} (
          key text PRIMARY KEY,
          data jsonb NOT NULL,
          updated_at timestamptz NOT NULL DEFAULT now()
        )`);
        const res = await pool.query(`SELECT data FROM ${TABLE} WHERE key = $1`, [key]);
        return new PgStore(pool, key, res.rows[0]?.data ?? null);
      } catch (err) {
        lastErr = err;
        console.warn(`[Kayıt] Veritabanına bağlanılamadı (${i + 1}/${attempts}): ${err.message}`);
        await new Promise((r) => setTimeout(r, 1000 * 2 ** i));
      }
    }
    await pool.end().catch(() => {});
    throw lastErr;
  }

  constructor(pool, key, data) {
    this.pool = pool;
    this.key = key;
    this.data = data;
    this.pending = null; // yazılmayı bekleyen en son durum
    this.writing = null; // süren yazma (Promise)
    this.retryTimer = null;
  }

  load() {
    return this.data;
  }

  save(data) {
    this.pending = JSON.stringify(data);
    if (!this.writing) this.writing = this.drain();
  }

  async drain() {
    try {
      while (this.pending !== null) {
        const json = this.pending;
        this.pending = null;
        try {
          await this.pool.query(
            `INSERT INTO ${TABLE} (key, data, updated_at) VALUES ($1, $2::jsonb, now())
             ON CONFLICT (key) DO UPDATE SET data = EXCLUDED.data, updated_at = now()`,
            [this.key, json],
          );
        } catch (err) {
          console.warn('[Kayıt] Veritabanına yazılamadı, tekrar denenecek:', err.message);
          if (this.pending === null) this.pending = json; // daha yenisi yoksa bunu yeniden dene
          clearTimeout(this.retryTimer);
          this.retryTimer = setTimeout(() => {
            if (!this.writing && this.pending !== null) this.writing = this.drain();
          }, RETRY_MS);
          this.retryTimer.unref?.();
          return;
        }
      }
    } finally {
      this.writing = null;
    }
  }

  /** Bekleyen yazmayı bitir (kapanışta) */
  async flush() {
    if (this.pending !== null && !this.writing) this.writing = this.drain();
    await this.writing;
  }

  async close() {
    clearTimeout(this.retryTimer);
    await this.flush();
    await this.pool.end();
  }
}
