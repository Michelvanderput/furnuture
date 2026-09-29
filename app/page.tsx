"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CalendarBlank,
  ChartDonut,
  CloudArrowUp,
  CloudCheck,
  CloudSlash,
  DeviceMobile,
  GearSix,
  Hammer,
  Plus,
  ShoppingBag,
  SquaresFour,
  Warning,
  type Icon,
} from "@phosphor-icons/react";
import { AddSheet } from "@/components/AddSheet";
import { AppContext, type App } from "@/components/app";
import { Dashboard } from "@/components/Dashboard";
import { HouseView } from "@/components/HouseView";
import { PlanningView } from "@/components/PlanningView";
import { Armchair, I } from "@/components/icons";
import { ItemSheet } from "@/components/ItemSheet";
import { newTask, RenovationView } from "@/components/RenovationView";
import { RoomsView } from "@/components/RoomsView";
import { RoomView } from "@/components/RoomView";
import { SettingsSheet } from "@/components/SettingsSheet";
import { ShopView } from "@/components/ShopView";
import { TaskSheet } from "@/components/TaskSheet";
import { ToastHost, useToast } from "@/components/ui";
import { HouseGate } from "@/components/HouseGate";
import { NotificationBell } from "@/components/Notifications";
import { Welcome } from "@/components/Welcome";
import { productFromHash } from "@/components/ProductBookmarklet";
import { guessCategory } from "@/lib/categories";
import { firstWorkingThumb } from "@/lib/images";
import { addItems, patchItem } from "@/lib/items";
import { sameLink, titleFromUrl } from "@/lib/products";
import { newId } from "@/lib/rooms";
import type { Item } from "@/lib/types";
import { extractFundaPhotos, shopName, withoutShopName } from "@/lib/extract";
import { clearImportHash, currentHouse, houseKey, importFromHash, leaveHouse, rememberHouse, withHouse, type HouseRef } from "@/lib/houses";
import { href, useRoute, type Route } from "@/lib/route";
import { extractLinks, parsePrice, shortName } from "@/lib/shopping";
import { addTasks } from "@/lib/tasks";
import { clearBadge, ensurePush, registerWorker } from "@/lib/push";
import { useProject, type SyncState } from "@/lib/useProject";

const SYNC_TEXT: Record<SyncState, string> = {
  local: "Bewaard op dit apparaat",
  loading: "Laden…",
  saved: "Online opgeslagen",
  saving: "Opslaan…",
  offline: "Offline: wordt opgeslagen zodra er verbinding is",
  error: "Opslaan mislukt, tik om opnieuw te proberen",
};
const SYNC_ICON: Record<SyncState, Icon> = {
  local: DeviceMobile,
  loading: CloudArrowUp,
  saved: CloudCheck,
  saving: CloudArrowUp,
  offline: CloudSlash,
  error: Warning,
};

export default function Page() {
  return (
    <ToastHost>
      <Root />
    </ToastHost>
  );
}

/** Which house is open: the last one on this device, one from a shared link (?woning=), or ask. */
function Root() {
  const [house, setHouse] = useState<HouseRef | null | undefined>(undefined);
  const [ask, setAsk] = useState<string>();
  // What a tapped notification opens: "item:<id>", "task:<id>" or a view.
  const [open, setOpen] = useState<string>();

  // Notifications need the service worker; a tap while the app is open arrives as a message.
  useEffect(() => {
    registerWorker();
    const onMessage = (e: MessageEvent) => {
      // A notification arrived while the app is open: show it here, and refresh the bell.
      if (e.data?.type === "push") {
        window.dispatchEvent(new CustomEvent("furnuture:push", { detail: e.data }));
        return;
      }
      if (e.data?.type !== "open") return;
      const url = new URL(e.data.url, location.origin);
      const name = url.searchParams.get("woning");
      if (name && houseKey(name) !== currentHouse()?.key) location.href = url.href;
      else setOpen(url.searchParams.get("open") ?? undefined);
    };
    navigator.serviceWorker?.addEventListener("message", onMessage);
    return () => navigator.serviceWorker?.removeEventListener("message", onMessage);
  }, []);

  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const shared = q.get("woning");
    const current = currentHouse();
    if (q.get("open")) {
      setOpen(q.get("open")!);
      q.delete("open");
      history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
    }
    if (shared) {
      q.delete("woning");
      history.replaceState(null, "", location.pathname + (q.size ? `?${q}` : "") + location.hash);
      if (current?.key !== houseKey(shared)) {
        setAsk(shared);
        return setHouse(null);
      }
    }
    setHouse(current);
  }, []);

  if (house === undefined) return <div className="splash">Laden…</div>;
  if (!house) return <HouseGate initialName={ask} onOpen={(ref) => setHouse(rememberHouse(ref))} />;
  return (
    <Home
      key={house.key}
      house={house}
      open={open}
      onOpened={() => setOpen(undefined)}
      onLeave={() => {
        leaveHouse();
        setAsk(undefined);
        setHouse(null);
      }}
    />
  );
}

function Home({ house, open, onOpened, onLeave }: { house: HouseRef; open?: string; onOpened: () => void; onLeave: () => void }) {
  const { project, update, loaded, loadError, sync, syncError, syncNow } = useProject(house);
  const route = useRoute();
  const toast = useToast();
  const [item, setItem] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [add, setAdd] = useState<{ roomId?: string | null; alternativeOf?: string; links?: string[] } | null>(null);
  const [settings, setSettings] = useState(false);


  // Notifications: repair a lost subscription, clear the icon's badge, show pushes that arrive while open.
  useEffect(() => {
    ensurePush(house);
    clearBadge();
    const onVisible = () => document.visibilityState === "visible" && clearBadge();
    const onPush = (e: Event) => {
      const d = (e as CustomEvent<{ title: string; body: string }>).detail;
      toast(d.body ? `${d.title} · ${d.body}` : d.title);
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("furnuture:push", onPush);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("furnuture:push", onPush);
    };
  }, [house, toast]);

  // Opened from a notification: the product or job it is about (once the house is loaded).
  useEffect(() => {
    if (!open || !loaded) return;
    const [kind, id] = open.split(":");
    if (kind === "item" && project.items.some((i) => i.id === id)) setItem(id);
    else if (kind === "task" && project.renovation?.tasks.some((t) => t.id === id)) setTask(id);
    else if (!id) location.hash = open === "overzicht" ? "#/" : `#/${open}`;
    else if (sync === "loading" || sync === "saving") return; // still arriving from the database
    onOpened();
  }, [open, loaded, project, sync, onOpened]);

  // A house sent by the bookmarklet arrives as #import={u,t,p}.
  useEffect(() => {
    if (!loaded || !location.hash.startsWith("#import=")) return;
    const found = importFromHash(extractFundaPhotos);
    if (!found) toast("Importeren vanaf Funda mislukt.");
    else if (!project.listing || confirm(`Deze woning in "${house.name}" laden? Je kamers worden opnieuw ingedeeld; je producten blijven bewaard.`))
      update((p) => withHouse(p, found.url, found.data));
    clearImportHash();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // A product sent by the "Product naar furnuture" bookmark arrives as #product={u,t,p,i}:
  // it goes on the list (or opens, when it is already there) so a room can be picked.
  useEffect(() => {
    if (!loaded) return;
    const got = productFromHash();
    if (!location.hash.startsWith("#product=")) return;
    history.replaceState(null, "", location.pathname + location.search + "#/");
    if (!got) return toast("Het product kon niet worden gelezen.");
    const known = project.items.find((i) => i.url && sameLink(i.url, got.url));
    if (known) return setItem(known.id);
    const shop = shopName(got.url);
    const title = withoutShopName(got.title, shop) || titleFromUrl(got.url) || shop;
    const price = got.price ? parsePrice(got.price) : undefined;
    const item: Item = {
      id: newId(),
      roomId: null,
      title,
      url: got.url,
      shop,
      image: got.image,
      images: got.image ? [got.image] : [],
      price,
      priceHistory: price ? [{ at: new Date().toISOString().slice(0, 10), value: price }] : undefined,
      qty: 1,
      category: guessCategory(title),
      status: "idee",
      note: "",
      addedAt: Date.now(),
      source: "link",
    };
    update(addItems([item]));
    if (got.image) firstWorkingThumb([got.image]).then((r) => r && update(patchItem(item.id, { thumb: r.thumb, image: r.image })));
    setItem(item.id);
    const missing = [!price && "prijs", !got.image && "foto"].filter(Boolean).join(" en ");
    toast(`${shortName(title, 40)} toegevoegd${missing ? ` (geen ${missing} gevonden: vul die hieronder in)` : ""}: kies de kamer`);
    if (got.error) console.warn("Bladwijzer:", got.error);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

  // The house's title in the list of houses on the name screen.
  const title = project.listing?.title;
  useEffect(() => {
    if (loaded && title && title !== house.title) rememberHouse({ ...house, title });
  }, [loaded, title, house]);

  // A link shared to the app (Android share sheet: /?url=… or ?text=…) opens "add".
  useEffect(() => {
    if (!loaded) return;
    const q = new URLSearchParams(location.search);
    const links = extractLinks(`${q.get("url") ?? ""} ${q.get("text") ?? ""}`);
    if (!links.length) return;
    history.replaceState(null, "", location.pathname + location.hash);
    setAdd({ roomId: null, links });
  }, [loaded]);

  // Paste a shop link anywhere (not in a text field): it is added to the room you are looking at.
  const roomId = route.view === "kamer" ? route.id : undefined;
  useEffect(() => {
    const onPaste = (e: ClipboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (add || item) return;
      const links = extractLinks(e.clipboardData?.getData("text") ?? "");
      if (!links.length) return;
      e.preventDefault();
      setAdd({ roomId: roomId ?? null, links });
    };
    document.addEventListener("paste", onPaste);
    return () => document.removeEventListener("paste", onPaste);
  }, [roomId, add, item]);

  const openItem = useCallback((id: string) => setItem(id), []);
  const openTask = useCallback((id: string) => setTask(id), []);
  const openAdd = useCallback((opts?: { roomId?: string | null; alternativeOf?: string; links?: string[] }) => setAdd(opts ?? {}), []);
  const openSettings = useCallback(() => setSettings(true), []);
  const app: App = useMemo(
    () => ({ house, sync, syncError, leave: onLeave, project, update, openItem, openAdd, openTask, openSettings, toast }),
    [house, sync, syncError, onLeave, project, update, openItem, openAdd, openTask, openSettings, toast],
  );

  if (!loaded) return <div className="splash">{house.name} laden…</div>;
  if (loadError) {
    return (
      <div className="splash">
        <div className="stack">
          <I icon={CloudSlash} size={36} />
          <h2>{house.name} is niet te laden</h2>
          <p className="muted">Er is geen verbinding met de online opslag en deze woning staat nog niet op dit apparaat.</p>
          <div className="row wrap-row" style={{ justifyContent: "center" }}>
            <button className="primary" onClick={() => location.reload()}>
              Opnieuw proberen
            </button>
            <button onClick={onLeave}>Andere woning</button>
          </div>
        </div>
      </div>
    );
  }
  if (!project.listing && !project.rooms.length) {
    return (
      <Welcome
        name={house.name}
        onImport={(url, data) => update((p) => withHouse(p, url, data))}
        onBlank={(photos) => update((p) => withHouse(p, "", { title: house.name, photos }))}
        onBack={onLeave}
      />
    );
  }

  const current = route.view === "kamer" && !project.rooms.some((r) => r.id === route.id) ? ({ view: "kamers" } as Route) : route;
  const tabs: { route: Route; label: string; icon: Icon; on: boolean }[] = [
    { route: { view: "overzicht" }, label: "Overzicht", icon: ChartDonut, on: current.view === "overzicht" },
    { route: { view: "kamers" }, label: "Kamers", icon: SquaresFour, on: current.view === "kamers" || current.view === "kamer" },
    { route: { view: "verbouwing" }, label: "Verbouwing", icon: Hammer, on: current.view === "verbouwing" },
    { route: { view: "winkelen" }, label: "Winkelen", icon: ShoppingBag, on: current.view === "winkelen" },
    { route: { view: "planning" }, label: "Planning", icon: CalendarBlank, on: current.view === "planning" },
  ];

  return (
    <AppContext.Provider value={app}>
      <header className="topbar">
        <div className="wrap">
          <a className="brand" href="#/" aria-label="furnuture, naar het overzicht">
            <span className="logo">
              <I icon={Armchair} size={20} weight="bold" />
            </span>
            <span>
              furn<em>u</em>ture
            </span>
          </a>
          <nav className="tabs" aria-label="Hoofdmenu">
            {tabs.map((t) => (
              <a key={t.label} href={href(t.route)} className={t.on ? "on" : ""} aria-current={t.on ? "page" : undefined}>
                <I icon={t.icon} size={22} weight={t.on ? "fill" : "regular"} />
                {t.label}
              </a>
            ))}
          </nav>
          <div className="actions">
            <NotificationBell
              onOpen={(url) => {
                const target = new URL(url, location.origin).searchParams.get("open");
                if (target) {
                  const [kind, id] = target.split(":");
                  if (kind === "item") setItem(id);
                  else if (kind === "task") setTask(id);
                  else location.hash = target === "overzicht" ? "#/" : `#/${target}`;
                }
              }}
            />
            <button className="ghost house-btn" onClick={() => (sync === "offline" || sync === "error" ? syncNow() : setSettings(true))} title={SYNC_TEXT[sync] + (syncError ? `: ${syncError}` : "")} aria-label={`${house.name}. ${SYNC_TEXT[sync]}`}>
              <span className={`sync ${sync}`}>
                <I icon={SYNC_ICON[sync]} size={20} weight={sync === "saved" ? "fill" : "regular"} />
              </span>
              <span className="name">{house.name}</span>
            </button>
            <button className="ghost icon" onClick={() => setSettings(true)} aria-label="Instellingen" title="Woning, meldingen, budget en back-up">
              <I icon={GearSix} size={22} />
            </button>
          </div>
        </div>
      </header>
      <main className="wrap">
        {current.view === "overzicht" && <Dashboard />}
        {current.view === "kamers" && <RoomsView />}
        {current.view === "kamer" && <RoomView key={current.id} roomId={current.id} />}
        {current.view === "verbouwing" && <RenovationView />}
        {current.view === "winkelen" && <ShopView />}
        {current.view === "woning" && <HouseView />}
        {current.view === "planning" && <PlanningView />}
      </main>
      {current.view === "verbouwing" ? (
        <button
          className="fab"
          aria-label="Klus toevoegen"
          onClick={() => {
            const t = newTask();
            update(addTasks([t]));
            setTask(t.id);
          }}
        >
          <I icon={Plus} size={24} weight="bold" />
          <span className="label">Klus</span>
        </button>
      ) : (
        <button className="fab" aria-label="Product toevoegen" onClick={() => setAdd({ roomId: roomId ?? null })}>
          <I icon={Plus} size={24} weight="bold" />
          <span className="label">Toevoegen</span>
        </button>
      )}
      {add && <AddSheet {...add} onClose={() => setAdd(null)} />}
      {item && project.items.some((i) => i.id === item) && <ItemSheet id={item} onClose={() => setItem(null)} />}
      {task && (project.renovation?.tasks ?? []).some((t) => t.id === task) && <TaskSheet id={task} onClose={() => setTask(null)} />}
      {settings && <SettingsSheet onClose={() => setSettings(false)} />}
    </AppContext.Provider>
  );
}
