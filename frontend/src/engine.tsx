import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { isAbort, waitForBackend, type Health } from "./api";
import { useI18n } from "./i18n";

/** Decision models the demos can switch between; both get the same questions. */
export type Engine = "laya" | "jev";

export const ENGINES: Engine[] = ["laya", "jev"];
export const ENGINE_NAMES: Record<Engine, string> = { laya: "LAYA", jev: "Jev" };
const DEFAULT_ENGINE: Engine = "laya";
const ENGINE_KEY = "laya-demo:engine";

type ReadyHealth = Health & { engines: NonNullable<Health["engines"]> };

export type Backend = { state: "checking" | "offline" } | { state: "ready"; health: ReadyHealth };

function readStoredEngine(): Engine {
  try {
    const stored = window.localStorage.getItem(ENGINE_KEY);
    return ENGINES.includes(stored as Engine) ? (stored as Engine) : DEFAULT_ENGINE;
  } catch {
    return DEFAULT_ENGINE;
  }
}

export function engineAvailable(backend: Backend, engine: Engine): boolean {
  return backend.state === "ready" && backend.health.engines[engine].available;
}

type EngineContextValue = {
  backend: Backend;
  /** The model requests go to: the chosen one, or LAYA while the choice is unavailable. */
  engine: Engine;
  setEngine: (engine: Engine) => void;
};

const EngineContext = createContext<EngineContextValue | null>(null);

/** Waits for the backend once and remembers which model is being tested. */
export function EngineProvider({ children }: { children: ReactNode }) {
  const [backend, setBackend] = useState<Backend>({ state: "checking" });
  const [chosen, setChosen] = useState<Engine>(readStoredEngine);

  useEffect(() => {
    const controller = new AbortController();
    waitForBackend(controller.signal, () => setBackend({ state: "offline" }))
      // A backend started before the Jev switch existed reports no engines.
      .then((health) => setBackend({
        state: "ready",
        health: {
          ...health,
          engines: health.engines ?? {
            laya: { model: health.model, available: true },
            jev: { model: "typesafe/jev-1.13", available: false },
          },
        },
      }))
      .catch((reason) => {
        if (!isAbort(reason)) setBackend({ state: "offline" });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ENGINE_KEY, chosen);
    } catch {
      // The switch still works for this visit if storage is unavailable.
    }
  }, [chosen]);

  // Keep the stored choice: Jev comes back once the backend has an API key.
  const engine = chosen === DEFAULT_ENGINE || engineAvailable(backend, chosen) ? chosen : DEFAULT_ENGINE;
  const value = useMemo(() => ({ backend, engine, setEngine: setChosen }), [backend, engine]);
  return <EngineContext.Provider value={value}>{children}</EngineContext.Provider>;
}

export function useEngine(): EngineContextValue {
  const value = useContext(EngineContext);
  if (!value) throw new Error("useEngine must be used inside EngineProvider");
  return value;
}

export function EngineSwitch() {
  const { t } = useI18n();
  const { backend, engine, setEngine } = useEngine();
  return (
    <div className="lang-switch engine-switch" role="group" aria-label={t.engine.label}>
      {ENGINES.map((option) => {
        const info = backend.state === "ready" ? backend.health.engines[option] : null;
        return (
          <button
            type="button"
            key={option}
            aria-pressed={engine === option}
            disabled={option !== DEFAULT_ENGINE && !info?.available}
            title={info ? (info.available ? info.model : t.engine.jevMissing) : undefined}
            onClick={() => setEngine(option)}
          >
            {ENGINE_NAMES[option]}
          </button>
        );
      })}
    </div>
  );
}
