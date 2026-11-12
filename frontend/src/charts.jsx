import React, { useEffect, useRef, useState } from "react";

/* Graficas SVG ligeras. Paleta categorica validada (CVD, modo oscuro, superficie #0A1410). */
export const SERIE = { frontend: "#3987e5", api: "#199e70", db: "#d95926" };
const GRID = "#14271D", EJE = "#5C7A6C", TINTA = "#D8F3E5", TINTA2 = "#8FB3A2";

function useHover() {
  const [i, setI] = useState(null);
  return [i, setI];
}

/* Linea (1..n series) con cursor vertical y tooltip. series: [{id, nombre, color, valores:[n]}] */
export function Lineas({ etiquetas, series, alto = 220, min = 0, max, unidad = "", formatoX = (x) => x, directas = true }) {
  const ref = useRef(null);
  const [hover, setHover] = useHover();
  const etiquetaY = useRef({});
  const caja = useRef(null);
  const [ancho, setAncho] = useState(640);
  useEffect(() => {
    if (!caja.current) return;
    const ro = new ResizeObserver(([e]) => setAncho(Math.max(280, Math.round(e.contentRect.width))));
    ro.observe(caja.current);
    return () => ro.disconnect();
  }, []);
  const W = ancho, H = alto, pl = 40, pr = directas && series.length > 1 ? 86 : 16, pt = 14, pb = 28;
  const n = etiquetas.length;
  const todos = series.flatMap((s) => s.valores).filter((v) => v != null);
  const top = max ?? Math.max(1, ...todos) * 1.15;
  const x = (i) => pl + (n <= 1 ? (W - pl - pr) / 2 : (i / (n - 1)) * (W - pl - pr));
  const y = (v) => pt + (1 - (v - min) / (top - min || 1)) * (H - pt - pb);
  const ticks = [min, min + (top - min) / 2, top].map((v) => Math.round(v));
  const mover = (e) => {
    const r = ref.current.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.round(((px - pl) / (W - pl - pr)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  };
  return (
    <div className="grafica" ref={caja} onMouseLeave={() => setHover(null)}>
      {!n && <div className="vacio">Aún no hay datos.</div>}
      {n > 0 && <svg ref={ref} viewBox={`0 0 ${W} ${H}`} onMouseMove={mover} role="img" aria-label={series.map((s) => s.nombre).join(", ")}>
        {ticks.map((t) => <g key={t}><line x1={pl} x2={W - pr} y1={y(t)} y2={y(t)} stroke={GRID} /><text x={pl - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill={EJE}>{t}{unidad}</text></g>)}
        {[0, Math.floor((n - 1) / 2), n - 1].filter((v, k, a) => a.indexOf(v) === k).map((i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor={n > 1 && i === 0 ? "start" : n > 1 && i === n - 1 ? "end" : "middle"} fontSize="11" fill={EJE}>{formatoX(etiquetas[i])}</text>))}
        {(() => {
          // etiquetas directas sin solaparse: se ordenan por altura y se separan al menos 14 px
          const ult = series.map((s) => { const v = [...s.valores].reverse().find((z) => z != null); return v == null ? null : { id: s.id, y: y(v) }; }).filter(Boolean).sort((a, b) => a.y - b.y);
          for (let i = 1; i < ult.length; i++) if (ult[i].y - ult[i - 1].y < 14) ult[i].y = ult[i - 1].y + 14;
          etiquetaY.current = Object.fromEntries(ult.map((u) => [u.id, u.y]));
          return null;
        })()}
        {series.map((s) => {
          const pts = s.valores.map((v, i) => (v == null ? null : [x(i), y(v)])).filter(Boolean);
          if (!pts.length) return null;
          const last = pts[pts.length - 1];
          return (
            <g key={s.id}>
              <path d={pts.map((p, i) => `${i ? "L" : "M"}${p[0]},${p[1]}`).join(" ")} fill="none" stroke={s.color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
              {n <= 12 && pts.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r="4" fill={s.color} stroke="#0A1410" strokeWidth="2" />)}
              {directas && series.length > 1 && <text x={last[0] + 8} y={(etiquetaY.current[s.id] ?? last[1]) + 4} fontSize="12" fill={TINTA2}>{s.nombre}</text>}
            </g>);
        })}
        {hover != null && (
          <g>
            <line x1={x(hover)} x2={x(hover)} y1={pt} y2={H - pb} stroke={EJE} strokeDasharray="3 3" />
            {series.map((s) => s.valores[hover] != null && <circle key={s.id} cx={x(hover)} cy={y(s.valores[hover])} r="5" fill={s.color} stroke="#0A1410" strokeWidth="2" />)}
          </g>)}
        <rect x={pl} y={pt} width={W - pl - pr} height={H - pt - pb} fill="transparent" />
      </svg>}
      {hover != null && (
        <div className="tooltip" style={{ left: `${(x(hover) / W) * 100}%` }}>
          <b>{formatoX(etiquetas[hover], true)}</b>
          {series.map((s) => s.valores[hover] != null && <div key={s.id}><i style={{ background: s.color }} />{s.nombre}<span>{s.valores[hover]}{unidad}</span></div>)}
        </div>)}
      {series.length > 1 && <div className="leyenda-g">{series.map((s) => <span key={s.id}><i style={{ background: s.color }} />{s.nombre}</span>)}</div>}
    </div>
  );
}

/* Barra segmentada horizontal. partes: [{id, nombre, valor, color}] */
export function Segmentos({ partes, alto = 14 }) {
  const [hover, setHover] = useHover();
  const total = partes.reduce((a, p) => a + p.valor, 0);
  if (!total) return <div className="tenue">Sin datos todavía.</div>;
  return (
    <div className="segmentos">
      <div className="seg-barra" style={{ height: alto }} onMouseLeave={() => setHover(null)}>
        {partes.filter((p) => p.valor).map((p) => (
          <span key={p.id} style={{ flex: p.valor, background: p.color }} onMouseEnter={() => setHover(p.id)}
            title={`${p.nombre}: ${p.valor}`} className={hover && hover !== p.id ? "atenuado" : ""} />))}
      </div>
      <div className="leyenda-g">{partes.map((p) => (
        <span key={p.id} className={hover === p.id ? "activo" : ""}><i style={{ background: p.color }} />{p.nombre}<b>{p.valor}</b></span>))}</div>
    </div>
  );
}
