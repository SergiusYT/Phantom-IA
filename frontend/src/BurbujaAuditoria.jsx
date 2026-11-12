import React, { useState } from "react";
import { ETAPAS, estadoAgentes, etapaActual, queHace } from "./flujo.js";
import { AGENTES } from "./Sala.jsx";
import { Ico } from "./ui.jsx";
import { useVivo } from "./vivo.jsx";

/* Burbuja flotante: la auditoría sigue en vivo mientras exploras otras secciones.
   Al tocarla vuelves a la Sala en el mismo punto, sin reiniciar nada. */
export default function BurbujaAuditoria({ enSala, ir }) {
  const vivo = useVivo();
  const [mini, setMini] = useState(false);
  if (!vivo?.id || enSala || !vivo.corriendo) return null;
  const ultimo = vivo.msgs[vivo.msgs.length - 1];
  const etapa = etapaActual(estadoAgentes(vivo.msgs, true), true);
  const ag = AGENTES[ultimo?.agent] || AGENTES.coordinador;
  const abrir = () => ir("sala", vivo.id);
  if (mini) return (
    <button className="burbuja-flot mini" style={{ "--a": ag.color }} onClick={abrir} aria-label="Volver a la auditoría en curso">
      <span className="anillo" /><Ico n={ag.ico} />
    </button>);
  return (
    <div className="burbuja-flot" style={{ "--a": ag.color }} role="status">
      <button className="burbuja-cuerpo" onClick={abrir} aria-label="Volver a la auditoría en curso">
        <span className="burbuja-av"><span className="anillo" /><Ico n={ag.ico} /></span>
        <span className="burbuja-txt">
          <b>{`Auditoría ${vivo.id} · ${ETAPAS[etapa]}`}</b>
          <span>{queHace(ultimo)}</span>
          <i className="burbuja-pasos">{ETAPAS.slice(0, 3).map((e, i) => <em key={e} className={i < etapa ? "seg-hecho" : i === etapa ? "seg-ahora" : ""} />)}</i>
        </span>
      </button>
      <button className="burbuja-min" onClick={() => setMini(true)} aria-label="Minimizar"><Ico n="x" /></button>
    </div>
  );
}
