// A burst of confetti and dollar bills from a point on the screen (reward collected).

const COLORS = ['#ffd35a', '#2ee59d', '#4f8cff', '#ff5ca8', '#ffffff', '#ffb020', '#7a5cff'];

export function confetti(x: number, y: number, count = 90): void {
  const layer = document.createElement('div');
  layer.className = 'confetti-layer';
  document.body.appendChild(layer);
  for (let i = 0; i < count; i++) {
    const p = document.createElement('i');
    const bill = i % 9 === 0;
    p.className = bill ? 'confetti-bill' : 'confetti-bit';
    if (bill) p.textContent = '$';
    else p.style.background = COLORS[i % COLORS.length]!;
    const angle = Math.random() * Math.PI * 2;
    const power = 140 + Math.random() * 320;
    const dx = Math.cos(angle) * power;
    const dy = Math.sin(angle) * power - 220;
    p.style.left = `${x}px`;
    p.style.top = `${y}px`;
    p.style.setProperty('--dx', `${dx}px`);
    p.style.setProperty('--dy', `${dy}px`);
    p.style.setProperty('--fall', `${380 + Math.random() * 360}px`);
    p.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    p.style.animationDelay = `${Math.random() * 120}ms`;
    p.style.animationDuration = `${1300 + Math.random() * 900}ms`;
    layer.appendChild(p);
  }
  setTimeout(() => layer.remove(), 2600);
}

/** Confetti from the middle of an element. */
export function confettiFrom(el: Element | null, count?: number): void {
  const r = el?.getBoundingClientRect();
  confetti(r ? r.left + r.width / 2 : window.innerWidth / 2, r ? r.top + r.height / 2 : window.innerHeight / 2, count);
}
