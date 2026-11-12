import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { api } from "./api.js";
import { esperaPara } from "./flujo.js";

/* Seguimiento de la auditoría en vivo a nivel de toda la consola: sigue corriendo (y reproduciéndose)
   aunque navegues por otras secciones, y la Sala retoma exactamente donde iba. */
const Ctx = createContext(null);

export function VivoProvider({ children }) {
  const [id, setId] = useState(null);
  const [st, setSt] = useState({ status: "running", messages: [] });
  const [err, setErr] = useState("");
  const [mostrados, setMostrados] = useState(null);   // cola de reproducción: cuántos mensajes se ven
  const actual = useRef(null);

  const seguir = useCallback((nuevo, { desdeCero = false } = {}) => {
    if (!nuevo) return;
    if (actual.current === nuevo && !desdeCero) return;   // ya la estoy siguiendo: no reiniciar
    actual.current = nuevo;
    setId(nuevo); setSt({ status: "running", messages: [] }); setErr(""); setMostrados(null);
  }, []);

  // al abrir la consola, si hay una auditoría en curso, se sigue sola
  useEffect(() => {
    api("audits/").then((l) => { const r = l.find((a) => a.status === "running"); if (r) seguir(r.id); }, () => {});
  }, [seguir]);

  useEffect(() => {
    if (!id) return undefined;
    let vivo = true, t;
    const tick = () => api(`audits/${id}/messages/`).then((r) => {
      if (!vivo) return;
      setSt(r); setErr("");
      // terminada al abrirla: se muestra completa; en curso: se reproduce desde el principio
      setMostrados((m) => (m === null ? (r.status === "running" ? 0 : r.messages.length) : m));
      if (r.status === "running" || r.messages.some((m) => m.streaming)) t = setTimeout(tick, 700);
    }, (e) => { if (vivo) { setErr(e.message); t = setTimeout(tick, 2000); } });
    tick();
    return () => { vivo = false; clearTimeout(t); };
  }, [id]);

  const todos = st.messages.map((m) => ({ ...m, audit: id }));
  const visibles = mostrados ?? 0;
  const ultimoVisible = todos[visibles - 1];
  useEffect(() => {
    if (mostrados === null || mostrados >= todos.length) return undefined;
    if (ultimoVisible?.streaming) return undefined;            // espera a que la IA termine de escribir
    const t = setTimeout(() => setMostrados((m) => m + 1), esperaPara(ultimoVisible, todos.length - mostrados));
    return () => clearTimeout(t);
  }, [mostrados, todos.length, ultimoVisible?.streaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const msgs = todos.slice(0, visibles);
  const reproduciendo = visibles < todos.length;
  const valor = {
    id, st, err, todos, msgs, seguir,
    corriendo: !!id && (st.status === "running" || reproduciendo),
    reproduciendo,
    repetir: () => setMostrados(0),
  };
  return <Ctx.Provider value={valor}>{children}</Ctx.Provider>;
}

export const useVivo = () => useContext(Ctx);
