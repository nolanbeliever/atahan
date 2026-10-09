// Cihaz sınıfı tespiti: telefon / tablet / masaüstü.
// Kalite ön ayarı, FPS sınırı ve kontrol şeması buna göre seçilir.

export function detectDevice() {
  const ua = navigator.userAgent || '';
  const maxTouch = navigator.maxTouchPoints || 0;
  const coarse = window.matchMedia?.('(pointer: coarse)').matches ?? false;
  // iPadOS 13+ kendini Mac olarak tanıtır
  const iPadOS = /Macintosh/.test(ua) && maxTouch > 1;
  const mobileUA = /Android|iPhone|iPod|Mobile|Windows Phone|Opera Mini/i.test(ua);
  const tabletUA = /iPad|Tablet|PlayBook|Silk/i.test(ua) || (/Android/i.test(ua) && !/Mobile/i.test(ua)) || iPadOS;

  const touch = coarse || mobileUA || tabletUA;
  const minSide = Math.min(window.screen?.width || 1024, window.screen?.height || 768);

  let type = 'desktop';
  if (touch) type = tabletUA || minSide >= 600 ? 'tablet' : 'phone';

  const cores = navigator.hardwareConcurrency || 4;
  const memory = navigator.deviceMemory || 4;
  const lowEnd = cores <= 4 || memory <= 3;

  return {
    type,
    touch,
    phone: type === 'phone',
    tablet: type === 'tablet',
    desktop: type === 'desktop',
    lowEnd,
    dpr: window.devicePixelRatio || 1,
  };
}
