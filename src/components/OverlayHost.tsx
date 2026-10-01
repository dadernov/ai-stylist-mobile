import { createContext, Fragment, ReactNode, useContext, useEffect, useId, useState, useSyncExternalStore } from 'react';

/**
 * Windows the whole app opens — the AI consent, the generation window — must
 * appear over whatever is on screen. iOS presents a modal only from the screen
 * on top: opened from the app root while a sheet is up, it silently never shows
 * (react-native presents from the nearest view controller, and the root one is
 * busy with the sheet). So every sheet that can lead to such a window holds an
 * <OverlayOutlet/>, and these windows are drawn in the topmost one, or at the
 * root when no sheet is open.
 */
class OverlayStore {
  private overlays = new Map<string, ReactNode>();
  private outlets: string[] = [];
  private listeners = new Set<() => void>();
  private version = 0;
  private emit() { this.version += 1; this.listeners.forEach(listener => listener()); }
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  getVersion = () => this.version;
  set(key: string, node: ReactNode) {
    if (node == null || node === false) {
      if (!this.overlays.has(key)) return;
      this.overlays.delete(key);
    } else this.overlays.set(key, node);
    this.emit();
  }
  register(id: string) {
    this.outlets.push(id);
    this.emit();
    return () => { this.outlets = this.outlets.filter(outlet => outlet !== id); this.emit(); };
  }
  top() { return this.outlets[this.outlets.length - 1] ?? null; }
  nodes() { return [...this.overlays.entries()]; }
}

const StoreContext = createContext<OverlayStore | null>(null);
// Where a window is drawn: over the screens at the app root, or over a sheet.
const PlaceContext = createContext<'root' | 'sheet'>('root');

/** 'sheet' when drawn inside a sheet's outlet: a floating window then sits at the sheet's own bottom. */
export const useOverlayPlace = () => useContext(PlaceContext);

export function OverlayProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new OverlayStore());
  return <StoreContext.Provider value={store}>{children}<Outlet store={store} id={null} /></StoreContext.Provider>;
}

/**
 * Shows `node` in the topmost outlet; null or false hides it. Without a
 * provider (tests, a screen on its own) it returns true: draw it in place.
 */
export function useOverlay(key: string, node: ReactNode) {
  const store = useContext(StoreContext);
  useEffect(() => { store?.set(key, node); });
  useEffect(() => () => { store?.set(key, null); }, [store, key]);
  return !store;
}

/** Put inside a sheet's modal: app-wide windows opened while it is on top appear in it. */
export function OverlayOutlet() {
  const store = useContext(StoreContext);
  const id = useId();
  useEffect(() => store?.register(id), [store, id]);
  return store ? <Outlet store={store} id={id} /> : null;
}

function Outlet({ store, id }: { store: OverlayStore; id: string | null }) {
  useSyncExternalStore(store.subscribe, store.getVersion, store.getVersion);
  if (store.top() !== id) return null;
  return <PlaceContext.Provider value={id === null ? 'root' : 'sheet'}>
    {store.nodes().map(([key, node]) => <Fragment key={key}>{node}</Fragment>)}
  </PlaceContext.Provider>;
}
