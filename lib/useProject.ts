"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { diff, isEmpty, toRows, snapshot, type Snapshot } from "./db/rows";
import { loadRemote, pending, remoteVersion, RemoteError, saveRemote, snapshotOf, type HouseRef } from "./houses";
import { migrate } from "./migrate";
import { loadProject, markSaved, requestPersistence, saveProject } from "./storage";
import type { Project } from "./types";

export { newId } from "./rooms";

export const EMPTY: Project = { listing: null, rooms: [], items: [] };

/** Quiet time before saving on the device: a burst of changes (typing) becomes one write. */
const SAVE_DELAY = 600;
/** …and before sending to the database. */
const SYNC_DELAY = 1500;
/** How often to look whether another device saved (while the app is open). */
const POLL = 60_000;
const RETRY = 20_000;

/** "local": this device only; "saved": in the database; "offline": waiting to be sent. */
export type SyncState = "local" | "loading" | "saved" | "saving" | "offline" | "error";

/**
 * The project of one house: kept on the device (IndexedDB) and, when the house is in
 * the database, sent there shortly after every change (only the rows that changed).
 * Another device's changes are picked up when the app comes back to the foreground
 * and every minute; both sides' changes are merged per row.
 */
export function useProject(house: HouseRef) {
  const { key, id, name } = house;
  const [project, setProject] = useState<Project>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [sync, setSync] = useState<SyncState>(id ? "loading" : "local");
  const [syncError, setSyncError] = useState("");
  const [loadError, setLoadError] = useState(false);
  const latest = useRef(project);
  latest.current = project;

  // ---- on this device
  const saveTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const dirty = useRef(false);
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    if (!dirty.current) return;
    dirty.current = false;
    saveProject(latest.current, key);
  }, [key]);

  // ---- in the database
  const remote = useRef<{ snap: Snapshot | null; version: string | null }>({ snap: null, version: null });
  /** The project as it came from the database: showing it is not a change to send back. */
  const fromRemote = useRef<Project | null>(null);
  const chain = useRef<Promise<void>>(Promise.resolve());
  const queued = useRef(false);
  const syncTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const retryTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const show = useCallback((p: Project, version: string) => {
    fromRemote.current = p;
    latest.current = p;
    remote.current = { snap: snapshotOf(p, name), version };
    setProject(p);
  }, [name]);

  /** First contact: the database wins, unless this device has changes it has not sent yet. */
  const connect = useCallback(async () => {
    const r = await loadRemote(id!, name);
    if (pending.get(key) && latest.current !== EMPTY) remote.current = { snap: snapshotOf(r.project, name), version: r.updatedAt };
    else show(r.project, r.updatedAt);
  }, [id, key, name, show]);

  const push = useCallback(async () => {
    if (!remote.current.snap) await connect();
    const p = latest.current;
    const { house: h, rows } = toRows(p, name);
    const changes = diff(remote.current.snap, h, rows);
    if (!isEmpty(changes)) {
      setSync("saving");
      const version = await saveRemote(id!, changes);
      remote.current = { snap: snapshot(h, rows), version: version ?? remote.current.version };
    }
    if (latest.current === p) pending.set(key, false);
  }, [connect, id, key, name]);

  const run = useCallback(
    (task: () => Promise<void>) => {
      chain.current = chain.current.then(async () => {
        try {
          await task();
          clearTimeout(retryTimer.current);
          setSync("saved");
          setSyncError("");
        } catch (e) {
          const offline = !(e instanceof RemoteError) || e.status === 0;
          setSync(offline ? "offline" : "error");
          setSyncError(offline ? "" : e.message);
          clearTimeout(retryTimer.current);
          retryTimer.current = setTimeout(() => run(push), RETRY);
        }
      });
      return chain.current;
    },
    [push],
  );

  const syncNow = useCallback(() => {
    clearTimeout(syncTimer.current);
    if (!id || queued.current) return;
    queued.current = true;
    run(async () => {
      queued.current = false;
      await push();
    });
  }, [id, push, run]);

  /** Has another device saved? Then send ours first and load the result. */
  const check = useCallback(() => {
    if (!id) return;
    run(async () => {
      if (!remote.current.snap) return push();
      const known = remote.current.version;
      const version = await remoteVersion(id);
      // Ours first (also what waited while offline): rows both changed end up as ours.
      await push();
      if (version === known) return;
      const before = latest.current;
      const r = await loadRemote(id, name);
      if (latest.current === before) show(r.project, r.updatedAt);
    });
  }, [id, name, push, run, show]);

  // Load: the copy on this device first (instant, offline), then the database.
  useEffect(() => {
    let live = true;
    (async () => {
      const stored = await loadProject(key);
      if (!live) return;
      if (stored) {
        if (stored.current) markSaved(stored.project, key);
        latest.current = stored.project;
        fromRemote.current = stored.project;
        setProject(stored.project);
        if (!stored.current) dirty.current = true;
      }
      if (id) {
        const first = run(connect);
        // Without a copy here, wait for the database: starting empty would overwrite it later.
        if (!stored) {
          await first;
          if (live && !remote.current.snap) setLoadError(true);
        }
      }
      if (!live) return;
      setLoaded(true);
      requestPersistence();
    })();
    return () => {
      live = false;
    };
  }, [key, id, connect, run]);

  useEffect(() => {
    if (!loaded) return;
    dirty.current = true;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(flush, SAVE_DELAY);
    if (!id || project === fromRemote.current) return;
    pending.set(key, true);
    setSync((s) => (s === "saved" ? "saving" : s));
    clearTimeout(syncTimer.current);
    syncTimer.current = setTimeout(syncNow, SYNC_DELAY);
  }, [project, loaded, flush, id, key, syncNow]);

  // Save right away when the page is hidden (iPad Safari may discard background tabs),
  // and look for other devices' changes when it comes back.
  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        flush();
        if (pending.get(key)) syncNow();
      } else check();
    };
    const onHide = () => flush();
    const timer = setInterval(() => document.visibilityState === "visible" && check(), POLL);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", onHide);
    window.addEventListener("online", check);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", onHide);
      window.removeEventListener("online", check);
      clearTimeout(retryTimer.current);
      clearTimeout(syncTimer.current);
    };
  }, [flush, check, syncNow, key]);

  const update = useCallback((fn: (p: Project) => Project) => setProject(fn), []);
  const replace = useCallback((p: unknown) => setProject(migrate(p)), []);

  return { project, update, replace, loaded, loadError, sync, syncError, syncNow };
}
