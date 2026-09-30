// 축하 폭죽(색종이) 효과. 외부 라이브러리 없이 canvas 로 그린다.
// size: "small"(지난 날 완료) | "normal"(오늘 완료) | "big"(PART·1독 완주)
// 폰에서 '동작 줄이기'를 켠 사람에게는 보여 주지 않는다.
const COLORS = ["#e2b04a", "#4b6b52", "#8db394", "#d9785a", "#f2d49a", "#6f9bd1", "#c77dba"];

export function celebrate(size = "normal") {
  if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;
  const canvas = document.createElement("canvas");
  canvas.className = "confetti";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  const dpr = window.devicePixelRatio || 1;
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);

  const count = { small: 60, normal: 150, big: 280 }[size] || 150;
  // 화면 아래 양쪽 모서리에서 안쪽 위로 쏘아 올린다 (크게 축하할 때는 가운데에서도)
  const cannons = size === "big"
    ? [{ x: 0.05, dir: 1 }, { x: 0.95, dir: -1 }, { x: 0.5, dir: 0 }]
    : [{ x: 0.05, dir: 1 }, { x: 0.95, dir: -1 }];
  const power = Math.sqrt(h / 800);
  const pieces = [];
  for (let i = 0; i < count; i++) {
    const c = cannons[i % cannons.length];
    const spread = c.dir === 0 ? 0.9 : 0.55;
    const angle = -Math.PI / 2 + c.dir * 0.45 + (Math.random() - 0.5) * spread;
    const speed = (19 + Math.random() * 13) * power;
    pieces.push({
      x: w * c.x + (Math.random() - 0.5) * 30, y: h + 10,
      vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed,
      size: 6 + Math.random() * 6, rot: Math.random() * Math.PI, vr: (Math.random() - 0.5) * 0.35,
      color: COLORS[i % COLORS.length], shape: i % 3, // 0 네모, 1 동그라미, 2 긴 띠
      delay: size === "big" ? Math.floor((i / count) * 3) * 20 : Math.floor(Math.random() * 8),
    });
  }

  const duration = size === "big" ? 3200 : 2400;
  const start = performance.now();
  function frame(now) {
    const t = now - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of pieces) {
      if (t / 16 < p.delay) continue;
      p.vy += 0.32 * power; // 중력
      p.vx *= 0.985;
      p.vy *= 0.99; // 공기 저항
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      ctx.save();
      ctx.globalAlpha = Math.min(1, Math.max(0, (duration - t) / 600));
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.fillStyle = p.color;
      if (p.shape === 1) { ctx.beginPath(); ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2); ctx.fill(); }
      else if (p.shape === 2) ctx.fillRect(-p.size / 5, -p.size, p.size / 2.5, p.size * 2);
      else ctx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.7);
      ctx.restore();
    }
    if (t < duration) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
  navigator.vibrate?.(size === "big" ? [30, 60, 30, 60, 60] : 30);
}
