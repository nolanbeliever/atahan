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

export function attachSocketHandlers(io, sim) {
  // Simülasyon olaylarını tüm istemcilere ilet
  sim.on('out', (event, payload) => io.emit(event, payload));

  io.on('connection', (socket) => {
    let player = null;
    const allowMove = rateLimiter(20, 30);
    const allowInteract = rateLimiter(8, 8);

    // Saat senkronu: istemci gecikmeyi ölçüp sunucu saatine hizalanır
    socket.on(EVT.SYNC, (ack) => {
      if (typeof ack === 'function') ack(Date.now());
    });

    socket.on(EVT.JOIN, (data) => {
      if (player) return;
      if (sim.players.size >= sim.config.maxPlayers) {
        socket.emit(EVT.NOTIFY, { text: 'Otel personeli dolu, lütfen daha sonra tekrar deneyin.', kind: 'warn' });
        socket.disconnect(true);
        return;
      }
      player = sim.addPlayer(data && data.name);
      socket.emit(EVT.WELCOME, sim.snapshot(player.id));
    });

    socket.on(EVT.MOVE, (m) => {
      if (!player || !Array.isArray(m) || !allowMove()) return;
      sim.movePlayer(player.id, Number(m[0]), Number(m[1]), Number(m[2]));
    });

    socket.on(EVT.INTERACT, (data) => {
      if (!player || !data || !allowInteract()) return;
      const target = data.target === 'bed' ? 'bed' : Number(data.target);
      const ok = sim.interact(player.id, String(data.roomId), target);
      // İyimser (optimistic) arayüzü düzeltmek için reddedilirse gerçek durumu gönder
      if (!ok) socket.emit(EVT.ROOMS, sim.rooms.serialize());
    });

    socket.on('disconnect', () => {
      if (player) sim.removePlayer(player.id);
      player = null;
    });
  });
}
