import { useEffect, useRef } from 'react';

/**
 * Trae-style grid pixel field: green → gray, with left-bottom slant.
 * variant: "home" | "auth" | "cta"
 */
export default function PixelWave({ className = '', variant = 'home' }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return undefined;
    }

    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return undefined;
    }

    const isAuth = variant === 'auth';
    const isCta = variant === 'cta';
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let frameId = 0;
    let width = 0;
    let height = 0;
    let dpr = 1;
    let time = 0;
    let cols = 0;
    let rows = 0;
    let cell = 8;
    let gap = 2;
    let particles = [];
    let stacked = false;

    const green = isCta ? [72, 214, 116] : [0, 120, 40];
    const gray = isCta ? [196, 214, 202] : [150, 158, 154];

    const mixColor = (t, alpha) => {
      const k = Math.min(1, Math.max(0, t));
      const r = Math.round(green[0] + (gray[0] - green[0]) * k);
      const g = Math.round(green[1] + (gray[1] - green[1]) * k);
      const b = Math.round(green[2] + (gray[2] - green[2]) * k);
      return `rgba(${r}, ${g}, ${b}, ${alpha})`;
    };

    const ctaReach = () => (stacked ? 0.86 : 0.56);

    const createParticles = () => {
      particles = [];
      for (let row = 0; row < rows; row += 1) {
        for (let col = 0; col < cols; col += 1) {
          const nx = cols <= 1 ? 0.5 : col / (cols - 1);
          const ny = rows <= 1 ? 0.5 : row / (rows - 1);
          const seed = Math.random();

          if (isCta) {
            if (nx > ctaReach()) {
              continue;
            }
            if (seed > 0.9) {
              continue;
            }
          } else {
            const density = isAuth ? 0.22 + ny * 0.5 : 0.28 + ny * 0.55;
            if (seed > density) {
              continue;
            }

            // Soft diagonal cut on bottom-left (ny=1 is bottom)
            const leftBottomMask = nx + (1 - ny);
            const slantThreshold = isAuth ? 0.62 + seed * 0.3 : 0.72 + seed * 0.28;
            if (leftBottomMask < slantThreshold) {
              continue;
            }
          }

          // Home only: soft clear zone for heading readability
          const inTextZone = !isAuth && !isCta && nx < 0.68 && ny < 0.28;
          if (inTextZone && seed > 0.12) {
            continue;
          }

          particles.push({
            col,
            row,
            nx,
            ny,
            phase: Math.random() * Math.PI * 2,
            speed: isCta ? 0.9 + Math.random() * 0.45 : 0.55 + Math.random() * 0.25,
            pulse: 0.5 + Math.random() * 0.4,
            grayBias: Math.random() * 0.2,
            soft: inTextZone,
            scatter: Math.random(),
            cutoff: isCta
              ? 0.5 + Math.sin(row * 2.35 + col * 0.17) * 0.055 + seed * 0.07
              : 1,
          });
        }
      }
    };

    const resize = () => {
      const parent = canvas.parentElement;
      width = Math.max(1, parent?.clientWidth || canvas.clientWidth || 320);
      height = Math.max(1, parent?.clientHeight || canvas.clientHeight || 320);
      dpr = Math.min(window.devicePixelRatio || 1, 2);

      stacked = width < 900;
      cell = width < 560 ? 7 : isCta ? 7 : isAuth ? 8 : 9;
      gap = 2;
      const step = cell + gap;
      cols = Math.ceil(width / step) + 2;
      rows = isCta ? Math.max(4, Math.ceil(height / step) + 1) : Math.max(10, Math.floor(height / step));

      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      createParticles();
    };

    const draw = () => {
      ctx.clearRect(0, 0, width, height);

      const step = cell + gap;
      const xOffset = (width - cols * step) / 2;
      const yOffset = isCta ? 0 : Math.round((height - rows * step) / 2);

      particles.forEach((p) => {
        const flow = p.col + (reducedMotion ? 0 : time * p.speed);
        const zoneCols = isCta ? Math.max(2, Math.ceil(cols * ctaReach())) : cols;
        const wrappedCol = ((flow % zoneCols) + zoneCols) % zoneCols;
        const progress = wrappedCol / Math.max(1, cols - 1);

        const edgeX = Math.min(progress, 1 - progress) * 2;
        let edgeFade = Math.min(1, edgeX * (isAuth ? 1.8 : 1.35) + (isAuth ? 0.05 : 0.2));
        if (isCta) {
          const along = progress;
          const cutoff =
            (stacked ? Math.min(0.82, p.cutoff + 0.22) : p.cutoff) +
            (reducedMotion ? 0 : Math.sin(time * 0.65 + p.phase) * 0.012);
          const solidUntil = stacked ? 0.28 : 0.32;
          const dissolveStart = Math.max(solidUntil + 0.04, cutoff - 0.1);

          if (along >= cutoff) {
            edgeFade = 0;
          } else if (along > dissolveStart) {
            const t = (along - dissolveStart) / Math.max(0.001, cutoff - dissolveStart);
            if (p.scatter < 0.45 + t * 0.5) {
              edgeFade = 0;
            } else {
              edgeFade = 0.16 + p.scatter * 0.28;
            }
          } else if (along > solidUntil) {
            const t = (along - solidUntil) / (dissolveStart - solidUntil);
            edgeFade = 1 - t * 0.12;
          } else {
            edgeFade = 1;
          }
        }
        const flicker = 0.78 + Math.sin(time * 2 + p.phase) * 0.22;

        const topFade = isCta ? 1 : Math.min(1, p.ny / (isAuth ? 0.22 : 0.18));
        const bottomFade = isCta ? 1 : Math.min(1, (1 - p.ny) / (isAuth ? 0.22 : 0.12));
        const textClear = !isAuth && !isCta && p.ny < 0.28 && progress < 0.65 ? 0.2 : 1;
        const softMul = p.soft ? 0.3 : 1;

        const leftBottom = Math.max(0, (1 - progress) * p.ny);
        const leftBottomSlant = 1 - leftBottom * (isCta ? 0.35 : isAuth ? 0.98 : 0.92);

        const alpha =
          p.pulse *
          flicker *
          edgeFade *
          topFade *
          bottomFade *
          textClear *
          softMul *
          leftBottomSlant *
          (isCta ? 0.85 : isAuth ? 0.72 : 0.95);

        if (alpha < 0.08) {
          return;
        }

        const x = Math.round(xOffset + wrappedCol * step);
        const y = Math.round(yOffset + p.row * step);

        const colorT = Math.min(
          1,
          progress * 0.9 + p.grayBias + (!isAuth && p.ny < 0.28 ? 0.3 : 0)
        );
        ctx.fillStyle = mixColor(colorT, alpha);
        ctx.fillRect(x, y, cell, cell);
      });

      time += reducedMotion ? 0 : 0.016;
      frameId = window.requestAnimationFrame(draw);
    };

    resize();
    draw();

    const observer = new ResizeObserver(resize);
    if (canvas.parentElement) {
      observer.observe(canvas.parentElement);
    }
    window.addEventListener('resize', resize);

    return () => {
      window.cancelAnimationFrame(frameId);
      observer.disconnect();
      window.removeEventListener('resize', resize);
    };
  }, [variant]);

  return (
    <div className={`home-pixel-wave ${className}`.trim()} aria-hidden="true">
      <canvas ref={canvasRef} className="home-pixel-wave-canvas" />
    </div>
  );
}
