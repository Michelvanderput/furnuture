"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChartDonut, GearSix, Hammer, House, Plus, ShoppingBag, SquaresFour, type Icon } from "@phosphor-icons/react";
import { AddSheet } from "@/components/AddSheet";
import { AppContext, type App } from "@/components/app";
import { Dashboard } from "@/components/Dashboard";
import { HouseView } from "@/components/HouseView";
import { Armchair, I } from "@/components/icons";
import { ItemSheet } from "@/components/ItemSheet";
import { newTask, RenovationView } from "@/components/RenovationView";
import { RoomsView } from "@/components/RoomsView";
import { RoomView } from "@/components/RoomView";
import { SettingsSheet } from "@/components/SettingsSheet";
import { ShopView } from "@/components/ShopView";
import { TaskSheet } from "@/components/TaskSheet";
import { ToastHost, useToast } from "@/components/ui";
import { Welcome } from "@/components/Welcome";
import { extractFundaPhotos } from "@/lib/extract";
import { falEnabled } from "@/lib/fal";
import { assignPhotos, defaultRooms, newId } from "@/lib/rooms";
import { href, useRoute, type Route } from "@/lib/route";
import { extractLinks } from "@/lib/shopping";
import { addTasks } from "@/lib/tasks";
import type { FundaResult, Listing, Project, RoomType } from "@/lib/types";
import { useProject } from "@/lib/useProject";

export default function Page() {
  return (
    <ToastHost>
      <Home />
    </ToastHost>
  );
}

/** A house from Funda (or photos) as the project's listing, with a first set of rooms. */
function withHouse(p: Project, url: string, data: FundaResult): Project {
  const listing: Listing = {
    url,
    title: data.title || "Ons nieuwe huis",
    photos: data.photos.map((u) => ({ id: newId(), url: u, room: (data.rooms?.[u] ?? "overig") as RoomType })),
    facts: data.facts,
    description: data.description,
  };
  const rooms = defaultRooms(listing);
  // Items of an earlier house stay on the list, without a room.
  return { ...p, listing: { ...listing, photos: assignPhotos(listing.photos, rooms) }, rooms, items: p.items.map((i) => ({ ...i, roomId: null })) };
}

function Home() {
  const { project, update, loaded } = useProject();
  const route = useRoute();
  const toast = useToast();
  const [fal, setFal] = useState(false);
  const [item, setItem] = useState<string | null>(null);
  const [task, setTask] = useState<string | null>(null);
  const [add, setAdd] = useState<{ roomId?: string | null; alternativeOf?: string; links?: string[] } | null>(null);
  const [settings, setSettings] = useState(false);

  useEffect(() => void falEnabled().then(setFal), []);

  // A house sent by the bookmarklet arrives as #import={u,t,p}.
  useEffect(() => {
    if (!loaded || !location.hash.startsWith("#import=")) return;
    try {
      const data = JSON.parse(decodeURIComponent(location.hash.slice(8))) as { u: string; t: string; p: string[] };
      const photos = extractFundaPhotos(data.p.join(" "));
      if (photos.length && (!project.listing || confirm("Deze woning laden? Je kamers worden opnieuw ingedeeld; je producten blijven bewaard."))) {
        const title = data.t.replace(/\s*[|\-[]\s*funda.*$/i, "").replace(/^[^:]{0,30}:\s*/, "").trim();
        update((p) => withHouse(p, data.u, { title, photos }));
      }
    } catch {
      toast("Importeren vanaf Funda mislukt.");
    }
    history.replaceState(null, "", location.pathname + "#/");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);

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
  const app: App = useMemo(() => ({ project, update, openItem, openAdd, openTask, toast, fal }), [project, update, openItem, openAdd, openTask, toast, fal]);

  if (!loaded) return <div className="splash">Laden…</div>;
  if (!project.listing && !project.rooms.length) {
    return (
      <Welcome
        onImport={(url, data) => update((p) => withHouse(p, url, data))}
        onBlank={(name, photos) =>
          update((p) =>
            withHouse(p, "", { title: name, photos }),
          )
        }
      />
    );
  }

  const current = route.view === "kamer" && !project.rooms.some((r) => r.id === route.id) ? ({ view: "kamers" } as Route) : route;
  const tabs: { route: Route; label: string; icon: Icon; on: boolean }[] = [
    { route: { view: "overzicht" }, label: "Overzicht", icon: ChartDonut, on: current.view === "overzicht" },
    { route: { view: "kamers" }, label: "Kamers", icon: SquaresFour, on: current.view === "kamers" || current.view === "kamer" },
    { route: { view: "verbouwing" }, label: "Verbouwing", icon: Hammer, on: current.view === "verbouwing" },
    { route: { view: "winkelen" }, label: "Winkelen", icon: ShoppingBag, on: current.view === "winkelen" },
    { route: { view: "woning" }, label: "Woning", icon: House, on: current.view === "woning" },
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
            <button className="ghost icon" onClick={() => setSettings(true)} aria-label="Instellingen" title="Budget, stijl, AI en back-up">
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
