import { EVT } from '../../shared/constants.js';

/**
 * Basit jeton kovası: istemci başına mesaj hızını sınırlar
 * (bozuk ya da kötü niyetli istemcilerin sunucuyu yormasını engeller).
 */
function rateLimiter(perSecond, burst = perSecond) {
  let tokens = burst;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(burst, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}

/**
 * İşleyicideki beklenmedik bir hata (bozuk/kötü niyetli girdi) süreci
 * çökertip herkesin oyununu düşürmesin: yakala, logla, isteğe hata dön.
 */
function safe(fn) {
  return async (...args) => {
    try {
      await fn(...args);
    } catch (err) {
      console.error('[socket] işleyici hatası:', err);
      const ack = args[args.length - 1];
      if (typeof ack === 'function') ack({ ok: false, error: 'Sunucu hatası.' });
    }
  };
}

export function attachSocketHandlers(io, sim) {
  const sockets = new Map(); // oyuncu id → socket (kişisel mesajlar için)
  // Simülasyon olaylarını tüm istemcilere ilet
  sim.on('out', (event, payload) => io.emit(event, payload));
  sim.on('to', (id, event, payload) => sockets.get(id)?.emit(event, payload));

  io.on('connection', (socket) => {
    const on = (event, fn) => socket.on(event, safe(fn));
    let player = null;
    const allowMove = rateLimiter(20, 30);
    const allowInteract = rateLimiter(8, 8);
    const allowShop = rateLimiter(4, 6);
    const allowHouse = rateLimiter(6, 10);
    const allowBar = rateLimiter(8, 12);
    const reply = (ack, res) => { if (typeof ack === 'function') ack(res); };

    // Saat senkronu: istemci gecikmeyi ölçüp sunucu saatine hizalanır
    on(EVT.SYNC, (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    on(EVT.JOIN, (data) => {
      if (player) return;
      if (sim.players.size >= sim.config.maxPlayers) {
        socket.emit(EVT.NOTIFY, { text: 'Otel personeli dolu, lütfen daha sonra tekrar deneyin.', kind: 'warn' });
        socket.disconnect(true);
        return;
      }
      player = sim.addPlayer(data && data.name);
      sockets.set(player.id, socket);
      socket.emit(EVT.WELCOME, sim.snapshot(player.id));
    });

    on(EVT.MOVE, (m) => {
      if (!player || !Array.isArray(m) || !allowMove()) return;
      sim.movePlayer(player.id, Number(m[0]), Number(m[1]), Number(m[2]));
    });

    on(EVT.INTERACT, (data) => {
      if (!player || !data || !allowInteract()) return;
      const target = data.target === 'bed' ? 'bed' : Number(data.target);
      const ok = sim.interact(player.id, String(data.roomId), target);
      // İyimser (optimistic) arayüzü düzeltmek için reddedilirse gerçek durumu gönder
      if (!ok) socket.emit(EVT.ROOMS, sim.rooms.serialize());
    });

    on(EVT.SHOP_BUY, (data, ack) => {
      if (!player || !allowShop()) return reply(ack, { ok: false, error: 'Çok hızlı!' });
      reply(ack, sim.buy(player.id, String(data?.product ?? '')));
    });

    on(EVT.CONSUME, (data, ack) => {
      if (!player || !allowShop()) return reply(ack, { ok: false, error: 'Çok hızlı!' });
      reply(ack, sim.consume(player.id, String(data?.product ?? '')));
    });

    on(EVT.SLOT_SPIN, (_data, ack) => {
      if (!player || !allowShop()) return reply(ack, { ok: false, error: 'Çok hızlı!' });
      reply(ack, sim.spin(player.id));
    });

    on(EVT.EMOTE, (data) => {
      if (!player || !data) return;
      sim.emote(player.id, data.type === 'giggle' ? 'giggle' : 'vomit');
    });

    // ---- Bizim Ev ----
    const houseGuard = (ack) => {
      if (player && allowHouse()) return true;
      reply(ack, { ok: false, error: 'Çok hızlı!' });
      return false;
    };
    on(EVT.HOUSE_PLACE, (data, ack) => {
      if (houseGuard(ack)) reply(ack, sim.housePlace(player.id, data));
    });
    on(EVT.HOUSE_REMOVE, (data, ack) => {
      if (houseGuard(ack)) reply(ack, sim.houseRemove(player.id, data?.id));
    });
    on(EVT.HOUSE_LIGHTS, (_data, ack) => {
      if (houseGuard(ack)) reply(ack, sim.houseLights(player.id));
    });
    on(EVT.HOUSE_TV_SET, async (data, ack) => {
      if (!houseGuard(ack)) return;
      const link = typeof data?.link === 'string' ? data.link : '';
      reply(ack, await sim.houseTvSet(player.id, data?.itemId, link));
    });
    on(EVT.HOUSE_TV_STOP, (data, ack) => {
      if (houseGuard(ack)) reply(ack, sim.houseTvStop(player.id, data?.itemId));
    });

    // ---- Bar De Tulp ----
    const barGuard = (ack) => {
      if (player && allowBar()) return true;
      reply(ack, { ok: false, error: 'Çok hızlı!' });
      return false;
    };
    on(EVT.BAR_ACT, (data, ack) => {
      if (barGuard(ack)) reply(ack, sim.barAct(player.id, data));
    });

    on('disconnect', () => {
      if (player) {
        sockets.delete(player.id);
        sim.removePlayer(player.id);
      }
      player = null;
    });
  });
}
