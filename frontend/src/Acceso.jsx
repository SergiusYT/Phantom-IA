import React, { useEffect, useState } from "react";
import { api, auth } from "./api.js";
import { Busy, Logo } from "./ui.jsx";

const ARRANQUE = [
  ["ok", "kubernetes", "API del clúster accesible · namespace phantom-demo"],
  ["ok", "freebsd/pf", "canal de gestión restringido · operaciones permitidas"],
  ["ok", "agentes", "analista · auditor · planificador listos"],
  ["ok", "controlador", "lista permitida · requiere aprobación"],
  ["wa", "sesión", "esperando credenciales del operador"],
];

export default function Acceso({ onLogin, volver }) {
  const [u, setU] = useState("");
  const [p, setP] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (n < ARRANQUE.length) { const t = setTimeout(() => setN(n + 1), 260); return () => clearTimeout(t); }
  }, [n]);

  const enviar = async (e) => {
    e.preventDefault();
    setBusy(true); setErr("");
    try {
      const r = await api("auth/login/", { method: "POST", body: { username: u, password: p } });
      auth.set(r.token); onLogin(r.user);
    } catch (e2) { setErr(e2.message === "Credenciales invalidas" ? "Usuario o contraseña incorrectos." : e2.message); }
    setBusy(false);
  };

  return (
    <div className="acceso">
      <div className="lado">
        <button className="marca" onClick={volver} style={{ padding: 0 }}><Logo />PHANTOM AI</button>
        <div className="consola-arranque" aria-hidden="true">
          {ARRANQUE.slice(0, n).map(([k, m, t]) => (
            <div key={m}><span className={k}>[{k === "ok" ? " OK " : "ESPERA"}]</span> {m.padEnd(12, " ")} {t}</div>))}
        </div>
        <p className="tenue">Laboratorio aislado de Redes II. No conectar a redes productivas.</p>
      </div>
      <form onSubmit={enviar}>
        <h1 style={{ fontSize: "2rem" }}>Iniciar sesión</h1>
        <p className="tenue" style={{ marginTop: 8 }}>Los operadores aprueban y ejecutan cambios. Los observadores solo consultan.</p>
        {err && <div className="alerta" style={{ marginTop: 18, marginBottom: 0 }}>{err}</div>}
        <label>Usuario<input value={u} onChange={(e) => setU(e.target.value)} autoComplete="username" autoFocus /></label>
        <label>Contraseña<input type="password" value={p} onChange={(e) => setP(e.target.value)} autoComplete="current-password" /></label>
        <button className="btn primary lg" style={{ marginTop: 24, justifyContent: "center" }} disabled={busy || !u || !p}>
          <Busy on={busy}>Entrar a la consola</Busy>
        </button>
        <p className="pista">Demo: <span className="chip">admin</span> operador · <span className="chip">observador</span> solo lectura</p>
      </form>
    </div>
  );
}
