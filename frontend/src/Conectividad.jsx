import React, { useEffect, useState } from "react";
import { api } from "./api.js";
import { APPS, matrizK8s, puertasFirewall, resumen } from "./conectividad.js";
import { APP_NOMBRE, APP_TECH, Tech } from "./tech.jsx";
import { Busy, Ico, fecha, useLoad } from "./ui.jsx";

const ROL = {
  reenvio: ["Reenvía a la app", "El firewall pasa el tráfico al clúster"],
  gestion: ["Gestión SSH", "Protegido: PHANTOM nunca lo bloquea"],
  sobra: ["Sobra", "Servicio innecesario expuesto"],
  bloqueado: ["Bloqueado por PHANTOM", "Regla en el anchor «phantom»"],
  permitido: ["Permitido", "Autorizado por la política"],
  cerrado: ["Cerrado", "No hay servicio"],
};
const RES = { ok: ["check", "cumple"], mal: ["x", "fuera de política"], sin: ["info", "sin probar"] };

function Puerta({ p, probando }) {
  const [titulo, sub] = ROL[p.rol];
  const est = probando ? "probando" : p.estado;
  return (
    <div className={`cx-puerta ${p.rol} ${est}`}>
      <div className="cx-puerto">{p.port}<small>/tcp</small></div>
      <div className="cx-rol"><b>{titulo}</b><span>{p.destino ? `→ ${p.destino}` : sub}</span></div>
      <div className={`cx-res ${est}`}>
        {probando ? <><span className="spin" />probando…</> : <><Ico n={RES[p.estado][0]} />
          {p.prueba ? (p.prueba.reachable ? "responde" : "bloqueado") : RES.sin[1]}</>}
      </div>
    </div>
  );
}

function Perimetro({ fw, results, probando }) {
  const puertas = puertasFirewall(fw, results);
  return (
    <div className="panel cx-zona cx-fw">
      <div className="cx-cab">
        <Tech n="freebsd" size={40} />
        <div><h3>Perímetro · Firewall FreeBSD</h3>
          <span className="tenue">{fw ? <>PF <b className={fw.enabled ? "ok-t" : "mal-t"}>{fw.enabled ? "activo" : "inactivo"}</b> en <span className="num">{fw.host}</span></> : "sin datos del firewall"}</span></div>
      </div>
      <div className="cx-ruta">
        <span className="cx-nodo"><Ico n="red" />Internet</span>
        <i className="cx-flecha" />
        <span className="cx-nodo fw"><Tech n="freebsd" size={16} />PF</span>
        <i className="cx-flecha" />
        <span className="cx-nodo"><Tech n="kubernetes" size={16} />Clúster k3d</span>
      </div>
      <div className="cx-puertas">{puertas.map((p) => <Puerta key={p.port} p={p} probando={probando} />)}</div>
      {fw?.rules?.length > 0 && (
        <details className="cx-reglas">
          <summary><Ico n="muro" />Reglas reales de PF ({fw.rules.length}) · anchor «phantom»: {fw.anchor?.length || 0}</summary>
          <pre>{fw.rules.join("\n")}{fw.anchor?.length ? `\n\n# anchor "phantom" (lo que PHANTOM agregó)\n${fw.anchor.join("\n")}` : "\n\n# anchor \"phantom\": vacío"}</pre>
        </details>)}
    </div>
  );
}

function Interior({ results, politicas, probando }) {
  const m = matrizK8s(results);
  const abierta = politicas.some((p) => p.name === "allow-all");
  return (
    <div className="panel cx-zona">
      <div className="cx-cab">
        <Tech n="kubernetes" size={40} />
        <div><h3>Interior · Kubernetes</h3><span className="tenue">Quién puede hablar con quién dentro del clúster</span></div>
      </div>
      <div className="cx-matriz" role="table" aria-label="Matriz de alcanzabilidad">
        <div className="cx-esq">desde ↓ · hacia →</div>
        {APPS.map((b) => <div key={b} className="cx-colh"><Tech n={APP_TECH[b]} size={16} />{APP_NOMBRE[b]}</div>)}
        {APPS.map((a) => (
          <React.Fragment key={a}>
            <div className="cx-filh"><Tech n={APP_TECH[a]} size={16} />{APP_NOMBRE[a]}</div>
            {APPS.map((b) => {
              const c = m[a][b];
              if (c.mismo) return <div key={b} className="cx-celda mismo" />;
              const st = probando && c.estado !== "sin" ? "probando" : c.estado;
              return (
                <div key={b} className={`cx-celda ${st}`}>
                  {st === "probando" ? <span className="spin" /> : c.estado === "sin" ? <span className="tenue">—</span>
                    : <><Ico n={c.reachable ? (c.estado === "ok" ? "check" : "x") : "muro"} /><span>{c.reachable ? "responde" : "bloqueado"}</span>
                      <small>{c.expect ? "debe pasar" : "debe bloquearse"}</small></>}
                </div>);
            })}
          </React.Fragment>))}
      </div>
      <div className="cx-pols">
        <span className="tenue">NetworkPolicies:</span>
        {politicas.length ? politicas.map((p) => (
          <span key={p.name} className={`chip ${p.name === "allow-all" ? "mal" : "ok"}`}>{p.name}</span>))
          : <span className="chip mal">ninguna: todo abierto</span>}
        {abierta && <span className="mal-t" style={{ fontSize: 12.5 }}>deja pasar todo el tráfico interno</span>}
      </div>
    </div>
  );
}

export default function Conectividad({ aviso }) {
  const runs = useLoad(() => api("connectivity/"));
  const topo = useLoad(() => api("topology/"));
  const [busy, setBusy] = useState(false);
  const [revelados, setRevelados] = useState(null);     // animación: cuántos resultados ya se muestran
  const ult = runs.data?.[0];
  const results = ult?.results || [];

  useEffect(() => {
    if (revelados === null || revelados >= results.length) return undefined;
    const t = setTimeout(() => setRevelados((n) => n + 1), 320);
    return () => clearTimeout(t);
  }, [revelados, results.length]);

  const correr = async () => {
    setBusy(true); setRevelados(0);
    try {
      const r = await api("connectivity/", { method: "POST" });
      await Promise.all([runs.reload(), topo.reload()]);
      aviso(r.passed ? "Todos los flujos cumplen la política" : "Hay flujos fuera de la política", !r.passed);
    } catch (e) { aviso(e.message, true); setRevelados(null); }
    setBusy(false);
  };
  const animando = revelados !== null && revelados < results.length;
  const visibles = animando ? results.slice(0, revelados) : results;
  const sumario = resumen(results);
  const historial = (runs.data || []).slice(0, 24).reverse();

  return (
    <>
      <div className="cabeza"><div><h1>Conectividad</h1><p>¿Pasa lo que debe pasar y se bloquea lo que debe bloquearse? Pruebas reales en el perímetro FreeBSD y dentro de Kubernetes.</p></div>
        <button className="btn primary" onClick={correr} disabled={busy || animando}><Busy on={busy}>{!busy && <Ico n="pulso" />}Ejecutar pruebas</Busy></button></div>
      {(runs.error || topo.error) && <div className="alerta">{runs.error || topo.error}</div>}
      {ult && !busy && !animando && (
        <div className={`cx-veredicto ${ult.passed ? "ok" : "mal"}`}>
          <Ico n={ult.passed ? "check" : "x"} />
          <div><b>{ult.passed ? "Cumple la política" : `${sumario.mal.length} ${sumario.mal.length === 1 ? "flujo fuera" : "flujos fuera"} de la política`}</b>
            <span>{sumario.ok} de {sumario.total} flujos correctos · {fecha(ult.created_at)}</span></div>
          {!ult.passed && <div className="cx-malos">{sumario.mal.map((r) => <span key={r.id} className="chip mal">{r.name}</span>)}</div>}
        </div>)}
      <div className="cx-zonas">
        <Perimetro fw={topo.data?.firewall} results={busy ? [] : results} probando={busy} />
        <Interior results={busy ? [] : results} politicas={topo.data?.network_policies || []} probando={busy} />
      </div>
      <div className="rejilla r-21">
        <div className="panel">
          <div className="panel-cab"><h3>Cada flujo probado</h3>{(busy || animando) && <span className="vivo-tag"><span className="led ok" />probando</span>}</div>
          {busy ? <div className="cx-lista">{["Interior: Web → API", "Interior: API → Datos", "Interior: Web → Datos", "Perímetro: Internet → :80", "Perímetro: Internet → :443", "Perímetro: Internet → :8081", "Perímetro: gestión SSH :22"].map((t) => (
            <div key={t} className="cx-fila probando"><span className="spin" /><span>{t}</span><span className="tenue">probando…</span></div>))}</div>
            : results.length ? <div className="cx-lista">{visibles.map((r) => (
              <div key={r.id} className={`cx-fila ${r.ok ? "ok" : "mal"}`}>
                <Tech n={r.layer === "perimetro" ? "freebsd" : "kubernetes"} size={18} />
                <span className="num">{r.name}</span>
                <span className="tenue">{r.expect ? "debe pasar" : "debe bloquearse"}</span>
                <b className={r.ok ? "ok-t" : "mal-t"}><Ico n={r.ok ? "check" : "x"} />{r.reachable === null ? "error" : r.reachable ? "responde" : "bloqueado"}</b>
              </div>))}
              {animando && <div className="cx-fila probando"><span className="spin" /><span>Revisando el siguiente flujo…</span></div>}</div>
              : <div className="vacio">Aún no se han ejecutado pruebas.</div>}
        </div>
        <div className="panel">
          <h3>Historial</h3>
          {historial.length ? <>
            <div className="cx-barras" role="img" aria-label="Flujos correctos en cada ejecución">
              {historial.map((r) => {
                const ok = r.results.filter((t) => t.ok).length;
                return <i key={r.id} title={`${fecha(r.created_at)}: ${ok}/${r.results.length}`} className={r.passed ? "ok" : "mal"} style={{ height: `${Math.max(8, (ok / Math.max(1, r.results.length)) * 100)}%` }} />;
              })}
            </div>
            <table><tbody>{(runs.data || []).slice(0, 8).map((r) => (
              <tr key={r.id}><td>{fecha(r.created_at)}</td><td className="num">{r.results.filter((t) => t.ok).length}/{r.results.length}</td>
                <td><span className={`led ${r.passed ? "ok" : "mal"}`} /></td></tr>))}</tbody></table>
          </> : <div className="vacio">Sin ejecuciones.</div>}
        </div>
      </div>
    </>
  );
}
