import React from "react";
import {
  siDjango, siDocker, siFreebsd, siK3s, siKubernetes, siNginx, siOllama, siPostgresql, siPython, siReact,
} from "simple-icons";

/* Logos oficiales (simple-icons, CC0). Los colores muy oscuros se aclaran para el fondo negro. */
export const TECH = {
  kubernetes: { icon: siKubernetes, nombre: "Kubernetes" },
  docker: { icon: siDocker, nombre: "Docker" },
  freebsd: { icon: siFreebsd, nombre: "FreeBSD", color: "#E0453D" },
  k3s: { icon: siK3s, nombre: "k3s" },
  nginx: { icon: siNginx, nombre: "Nginx", color: "#1FBF5A" },
  python: { icon: siPython, nombre: "Python", color: "#5A9FD4" },
  postgres: { icon: siPostgresql, nombre: "PostgreSQL", color: "#6C9BEF" },
  ollama: { icon: siOllama, nombre: "Ollama", color: "#F2FFF8" },
  django: { icon: siDjango, nombre: "Django", color: "#44B78B" },
  react: { icon: siReact, nombre: "React" },
};

// app de laboratorio -> tecnologia que la ejecuta
export const APP_TECH = { frontend: "nginx", api: "python", db: "postgres" };
export const APP_NOMBRE = { frontend: "Web", api: "API", db: "Base de datos" };

export const techColor = (n) => TECH[n]?.color || `#${TECH[n]?.icon.hex}`;

export function Tech({ n, size = 20, title, style }) {
  const t = TECH[n];
  if (!t) return null;
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="img" aria-label={title || t.nombre} style={{ flex: "none", ...style }}>
      <path d={t.icon.path} fill={techColor(n)} />
    </svg>
  );
}

// Para usar dentro de otro <svg>: logo centrado en (x, y)
export function TechG({ n, x, y, size = 22, opacity = 1 }) {
  const t = TECH[n];
  if (!t) return null;
  return (
    <svg x={x - size / 2} y={y - size / 2} width={size} height={size} viewBox="0 0 24 24" opacity={opacity}>
      <path d={t.icon.path} fill={techColor(n)} />
    </svg>
  );
}
