import { createContext, ReactNode, useContext, useEffect, useMemo, useSyncExternalStore } from 'react';
import { Session } from '../services/auth';
import { TryOnJobStore } from '../services/tryOnJobs';

const Context = createContext<{ store: TryOnJobStore; login: string } | null>(null);
export function TryOnJobsProvider({ session, children }: { session: Session; children: ReactNode }) {
  const store = useMemo(() => new TryOnJobStore(session), [session.login]);
  useEffect(() => { void store.activate(session); return () => store.deactivate(); }, [store, session.token]);
  const value = useMemo(() => ({ store, login: session.login }), [store, session.login]);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}
export function useTryOnJobs() {
  const context = useContext(Context);
  if (!context) throw new Error('Missing try-on jobs provider');
  const snapshot = useSyncExternalStore(context.store.subscribe, context.store.getSnapshot, context.store.getSnapshot);
  return { ...context, ...snapshot };
}
