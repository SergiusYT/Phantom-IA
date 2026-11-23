import React, { useEffect, useRef } from "react";

/* Fondo animado del acceso: una red viva. Paquetes de Internet llegan al firewall;
   los permitidos siguen hacia los pods del clúster y los bloqueados mueren en PF.
   Solo decorativo: no lee ni envía datos. */
const VERDE = "60,245,162", AMBAR = "255,181,71", ROJO = "255,77,94", HIELO = "108,212,255";

export default function FondoAcceso() {
  const ref = useRef(null);

  useEffect(() => {
    const cv = ref.current;
    const ctx = cv.getContext("2d");
    const quieto = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let W = 0, H = 0, dpr = 1, raf = 0, t0 = performance.now(), ultimo = 0;
    const raton = { x: -9999, y: -9999, px: 0, py: 0 };
    let fw, externos = [], pods = [], enlaces = [], paquetes = [], ondas = [], polvo = [];

    const azar = (a, b) => a + Math.random() * (b - a);

    function construir() {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      W = cv.clientWidth; H = cv.clientHeight;
      cv.width = W * dpr; cv.height = H * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const ancho = W > 860 ? W - 440 : W; // la red vive detrás del lado izquierdo
      fw = { x: ancho * 0.6, y: H * 0.34, r: 30 };
      externos = Array.from({ length: 6 }, (_, i) => ({
        x: ancho * (0.3 + (i % 2) * 0.05) + azar(-10, 10), y: H * (0.1 + i * 0.075) + azar(-10, 10),
        fase: Math.random() * 6.28, r: 4,
      }));
      pods = [];
      const n = W > 860 ? 15 : 10;
      for (let i = 0; i < n * 6 && pods.length < n; i++) {
        const p = { x: azar(ancho * 0.7, ancho * 0.97), y: azar(H * 0.08, H * 0.94), r: azar(4, 7), fase: Math.random() * 6.28 };
        if (pods.every((q) => Math.hypot(q.x - p.x, q.y - p.y) > 70)) pods.push(p);
      }
      pods.forEach((p) => { p.bx = p.x; p.by = p.y; });
      enlaces = [];
      pods.forEach((p, i) => pods.slice(i + 1).forEach((q) => {
        if (Math.hypot(p.x - q.x, p.y - q.y) < 190) enlaces.push([p, q]);
      }));
      polvo = Array.from({ length: Math.round((W * H) / 16000) }, () => ({
        x: Math.random() * W, y: Math.random() * H, v: azar(0.05, 0.25), a: azar(0.05, 0.3), z: azar(0.3, 1),
      }));
    }

    function lanzar() {
      const ext = externos[Math.floor(Math.random() * externos.length)];
      const bloqueado = Math.random() < 0.28;
      const destino = pods[Math.floor(Math.random() * pods.length)];
      paquetes.push({ tramo: 0, k: 0, v: azar(0.008, 0.014), bloqueado, ruta: [ext, fw, destino],
        color: bloqueado ? ROJO : Math.random() < 0.15 ? HIELO : VERDE });
    }

    function curva(a, b) { // control para un arco suave entre dos nodos
      const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      return { x: mx + (b.y - a.y) * 0.12, y: my - (b.x - a.x) * 0.12 };
    }
    const punto = (a, c, b, k) => ({
      x: (1 - k) * (1 - k) * a.x + 2 * (1 - k) * k * c.x + k * k * b.x,
      y: (1 - k) * (1 - k) * a.y + 2 * (1 - k) * k * c.y + k * k * b.y,
    });

    function arco(a, b, color, alfa, ancho = 1) {
      const c = curva(a, b);
      ctx.strokeStyle = `rgba(${color},${alfa})`; ctx.lineWidth = ancho;
      ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.quadraticCurveTo(c.x, c.y, b.x, b.y); ctx.stroke();
    }

    function brillo(x, y, r, color, a) {
      const g = ctx.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(${color},${a})`); g.addColorStop(1, `rgba(${color},0)`);
      ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.283); ctx.fill();
    }

    function hexagono(x, y, r) {
      ctx.beginPath();
      for (let i = 0; i < 6; i++) { const a = Math.PI / 6 + i * Math.PI / 3; ctx[i ? "lineTo" : "moveTo"](x + r * Math.cos(a), y + r * Math.sin(a)); }
      ctx.closePath();
    }

    function cuadro(ahora) {
      const t = (ahora - t0) / 1000;
      raton.px += (raton.x - raton.px) * 0.06; raton.py += (raton.y - raton.py) * 0.06;
      const ox = (raton.px / (W || 1) - 0.5) * -14, oy = (raton.py / (H || 1) - 0.5) * -10;

      // fondo: degradado profundo + viñeta
      const g = ctx.createRadialGradient(fw.x, fw.y, 0, fw.x, fw.y, Math.max(W, H) * 0.85);
      g.addColorStop(0, "#0b2219"); g.addColorStop(0.45, "#06120c"); g.addColorStop(1, "#020604");
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

      // rejilla de puntos con paralaje
      ctx.fillStyle = "rgba(60,245,162,0.07)";
      for (let x = (ox % 36) - 36; x < W + 36; x += 36)
        for (let y = (oy % 36) - 36; y < H + 36; y += 36) ctx.fillRect(x, y, 1.2, 1.2);

      // polvo flotante
      polvo.forEach((p) => {
        p.y -= p.v; if (p.y < -4) { p.y = H + 4; p.x = Math.random() * W; }
        ctx.fillStyle = `rgba(${VERDE},${p.a * (0.6 + 0.4 * Math.sin(t * 1.3 + p.x))})`;
        ctx.fillRect(p.x + ox * p.z, p.y + oy * p.z, 1.5 * p.z, 1.5 * p.z);
      });

      ctx.save(); ctx.translate(ox * 0.6, oy * 0.6);

      // pods se mecen
      pods.forEach((p) => { p.x = p.bx + Math.sin(t * 0.5 + p.fase) * 6; p.y = p.by + Math.cos(t * 0.4 + p.fase) * 6; });

      // enlaces
      enlaces.forEach(([a, b]) => {
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        ctx.strokeStyle = `rgba(${VERDE},${0.16 * (1 - d / 190)})`; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();
      });
      externos.forEach((e) => arco(e, fw, AMBAR, 0.1));
      pods.forEach((p) => arco(fw, p, VERDE, 0.07));

      // enlaces al cursor
      const rx = raton.px - ox * 0.6, ry = raton.py - oy * 0.6;
      pods.forEach((p) => {
        const d = Math.hypot(p.x - rx, p.y - ry);
        if (d < 170) { ctx.strokeStyle = `rgba(${VERDE},${0.35 * (1 - d / 170)})`; ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(rx, ry); ctx.stroke(); }
      });

      // anillo de seguridad y radar alrededor del firewall
      const pulso = (t % 3) / 3;
      ctx.strokeStyle = `rgba(${VERDE},${0.35 * (1 - pulso)})`; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(fw.x, fw.y, fw.r + pulso * 120, 0, 6.283); ctx.stroke();
      [80, 150, 230].forEach((r, i) => {
        ctx.strokeStyle = `rgba(${VERDE},${0.07 - i * 0.015})`; ctx.setLineDash([3, 7]);
        ctx.beginPath(); ctx.arc(fw.x, fw.y, r, 0, 6.283); ctx.stroke();
      });
      ctx.setLineDash([]);
      const ang = t * 0.9;
      const barrido = ctx.createConicGradient ? ctx.createConicGradient(ang, fw.x, fw.y) : null;
      if (barrido) {
        barrido.addColorStop(0, `rgba(${VERDE},0.16)`); barrido.addColorStop(0.08, `rgba(${VERDE},0)`); barrido.addColorStop(1, `rgba(${VERDE},0)`);
        ctx.fillStyle = barrido; ctx.beginPath(); ctx.arc(fw.x, fw.y, 230, 0, 6.283); ctx.fill();
      }

      // paquetes
      paquetes.forEach((p) => {
        const a = p.ruta[p.tramo], b = p.ruta[p.tramo + 1], c = curva(a, b);
        p.k += p.v * (p.tramo === 0 ? 1 : 1.25);
        const q = punto(a, c, b, Math.min(p.k, 1));
        // estela
        for (let s = 1; s <= 6; s++) {
          const e = punto(a, c, b, Math.max(0, Math.min(p.k, 1) - s * 0.018));
          ctx.fillStyle = `rgba(${p.color},${0.28 - s * 0.04})`; ctx.beginPath(); ctx.arc(e.x, e.y, 2.2 - s * 0.25, 0, 6.283); ctx.fill();
        }
        brillo(q.x, q.y, 9, p.color, 0.5);
        ctx.fillStyle = `rgb(${p.color})`; ctx.beginPath(); ctx.arc(q.x, q.y, 2.3, 0, 6.283); ctx.fill();
        if (p.k >= 1) {
          if (p.tramo === 0 && p.bloqueado) { ondas.push({ x: fw.x, y: fw.y, k: 0, color: ROJO }); p.fin = true; }
          else if (p.tramo === 0) { p.tramo = 1; p.k = 0; }
          else { ondas.push({ x: b.x, y: b.y, k: 0, color: p.color }); b.luz = 1; p.fin = true; }
        }
      });
      paquetes = paquetes.filter((p) => !p.fin);

      // ondas de impacto
      ondas.forEach((o) => {
        o.k += 0.03;
        ctx.strokeStyle = `rgba(${o.color},${0.6 * (1 - o.k)})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(o.x, o.y, 6 + o.k * (o.color === ROJO ? 46 : 22), 0, 6.283); ctx.stroke();
      });
      ondas = ondas.filter((o) => o.k < 1);

      // nodos externos (Internet)
      externos.forEach((e) => {
        brillo(e.x, e.y, 14, AMBAR, 0.25 + 0.15 * Math.sin(t * 2 + e.fase));
        ctx.fillStyle = `rgba(${AMBAR},0.9)`; ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, 6.283); ctx.fill();
      });

      // pods
      pods.forEach((p) => {
        p.luz = Math.max(0, (p.luz || 0) - 0.02);
        brillo(p.x, p.y, 16 + p.luz * 18, VERDE, 0.18 + p.luz * 0.5);
        ctx.fillStyle = "#06120c"; ctx.strokeStyle = `rgba(${VERDE},${0.65 + p.luz * 0.35})`; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.283); ctx.fill(); ctx.stroke();
        ctx.fillStyle = `rgba(${VERDE},${0.5 + p.luz * 0.5})`; ctx.beginPath(); ctx.arc(p.x, p.y, p.r * 0.38, 0, 6.283); ctx.fill();
      });

      // firewall
      brillo(fw.x, fw.y, 70, VERDE, 0.22);
      ctx.fillStyle = "#0b2419"; ctx.strokeStyle = `rgba(${VERDE},0.95)`; ctx.lineWidth = 2;
      hexagono(fw.x, fw.y, fw.r); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = `rgba(${VERDE},0.35)`; ctx.lineWidth = 1;
      hexagono(fw.x, fw.y, fw.r + 7 + Math.sin(t * 2) * 1.5); ctx.stroke();
      ctx.strokeStyle = `rgb(${VERDE})`; ctx.lineWidth = 2; ctx.lineJoin = "round"; ctx.lineCap = "round";
      ctx.beginPath(); // el pulso del logo
      [[-12, 0], [-4, 0], [0, -8], [4, 10], [8, 2], [12, 2]].forEach(([x, y], i) => ctx[i ? "lineTo" : "moveTo"](fw.x + x, fw.y + y));
      ctx.stroke();
      ctx.font = "600 10px 'JetBrains Mono', monospace"; ctx.textAlign = "center";
      ctx.fillStyle = `rgba(${VERDE},0.75)`; ctx.fillText("FREEBSD · PF", fw.x, fw.y + fw.r + 22);
      ctx.fillStyle = `rgba(${AMBAR},0.6)`; ctx.fillText("INTERNET", externos[0].x + 8, externos[0].y - 18);

      ctx.restore();

      // líneas de barrido CRT muy suaves
      ctx.fillStyle = "rgba(0,0,0,0.12)";
      for (let y = 0; y < H; y += 3) ctx.fillRect(0, y, W, 1);

      if (!quieto) {
        if (ahora - ultimo > 260) { lanzar(); ultimo = ahora; }
        raf = requestAnimationFrame(cuadro);
      }
    }

    const mover = (e) => { raton.x = e.clientX; raton.y = e.clientY; };
    const redimensionar = () => { construir(); if (quieto) cuadro(performance.now()); };
    construir();
    raton.px = W / 2; raton.py = H / 2;
    window.addEventListener("resize", redimensionar);
    window.addEventListener("pointermove", mover);
    raf = requestAnimationFrame(cuadro);
    return () => { cancelAnimationFrame(raf); window.removeEventListener("resize", redimensionar); window.removeEventListener("pointermove", mover); };
  }, []);

  return <canvas ref={ref} className="acceso-fondo" aria-hidden="true" />;
}
