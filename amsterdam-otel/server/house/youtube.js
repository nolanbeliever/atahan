import { isYouTubeId } from '../../shared/house.js';

const TIMEOUT_MS = 4000;

/**
 * YouTube oEmbed ile video başlığını ve gömülebilirliğini öğrenir.
 * Ağ hatasında hata fırlatır (çağıran taraf "yine de dene" davranır).
 * @returns {{ title?: string, notFound?: boolean, notEmbeddable?: boolean }}
 */
export async function fetchVideoInfo(id) {
  if (!isYouTubeId(id)) return { notFound: true };
  const watch = `https://www.youtube.com/watch?v=${id}`;
  const res = await fetch(`https://www.youtube.com/oembed?format=json&url=${encodeURIComponent(watch)}`, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (res.status === 401 || res.status === 403) return { notEmbeddable: true };
  if (res.status === 400 || res.status === 404) return { notFound: true };
  if (!res.ok) return {};
  const json = await res.json();
  return { title: typeof json.title === 'string' ? json.title : undefined };
}

/**
 * Video küçük resmi için aynı-köken vekil (proxy). Tarayıcı, i.ytimg.com'dan
 * gelen görseli CORS nedeniyle WebGL dokusu olarak kullanamayabilir; sunucu
 * üzerinden gelince sorun kalmaz. Yalnızca 11 karakterlik kimlik kabul edilir
 * (sabit host → SSRF yok).
 */
export function thumbnailHandler() {
  const cache = new Map();
  const MAX = 60;
  return async (req, res) => {
    const { id } = req.params;
    if (!isYouTubeId(id)) {
      res.sendStatus(400);
      return;
    }
    let buf = cache.get(id);
    if (!buf) {
      try {
        const r = await fetch(`https://i.ytimg.com/vi/${id}/mqdefault.jpg`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (!r.ok) {
          res.sendStatus(404);
          return;
        }
        buf = Buffer.from(await r.arrayBuffer());
        if (buf.length > 400_000) {
          res.sendStatus(413);
          return;
        }
        cache.set(id, buf);
        if (cache.size > MAX) cache.delete(cache.keys().next().value);
      } catch {
        res.sendStatus(502);
        return;
      }
    }
    res.set('Content-Type', 'image/jpeg');
    res.set('Cache-Control', 'public, max-age=86400');
    res.send(buf);
  };
}
