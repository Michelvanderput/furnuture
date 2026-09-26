"use client";

import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { removeBackgroundAI } from "@/lib/ai";
import { exportFileName } from "@/lib/backup";
import { renderDesign, shareOrDownload } from "@/lib/exportImage";
import { centroid, pointInPolygon, project as projectPoint, quadToMatrix3d, rectQuad } from "@/lib/geometry";
import { cropCenter, loadImage, NoPlainBackground, proxied, releaseUrl, removeBackground, rotatedTexture } from "@/lib/images";
import { eraseLayerId, renderErased } from "@/lib/inpaint";
import { fingerprintOf, getCached, putCached } from "@/lib/aiCache";
import {
  floorMetric,
  isFloor,
  placeOnFloor,
  planeOf,
  rulerOf,
  SURFACE_CATEGORIES,
  fillFor,
  surfaceDefaults,
} from "@/lib/layers";
import { workSize } from "@/lib/labels";
import { distanceCm, footprint, formatCm } from "@/lib/metric";
import { Selector } from "@/lib/sam";
import { linkedView, linkFromPoints, photoToPlan, planLayersFor, scanFurniture } from "@/lib/floorplan";
import { defaultSize, planForPhoto, plansOf, updateItem, updatePlan } from "@/lib/plans";
import { photoLightSide, photoLook, productFilter, sideShade } from "@/lib/look";
import { dilate, dropSpecks, fillHoles, interiorPoints, loadHitMask, maskHit, maskToDataUrl, paintCircle, polygonMask, rememberMask } from "@/lib/masks";
import { extendedPlane, fitFloorQuad, fitWallQuad, fitWallQuads, imageToPlane, PLANE, planeToImage } from "@/lib/plane";
import { cachedSegmentation, furnitureMask, segmentMask, segmentRoom, type RoomSegmentation, type Segment, type SegmentKind } from "@/lib/segment";
import { presetTexture } from "@/lib/textures";
import { surfaceShading } from "@/lib/shading";
import type { EraseLayer, FloorAnchor, Layer, MeasureLayer, Product, ProductLayer, Project, Pt, Quad, SurfaceFill, SurfaceLayer } from "@/lib/types";
import { newId } from "@/lib/useProject";
import { fetchProduct, sameLink } from "@/lib/products";
import { designList } from "@/lib/shopping";
import { useSceneEditor } from "@/lib/useSceneEditor";
import { heavyAiAllowed } from "@/lib/worker";
import { Img } from "./Img";
import { LayerControls, type LayerPatch } from "./LayerControls";
import { PlanItemControls } from "./PlanItemControls";
import { LinkPanel } from "./visualizer/LinkPanel";
import { Palette } from "./visualizer/Palette";
import { PhotoStrip } from "./visualizer/PhotoStrip";
import { MeasureLabel, RulerPrompt } from "./visualizer/Measure";
import { Shadow } from "./visualizer/Shadow";

interface Props {
  project: Project;
  update: (fn: (p: Project) => Project) => void;
  photoId: string | null;
  setPhotoId: (id: string) => void;
}

/** Rendered size of a product image before it is mapped onto its corners. */
const PRODUCT_W = 1000;

type Drawing = { kind: "surface" | "erase" | "measure"; points: Pt[]; fill?: SurfaceFill; thenMeasure?: boolean; thenLink?: boolean };

/** What the user tapped: from the room recognition, or traced exactly by tap-to-select (SAM). */
interface Selection {
  kind: SegmentKind | "object";
  label: string;
  /** Mask at the recognition's working resolution. */
  mask: Uint8Array;
  w: number;
  h: number;
  url: string;
  /** Taps so far (fractions of the photo), for adding or removing parts. */
  points: { at: [number, number]; positive: boolean }[];
}
type Drag =
  | { type: "move"; id: string; from: Pt; start: Quad }
  | { type: "corner"; id: string; from: Pt; start: Quad; index: number; distort: boolean }
  | { type: "anchor-move"; id: string; q0: Pt; start: FloorAnchor; toPlane: number[] }
  | { type: "anchor-scale"; id: string; from: Pt; center: Pt; start: FloorAnchor }
  | { type: "vertex"; id: string; index: number }
  | { type: "plane"; id: string; index: number }
  | { type: "plan-move"; itemId: string; q0: Pt; start: Pt };

// Room recognition results live in memory only (a few seconds to recompute).
const segmentations = new Map<string, RoomSegmentation>();
/** Keeps the most recent photos' recognition in memory (each is ~1 MB); older ones come from the cache. */
function rememberSegmentation(photoId: string, seg: RoomSegmentation) {
  segmentations.delete(photoId);
  segmentations.set(photoId, seg);
  while (segmentations.size > 6) segmentations.delete(segmentations.keys().next().value!);
}

// Mask PNGs for drawn erase areas, so floors and walls can also cover them.
// Made at working size (CSS scales them) and bounded: they used to be photo-sized and kept forever.
const polygonMaskUrls = new Map<string, string>();
function polygonMaskUrl(points: Pt[], w: number, h: number): string {
  const key = `${w}x${h}:${JSON.stringify(points)}`;
  let url = polygonMaskUrls.get(key);
  if (!url) {
    const ws = workSize(w, h);
    const f = ws.w / w;
    url = maskToDataUrl(polygonMask(points.map(([x, y]) => [x * f, y * f]), ws.w, ws.h), ws.w, ws.h);
    polygonMaskUrls.set(key, url);
    while (polygonMaskUrls.size > 30) polygonMaskUrls.delete(polygonMaskUrls.keys().next().value!);
  }
  return url;
}

/** Natural size of a photo, loaded directly (fast) with the proxy as fallback. */
function measure(url: string): Promise<{ w: number; h: number }> {
  const load = (src: string) =>
    new Promise<{ w: number; h: number }>((resolve, reject) => {
      const img = new Image();
      img.referrerPolicy = "no-referrer";
      img.onload = () => resolve({ w: img.naturalWidth, h: img.naturalHeight });
      img.onerror = reject;
      img.src = src;
    });
  return load(url).catch(() => load(proxied(url)));
}

const isTyping = (t: EventTarget | null) =>
  t instanceof HTMLElement && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName));

export function Visualizer({ project, update, photoId, setPhotoId }: Props) {
  const photos = useMemo(
    () => (project.listing?.photos ?? []).filter((p) => p.room !== "plattegrond" && p.room !== "buitenkant"),
    [project.listing],
  );
  const photo = photos.find((p) => p.id === photoId) ?? photos[0];
  const editor = useSceneEditor(photo?.id, project, update);
  const productById = useMemo(() => new Map(project.products.map((p) => [p.id, p])), [project.products]);
  const photoIdRef = useRef(photo?.id);
  photoIdRef.current = photo?.id;
  const { layers, setLayers } = editor;

  const [size, setSize] = useState<{ w: number; h: number } | null>(null);
  const [displayWidth, setDisplayWidth] = useState(0);
  const [selected, setSelected] = useState<string | null>(null);
  const [drawing, setDrawing] = useState<Drawing | null>(null);
  const [showLayers, setShowLayers] = useState(true);
  const [cutouts, setCutouts] = useState<Record<string, string>>({});
  const [textures, setTextures] = useState<Record<string, string>>({});
  const [erased, setErased] = useState<{ key: string; url: string } | null>(null);
  const [lightSide, setLightSide] = useState(0);
  const [preview, setPreview] = useState(false);
  const [rotated, setRotated] = useState<Record<string, string>>({});
  const [shading, setShading] = useState<Record<string, { multiply: string; screen: string }>>({});
  const [status, setStatus] = useState("");
  const [notice, setNotice] = useState("");
  const [segmentation, setSegmentation] = useState<RoomSegmentation | null>(null);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [refine, setRefine] = useState<"add" | "remove" | "brush-add" | "brush-remove" | null>(null);
  const [brushSize, setBrushSize] = useState(3);
  const [brushAt, setBrushAt] = useState<Pt | null>(null);
  const brush = useRef<{ mask: Uint8Array; w: number; h: number; value: 0 | 1; last: Pt | null } | null>(null);
  const brushFrame = useRef(0);
  const [rulerFor, setRulerFor] = useState<string | null>(null);
  const selector = useRef<Selector | null>(null);
  const [linking, setLinking] = useState(false);
  const [aspects, setAspects] = useState<Record<string, number>>({});
  const selectRun = useRef(0);
  const [exporting, setExporting] = useState(false);
  const drag = useRef<Drag | null>(null);
  const pending = useRef<Pt | null>(null);
  const frame = useRef(0);
  const svgRef = useRef<SVGSVGElement>(null);
  const stageRef = useRef<HTMLDivElement>(null);
  const coarse = useMemo(() => typeof window !== "undefined" && matchMedia("(pointer: coarse)").matches, []);
  const handleRadius = () => (size ? Math.max(9, size.w / 110) : 10) * (coarse ? 1.7 : 1);

  useEffect(() => {
    setSize(null);
    setSelected(null);
    setDrawing(null);
    setErased(null);
    setSelection(null);
    setRefine(null);
    setRulerFor(null);
    setLinking(false);
    setNotice("");
    setSegmentation(photo ? (segmentations.get(photo.id) ?? null) : null);
    // Recognised before (another visit)? Show the objects right away, without AI.
    if (photo && !segmentations.has(photo.id)) {
      const id = photo.id;
      cachedSegmentation(photo.url).then((seg) => {
        if (!seg) return;
        rememberSegmentation(id, seg);
        setSegmentation((cur) => cur ?? (photoIdRef.current === id ? seg : null));
      });
    }
    selector.current?.close();
    setLightSide(0);
    if (!photo) return;
    photoLightSide(photo.url).then(setLightSide).catch(() => undefined);
    measure(photo.url)
      .then(setSize)
      .catch(() => setSize({ w: 1440, h: 960 }));
  }, [photo?.id, photo?.url]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => selector.current?.close(), []);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDisplayWidth(el.clientWidth));
    ro.observe(el);
    return () => ro.disconnect();
  }, [size]);

  // Decode stored masks so taps can hit them.
  useEffect(() => {
    for (const l of layers) if ((l.kind === "surface" || l.kind === "erase") && l.mask) loadHitMask(l.mask).catch(() => undefined);
  }, [layers]);


  // Free a replaced erased photo (object URLs stay in memory until revoked).
  useEffect(() => () => releaseUrl(erased?.url), [erased]);

  // Cut-outs and textures that no scene uses any more (an old tolerance, a deleted
  // layer) are freed; they used to pile up for as long as the tab was open.
  /** Cut-out identity: product, method and the product photo (choosing another photo makes a new cut-out). */
  const cutKey = (productId: string, l: { cutout: ProductLayer["cutout"]; tolerance: number }) => {
    const image = productById.get(productId)?.image ?? "";
    return `${l.cutout === "ai" ? "ai" : `simple:${l.tolerance}`}:${productId}:${fingerprintOf(image)}`;
  };
  const layerCutKey = (l: ProductLayer) => cutKey(l.productId, l);

  const usedImages = useMemo(() => {
    const keys = new Set<string>();
    for (const l of [...Object.values(project.scenes).flatMap((sc) => sc.layers), ...layers]) {
      if (l.kind === "product" && l.cutout !== "off") keys.add(layerCutKey(l));
      if (l.kind === "surface" && l.fill.type === "texture") keys.add(`${l.fill.productId}:${l.crop}`);
    }
    // Furniture on the floor plans is cut out the same way (see planLayersFor).
    for (const it of (project.plans ?? []).flatMap((pl) => pl.items)) {
      if (it.cutout !== "off") keys.add(cutKey(it.productId, it));
    }
    return keys;
  }, [project.scenes, project.plans, layers, productById]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const prune = (map: Record<string, string>) => {
      const stale = Object.keys(map).filter((k) => !usedImages.has(k));
      if (!stale.length) return map;
      const next = { ...map };
      for (const k of stale) (releaseUrl(next[k]), delete next[k]);
      return next;
    };
    setCutouts(prune);
    setTextures(prune);
  }, [usedImages]);
  const imagesRef = useRef({ cutouts, textures });
  imagesRef.current = { cutouts, textures };
  useEffect(
    () => () => {
      for (const u of [...Object.values(imagesRef.current.cutouts), ...Object.values(imagesRef.current.textures)]) releaseUrl(u);
    },
    [],
  );

  // Product photos used as texture, cropped to their centre.
  useEffect(() => {
    for (const layer of layers) {
      if (layer.kind !== "surface" || layer.fill.type !== "texture") continue;
      const productId = layer.fill.productId;
      const product = project.products.find((p) => p.id === productId);
      const key = `${productId}:${layer.crop}`;
      if (!product?.image || textures[key]) continue;
      setTextures((t) => ({ ...t, [key]: "pending" }));
      cropCenter(product.image, layer.crop)
        .then((url) =>
          setTextures((t) => {
            if (!(key in t)) return (releaseUrl(url), t);
            return { ...t, [key]: url };
          }),
        )
        .catch(() => setTextures((t) => ({ ...t, [key]: proxied(product.image) })));
    }
  }, [layers, project.products, textures]);

  // Where the floor is (photo pixels): a laid or recognised floor. Erasing then fills
  // floor from floor and wall from wall, so the skirting line stays straight.
  const recognisedFloor = useMemo(() => {
    const seg = segmentation;
    const floorSeg = seg?.segments.find((x) => x.kind === "floor");
    if (!seg || !floorSeg || !size) return undefined;
    const quad = fitFloorQuad(segmentMask(seg, floorSeg.id), seg.w, seg.h, furnitureMask(seg));
    return quad?.map(([x, y]) => [(x * size.w) / seg.w, (y * size.h) / seg.h] as Pt);
  }, [segmentation, size]);
  const floorOutline = useRef<Pt[] | undefined>(undefined);
  const laidFloor = layers.find((l): l is SurfaceLayer => isFloor(l));
  floorOutline.current = (laidFloor && planeOf(laidFloor)) || recognisedFloor;

  // The photo with existing furniture painted out.
  const eraseLayers = useMemo(
    () => layers.filter((l): l is EraseLayer => l.kind === "erase" && (!!l.mask || l.points.length >= 3)),
    [layers],
  );
  const eraseKey = useMemo(() => eraseLayers.map(eraseLayerId).join("|"), [eraseLayers]);
  useEffect(() => {
    if (!photo || !eraseKey) return;
    let cancelled = false;
    setStatus("Gummen…");
    // Let the status paint before the fill blocks the page briefly.
    const t = setTimeout(() => {
      renderErased(photo.url, eraseLayers, (m) => !cancelled && setStatus(m || "Gummen…"), floorOutline.current)
        .then(({ url, aiFailed }) => {
          if (cancelled) return;
          setErased({ key: eraseKey, url });
          if (aiFailed) setNotice("De AI-gum kon niet starten (download of geheugen); er is snel gegumd.");
        })
        .catch(() => undefined)
        .finally(() => !cancelled && setStatus(""));
    }, 30);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [photo?.url, eraseKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const patchLayer = (id: string, patch: LayerPatch) =>
    setLayers((ls) => ls.map((l) => (l.id === id ? ({ ...l, ...patch } as Layer) : l)));

  const toPhoto = (e: { clientX: number; clientY: number }): Pt => {
    const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(svgRef.current!.getScreenCTM()!.inverse());
    return [pt.x, pt.y];
  };

  const floors = useMemo(() => layers.filter(isFloor), [layers]);
  const products = useMemo(() => project.products.filter((p) => p.status !== "afgewezen" && (p.image || p.color)), [project.products]);
  const furniture = useMemo(() => products.filter((p) => p.image && !SURFACE_CATEGORIES.has(p.category)), [products]);
  const surfaces = useMemo(() => products.filter((p) => SURFACE_CATEGORIES.has(p.category)), [products]);
  const edited = useMemo(
    () => new Set(Object.entries(project.scenes).filter(([, s]) => s.layers.length).map(([id]) => id)),
    [project.scenes],
  );

  // ---- Floor plan: furniture placed on the plan shows up in every linked photo.
  const plans = plansOf(project);
  const linkedPlan = planForPhoto(project, photo?.id);
  const plan = linkedPlan ?? plans[0];
  const link = linkedPlan && photo ? linkedPlan.links[photo.id] : undefined;
  const linkFloor = link ? layers.find((l) => l.id === link.floorId) : undefined;
  const linkQuad = linkFloor?.kind === "surface" ? planeOf(linkFloor) : null;
  const view = useMemo(
    () => (link && linkQuad && size ? linkedView(link, linkQuad, size.w, size.h) : null),
    [link, linkQuad, size],
  );
  // Aspect ratio of product photos (height from the photo when the product's height is unknown).
  useEffect(() => {
    for (const it of linkedPlan?.items ?? []) {
      const p = productById.get(it.productId);
      if (!p?.image || aspects[p.id]) continue;
      setAspects((a) => ({ ...a, [p.id]: 0.45 }));
      loadImage(proxied(p.image))
        .then((img) => setAspects((a) => ({ ...a, [p.id]: img.naturalHeight / img.naturalWidth })))
        .catch(() => undefined);
    }
  }, [linkedPlan?.items, productById, aspects]);
  const planLayers = useMemo(
    () => (linkedPlan && view ? planLayersFor(linkedPlan, view, (id) => aspects[id] ?? 0.45) : []),
    [linkedPlan, view, aspects],
  );
  const allLayers = useMemo(() => [...layers, ...planLayers], [layers, planLayers]);

  // Room light and shadow for textured floors and walls (see lib/shading.ts). Recomputed
  // shortly after the surface or the erased photo changes, not on every drag frame.
  const background = erased && erased.key === eraseKey && eraseKey ? erased.url : photo?.url;
  useEffect(() => {
    if (!size || !background) return;
    const timer = setTimeout(() => {
      for (const l of layers) {
        if (l.kind !== "surface" || (l.fill.type !== "texture" && l.fill.type !== "preset")) continue;
        if (!l.mask && l.points.length < 3) continue;
        const id = l.id;
        surfaceShading(background, l.mask ? { mask: l.mask } : { points: l.points }, size.w, size.h)
          .then((maps) => setShading((m) => (m[id] === maps ? m : { ...m, [id]: maps })))
          .catch(() => undefined);
      }
    }, 150);
    return () => clearTimeout(timer);
  }, [layers, background, size]);

  // Products in this design. Keyed on the ids, so dragging does not re-render the palette.
  const designIds = allLayers
    .map((l) => (l.kind === "product" ? l.productId : l.kind === "surface" && l.fill.type === "texture" ? l.fill.productId : ""))
    .filter(Boolean)
    .sort()
    .join(",");
  const design = useMemo(() => designList(designIds ? designIds.split(",") : [], project.products), [designIds, project.products]);

  // Background-free product images (simple colour flood fill, or AI). Started after
  // a short pause, so dragging the tolerance slider does not start a job per step.
  useEffect(() => {
    const timer = setTimeout(() => startCutouts(), 250);
    return () => clearTimeout(timer);
  }, [allLayers, project.products, cutouts]); // eslint-disable-line react-hooks/exhaustive-deps

  function startCutouts() {
    for (const layer of allLayers) {
      if (layer.kind !== "product" || layer.cutout === "off") continue;
      const key = layerCutKey(layer);
      if (cutouts[key]) continue;
      const product = productById.get(layer.productId);
      if (!product?.image) continue;
      setCutouts((c) => ({ ...c, [key]: "pending" }));
      makeCutout(product.image, layer.cutout, layer.tolerance)
        .then((url) =>
          setCutouts((c) => {
            if (!(key in c)) return (releaseUrl(url), c); // no longer needed
            releaseUrl(c[key]);
            return { ...c, [key]: url };
          }),
        )
        .catch((e) => setCutouts((c) => (key in c ? { ...c, [key]: e instanceof NoPlainBackground ? "failed:plain" : "failed" } : c)));
    }
  }

  /**
   * A product photo without background, as an object URL. Remembered across
   * visits (AI cut-outs take seconds and a 45 MB model). When the quick cut-out
   * finds no plain background (a sfeerfoto), the AI does it instead where the
   * device can handle it.
   */
  async function makeCutout(image: string, mode: ProductLayer["cutout"], tolerance: number): Promise<string> {
    const ai = heavyAiAllowed();
    const cacheKey = (m: string) => `cut2:${m}:${fingerprintOf(image)}`; // cut2: packshot shadows kept as soft shadows
    const fromCache = async (m: string) => {
      const blob = await getCached<Blob>(cacheKey(m));
      return blob instanceof Blob ? URL.createObjectURL(blob) : null;
    };
    const remember = async (m: string, url: string) => {
      putCached(cacheKey(m), await (await fetch(url)).blob());
      return url;
    };
    const viaAi = async () =>
      (await fromCache("ai")) ?? remember("ai", await removeBackgroundAI(image, setStatus).finally(() => setStatus("")));
    // The AI cut-out is too heavy for iPad Safari: use the simple one there.
    if (mode === "ai" && ai) return viaAi();
    const simple = `simple${tolerance}`;
    const hit = await fromCache(simple);
    if (hit) return hit;
    try {
      return await remember(simple, await removeBackground(image, tolerance));
    } catch (e) {
      if (e instanceof NoPlainBackground && ai) return viaAi();
      throw e;
    }
  }

  /** Links this photo to the plan from the two far floor corners tapped on it. */
  function linkPhoto(L: Pt, R: Pt) {
    if (!photo || !size || !plan) return;
    const floor = (link && floors.find((f) => f.id === link.floorId)) ?? floors.at(-1);
    const quad = floor && planeOf(floor);
    if (!floor || !quad) return;
    const planQuad = linkFromPoints(L, R, quad, size.w, size.h);
    const lenPx = Math.hypot(R[0] - L[0], R[1] - L[1]);
    const metric = floorMetric(layers, floor.id);
    // Scale travels both ways: a measured photo scales the plan, a scaled plan measures the photo.
    const cmPerPx = plan.cmPerPx ?? (metric ? distanceCm(quad, metric, quad[0], quad[1]) / lenPx : undefined);
    if (plan.cmPerPx && !rulerOf(layers, floor.id)) {
      setLayers((ls) => [...ls, { kind: "measure", id: newId(), points: [quad[0], quad[1]], floorId: floor.id, cm: Math.round(lenPx * plan.cmPerPx!), imageW: size.w, imageH: size.h }]);
    }
    const newLink = { floorId: floor.id, plan: planQuad, imageW: size.w, imageH: size.h };
    const newView = linkedView(newLink, quad, size.w, size.h);
    const scanned = segmentation && newView ? scanFurniture(segmentation, newView, size.w, size.h, [planQuad[0], planQuad[1]]).map((s) => ({ ...s, photoId: photo.id })) : [];
    update((p) => ({
      ...p,
      plans: plansOf(p).map((pl) => {
        // A photo belongs to one plan: drop an old link elsewhere.
        const links = { ...pl.links };
        delete links[photo.id];
        const others = (pl.scanned ?? []).filter((s) => s.photoId !== photo.id);
        return pl.id === plan.id ? { ...pl, cmPerPx, links: { ...links, [photo.id]: newLink }, scanned: [...others, ...scanned] } : { ...pl, links, scanned: others };
      }),
    }));
  }

  function unlinkPhoto() {
    if (!photo || !linkedPlan) return;
    updatePlan(update, linkedPlan.id, (pl) => {
      const links = { ...pl.links };
      delete links[photo.id];
      return { ...pl, links, scanned: (pl.scanned ?? []).filter((s) => s.photoId !== photo.id) };
    });
  }

  /** Open the link panel: needs a floor with perspective in this photo (recognised, or 4 tapped corners). */
  async function openLinking() {
    setSelected(null);
    setSelection(null);
    if (!floors.length) {
      const seg = segmentation ?? (await detect());
      const floorSeg = seg?.segments.find((s) => s.kind === "floor");
      const sel = floorSeg && selectionFromSegment(floorSeg, seg);
      if (sel) surfaceFromSelection(sel, { type: "none" }, "floor", seg);
      else {
        setNotice("Geen vloer gevonden. Tik de 4 hoeken van een rechthoekig stuk vloer aan.");
        setDrawing({ kind: "surface", points: [], fill: { type: "none" }, thenLink: true });
        return;
      }
      setSelected(null);
    }
    setLinking(true);
  }

  async function detect(): Promise<RoomSegmentation | null> {
    if (!photo) return null;
    setNotice("");
    try {
      const seg = await segmentRoom(photo.url, setStatus);
      rememberSegmentation(photo.id, seg);
      setSegmentation(seg);
      if (!seg.segments.length) setNotice("Geen meubels, muren of vloer herkend op deze foto.");
      return seg;
    } catch (e) {
      setStatus("");
      setNotice(`Herkennen mislukt: ${e instanceof Error ? e.message : e}`);
      return null;
    }
  }

  /** Working size of selection masks: the recognition's, or the same formula for tap-to-select. */
  const maskSize = () => (segmentation ? { w: segmentation.w, h: segmentation.h } : workSize(size?.w ?? 1440, size?.h ?? 960));

  function selectionFromSegment(seg: Segment, from: RoomSegmentation | null = segmentation): Selection | null {
    if (!from) return null;
    const mask = segmentMask(from, seg.id);
    return { kind: seg.kind, label: seg.label, mask, w: from.w, h: from.h, url: maskUrl(mask, from.w, from.h), points: [] };
  }

  function maskUrl(mask: Uint8Array, w: number, h: number) {
    const url = maskToDataUrl(mask, w, h);
    rememberMask(url, w, h, mask);
    return url;
  }

  function segmentAt(p: Pt): Segment | undefined {
    if (!segmentation || !size) return undefined;
    const sx = Math.min(segmentation.w - 1, Math.max(0, Math.round((p[0] * segmentation.w) / size.w)));
    const sy = Math.min(segmentation.h - 1, Math.max(0, Math.round((p[1] * segmentation.h) / size.h)));
    const id = segmentation.ids[sy * segmentation.w + sx];
    return segmentation.segments.find((s) => s.id === id);
  }

  /**
   * Tap on the photo: floors and walls come from the recognition; furniture (or
   * anything, when the room was not recognised) is traced exactly with tap-to-select.
   *
   * For furniture the recognised segment helps SAM: a few extra taps spread over
   * the segment make it take the whole sofa rather than one cushion, and the
   * result is joined with the segment, holes filled and loose specks dropped.
   * "Add"/"remove" taps change the current selection by the piece that was tapped.
   */
  async function selectAt(p: Pt, mode: "new" | "add" | "remove" = "new") {
    if (!photo || !size) return;
    const seg = segmentAt(p);
    if (mode === "new" && seg && seg.kind !== "furniture") {
      setSelection(selectionFromSegment(seg));
      return;
    }
    const at: [number, number] = [p[0] / size.w, p[1] / size.h];
    const { w, h } = maskSize();
    const tap: [number, number] = [Math.min(w - 1, at[0] * w), Math.min(h - 1, at[1] * h)];
    const segMask = seg?.kind === "furniture" && segmentation && segmentation.w === w && segmentation.h === h ? segmentMask(segmentation, seg.id) : null;
    const extra = segMask && mode !== "remove" ? interiorPoints(segMask, w, h, 3, tap).map(([x, y]) => ({ at: [x / w, y / h] as [number, number], positive: true })) : [];
    const points = [{ at, positive: true }, ...extra];
    // The recognised piece's outline, a little wider, as a box for SAM (not when cutting a piece off).
    let box: [number, number, number, number] | undefined;
    if (segMask && mode !== "remove") {
      let x0 = w, y0 = h, x1 = -1, y1 = -1;
      for (let i = 0; i < segMask.length; i++) {
        if (!segMask[i]) continue;
        const x = i % w, y = (i / w) | 0;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
      const px = (x1 - x0) * 0.08, py = (y1 - y0) * 0.08;
      if (x1 > x0) box = [Math.max(0, x0 - px) / w, Math.max(0, y0 - py) / h, Math.min(w, x1 + px) / w, Math.min(h, y1 + py) / h];
    }
    const run = ++selectRun.current;
    selector.current ??= new Selector();
    try {
      let piece = await selector.current.select(photo.url, points, w, h, setStatus, box);
      if (run !== selectRun.current) return; // a newer tap won
      // Join the recognised piece where it touches SAM's outline (fills gaps, but no stray blobs elsewhere).
      if (segMask && mode !== "remove") {
        const near = dilate(piece, w, h, Math.max(2, Math.round(w * 0.02)));
        for (let i = 0; i < piece.length; i++) if (segMask[i] && near[i]) piece[i] = 1;
      }
      if (!piece.some(Boolean)) throw new Error("niets gevonden");
      piece = dropSpecks(fillHoles(piece, w, h), w, h, tap);
      const prev = mode !== "new" && selection && selection.w === w && selection.h === h ? selection.mask : null;
      let mask = piece;
      if (prev && mode === "add") mask = fillHoles(prev.map((v, i) => v | piece[i]), w, h);
      if (prev && mode === "remove") mask = prev.map((v, i) => (piece[i] ? 0 : v));
      setSelection({
        kind: mode === "new" ? (seg ? "furniture" : "object") : (selection?.kind ?? "object"),
        label: mode === "new" ? (seg?.label ?? "Voorwerp") : (selection?.label ?? "Voorwerp"),
        mask,
        w,
        h,
        url: maskUrl(mask, w, h),
        points: [...(mode === "new" ? [] : (selection?.points ?? [])), { at, positive: mode !== "remove" }],
      });
    } catch (e) {
      if (run !== selectRun.current) return;
      setStatus("");
      if (mode !== "new") setNotice(`Aanpassen lukte niet (${e instanceof Error ? e.message : e}). Gebruik de kwast.`);
      else if (seg) setSelection(selectionFromSegment(seg));
      else setNotice(`Selecteren lukte niet (${e instanceof Error ? e.message : e}). Probeer ✨ Herken of 🧽 Zelf gummen.`);
    }
  }

  /** Brush on the selection: paint a stroke into its mask (work resolution), redrawn once per frame. */
  function brushTo(p: Pt) {
    const b = brush.current;
    if (!b || !size) return;
    const sx = b.w / size.w, sy = b.h / size.h;
    const q: Pt = [p[0] * sx, p[1] * sy];
    const r = Math.max(1, (brushSize / 100) * b.w);
    const from = b.last ?? q;
    const steps = Math.max(1, Math.ceil(Math.hypot(q[0] - from[0], q[1] - from[1]) / (r / 2)));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      paintCircle(b.mask, b.w, b.h, from[0] + (q[0] - from[0]) * t, from[1] + (q[1] - from[1]) * t, r, b.value);
    }
    b.last = q;
    setBrushAt(p);
    if (brushFrame.current) return;
    brushFrame.current = requestAnimationFrame(() => {
      brushFrame.current = 0;
      const c = brush.current;
      if (c) setSelection((s) => (s ? { ...s, mask: c.mask, url: maskToDataUrl(c.mask, c.w, c.h) } : s));
    });
  }

  function endBrush() {
    const b = brush.current;
    if (!b) return;
    cancelAnimationFrame(brushFrame.current);
    brushFrame.current = 0;
    brush.current = null;
    setBrushAt(null);
    const mask = b.mask.slice();
    setSelection((s) => (s ? { ...s, mask, url: maskUrl(mask, b.w, b.h) } : s));
  }

  function eraseSelection(sel: Selection, method: "ai" | "simple") {
    setLayers((ls) => [{ kind: "erase", id: newId(), points: [], mask: sel.url, method, label: sel.label }, ...ls]);
    setSelection(null);
    setRefine(null);
  }

  /** Floor or wall from a selection, with a fitted perspective plane. */
  function surfaceFromSelection(
    sel: Selection,
    fill: SurfaceFill,
    role: "floor" | "wall" = sel.kind === "floor" ? "floor" : "wall",
    from: RoomSegmentation | null = segmentation,
  ): string {
    // Furniture hides floor and wall edges: leave those out when fitting the perspective.
    const occluder = from && from.w === sel.w && from.h === sel.h ? furnitureMask(from) : undefined;
    // Masks are at a lower resolution than the photo: scale planes up.
    const sx = (size?.w ?? sel.w) / sel.w;
    const sy = (size?.h ?? sel.h) / sel.h;
    const up = (q: Quad) => q.map(([x, y]) => [x * sx, y * sy]) as Quad;
    const textured = fill.type === "preset" || fill.type === "texture";
    // Wood, tiles or wallpaper on walls that meet in a corner: one layer per wall, each with its own perspective.
    if (role === "wall" && textured) {
      const parts = fitWallQuads(sel.mask, sel.w, sel.h, occluder);
      if (parts.length > 1) {
        const ids = parts.map((part) => {
          const m = new Uint8Array(sel.mask.length);
          for (let y = 0; y < sel.h; y++) for (let x = part.x0; x <= part.x1; x++) m[y * sel.w + x] = sel.mask[y * sel.w + x];
          const id = newId();
          insertSurface({
            kind: "surface", id, points: [], mask: maskUrl(m, sel.w, sel.h), plane: up(part.quad), role, fill,
            ...surfaceDefaults(fill), scale: 350, perspective: true, crop: 1,
          });
          return id;
        });
        setSelection(null);
        setRefine(null);
        setSelected(ids[0]);
        return ids[0];
      }
    }
    const fitted = role === "floor" ? fitFloorQuad(sel.mask, sel.w, sel.h, occluder) : fitWallQuad(sel.mask, sel.w, sel.h, occluder);
    const plane = fitted && up(fitted);
    const id = newId();
    insertSurface({
      kind: "surface",
      id,
      points: [],
      mask: sel.url,
      plane: plane ?? undefined,
      role,
      fill,
      ...surfaceDefaults(fill),
      scale: 350,
      perspective: !!plane && (fill.type === "preset" || fill.type === "texture"),
      crop: 1,
    });
    setSelection(null);
    setRefine(null);
    setSelected(id);
    return id;
  }

  function insertSurface(layer: SurfaceLayer) {
    // Surfaces go below products so furniture stands "on" the new floor.
    setLayers((ls) => {
      const firstProduct = ls.findIndex((l) => l.kind === "product");
      const at = firstProduct === -1 ? ls.length : firstProduct;
      return [...ls.slice(0, at), layer, ...ls.slice(at)];
    });
  }

  async function addProduct(product: Product) {
    if (!size || !product.image || !photo) return;
    // Linked to a floor plan with a scale: the product goes on the plan, and so into every linked photo.
    if (linkedPlan && view && linkQuad && link) {
      if (!linkedPlan.cmPerPx) {
        setNotice("Stel de schaal van de plattegrond in (tab Plattegrond → 📏 Schaal) of meet de vloer, dan staat dit meubel in alle foto's.");
      } else {
        const spot = photoToPlan(view, projectPoint(planeToImage(linkQuad), [PLANE / 2, PLANE * 0.6]));
        const [L, R] = link.plan;
        const len = Math.hypot(R[0] - L[0], R[1] - L[1]) || 1;
        const facing: Pt = [-(R[1] - L[1]) / len, (R[0] - L[0]) / len]; // towards the camera
        const angle = ((Math.atan2(facing[0], facing[1]) * 180) / Math.PI + 360) % 360;
        const look = await photoLook(photo.url).catch(() => ({ light: 1, warmth: 0 }));
        const id = newId();
        updatePlan(update, linkedPlan.id, (pl) => ({
          ...pl,
          items: [...pl.items, { id, productId: product.id, x: spot[0], y: spot[1], angle, ...defaultSize(product), flip: false, cutout: "simple", tolerance: 18, shadow: 0.5, ...look }],
        }));
        setSelected(`plan:${id}`);
        return;
      }
    }
    let aspect = 1;
    try {
      const img = await loadImage(proxied(product.image));
      aspect = img.naturalHeight / img.naturalWidth;
    } catch {
      /* keep square */
    }
    const width = size.w * 0.3;
    const height = width * aspect;
    const look = await photoLook(photo.url).catch(() => ({ light: 1, warmth: 0 }));
    let layer: ProductLayer = {
      kind: "product",
      id: newId(),
      productId: product.id,
      corners: rectQuad(size.w / 2 - width / 2, size.h * 0.6 - height / 2, width, height),
      aspect,
      flip: false,
      cutout: "simple",
      tolerance: 18,
      distort: false,
      // Match the room's light, and add a soft shadow.
      ...look,
      shadow: 0.5,
    };
    // With a floor in the room, stand on it: perspective and depth come for free.
    const floor = floors.at(-1);
    if (floor) {
      layer = placeOnFloor(layer, floor, projectPoint(planeToImage(planeOf(floor)!), [PLANE / 2, PLANE * 0.65]));
      // Measured floor + known size: true size right away.
      if (product.dims?.w && metricOf(floor.id) && layer.floor) layer.floor.widthCm = product.dims.w;
    }
    setLayers((ls) => [...ls, layer]);
    setSelected(layer.id);
  }

  /** Floors, paint and presets: fill the selected area or recognised floor/wall, or start drawing one. */
  function applyFill(fill: SurfaceFill) {
    const current = layers.find((l) => l.id === selected);
    if (current?.kind === "surface") {
      patchLayer(current.id, { fill, ...surfaceDefaults(fill), perspective: !!planeOf(current) && fill.type !== "color" });
    } else if (selection && selection.kind !== "furniture") {
      surfaceFromSelection(selection, fill, selection.kind === "floor" || (selection.kind === "object" && fill.type !== "color") ? "floor" : "wall");
    } else {
      setSelected(null);
      setDrawing({ kind: "surface", points: [], fill });
    }
  }

  /** A link pasted while decorating: fetch it, add it to Producten, and put it in the room. */
  async function addLink(url: string): Promise<string | void> {
    const known = project.products.find((p) => sameLink(p.url, url));
    if (known) return known.image ? addProduct(known) : "Dit product heeft nog geen foto: voeg die toe bij Producten.";
    const { product, error } = await fetchProduct(url, photo?.room);
    update((p) => ({ ...p, products: [...p.products, product] }));
    if (error || !product.image) return `${error ?? "Geen foto gevonden"} — de link staat bij Producten; voeg daar een foto toe.`;
    if (SURFACE_CATEGORIES.has(product.category)) {
      applyFill(fillFor(product));
      return;
    }
    await addProduct(product);
  }

  function favoriteAll() {
    const ids = new Set(design.items.map((x) => x.product.id));
    update((p) => ({ ...p, products: p.products.map((x) => (ids.has(x.id) ? { ...x, status: "favoriet" } : x)) }));
  }

  // Stable callbacks for the memoised palette (it must not re-render during drags).
  const latest = useRef({ addProduct, applyFill, addLink, favoriteAll });
  latest.current = { addProduct, applyFill, addLink, favoriteAll };
  const onAddLink = useCallback((url: string) => latest.current.addLink(url), []);
  const onFavoriteAll = useCallback(() => latest.current.favoriteAll(), []);
  const onAddProduct = useCallback((p: Product) => latest.current.addProduct(p), []);
  const onFill = useCallback((f: SurfaceFill) => latest.current.applyFill(f), []);
  const onPickPhoto = useCallback((id: string) => setPhotoId(id), [setPhotoId]);

  function finishDrawing() {
    if (!drawing || drawing.points.length < 3 || drawing.kind === "measure") return;
    const id = newId();
    if (drawing.kind === "erase") {
      setLayers((ls) => [{ kind: "erase", id, points: drawing.points, method: "ai" }, ...ls]);
    } else {
      const fill = drawing.fill ?? { type: "color", color: products.find((p) => p.color)?.color ?? "#9fb3a3" };
      const four = drawing.points.length === 4;
      insertSurface({
        kind: "surface",
        id,
        points: drawing.points,
        fill,
        ...surfaceDefaults(fill),
        scale: four ? 350 : Math.round((size?.w ?? 1000) / 4),
        perspective: four,
        crop: 1,
        role: fill.type === "color" ? "wall" : drawing.fill ? "floor" : undefined,
      });
    }
    if (drawing.thenMeasure) {
      setSelected(null);
      setDrawing({ kind: "measure", points: [] });
      return;
    }
    if (drawing.thenLink) {
      setSelected(null);
      setDrawing(null);
      setLinking(true);
      return;
    }
    setDrawing(null);
    setSelected(id);
  }

  function removeSelected() {
    if (!selected) return;
    if (selected.startsWith("plan:") && linkedPlan) {
      const itemId = selected.slice(5);
      updatePlan(update, linkedPlan.id, (pl) => ({ ...pl, items: pl.items.filter((i) => i.id !== itemId) }));
      setSelected(null);
      return;
    }
    setLayers((ls) => ls.filter((l) => l.id !== selected));
    setSelected(null);
  }

  function duplicateSelected() {
    if (selected?.startsWith("plan:") && linkedPlan) {
      const item = linkedPlan.items.find((i) => i.id === selected.slice(5));
      if (!item) return;
      const id = newId();
      const shift = 30 / (linkedPlan.cmPerPx ?? 1);
      updatePlan(update, linkedPlan.id, (pl) => ({ ...pl, items: [...pl.items, { ...item, id, x: item.x + shift, y: item.y + shift }] }));
      setSelected(`plan:${id}`);
      return;
    }
    const l = layers.find((x) => x.id === selected);
    if (!l || l.kind === "erase" || l.kind === "measure") return;
    const id = newId();
    const offset = (size?.w ?? 1000) * 0.04;
    const copy: Layer =
      l.kind === "product"
        ? l.floor
          ? { ...l, id, floor: { ...l.floor, u: l.floor.u + 60 } }
          : { ...l, id, corners: l.corners.map(([x, y]) => [x + offset, y]) as Quad }
        : { ...l, id };
    setLayers((ls) => [...ls, copy]);
    setSelected(id);
  }

  function nudge(dx: number, dy: number) {
    const l = layers.find((x) => x.id === selected);
    if (l?.kind !== "product") return;
    if (l.floor) patchLayer(l.id, { floor: { ...l.floor, u: l.floor.u + dx * 2, v: l.floor.v + dy * 2 } });
    else patchLayer(l.id, { corners: l.corners.map(([x, y]) => [x + dx, y + dy]) as Quad });
  }

  // Keyboard: undo/redo, delete, duplicate, escape, arrow keys.
  const keys = useRef<(e: KeyboardEvent) => void>(() => undefined);
  keys.current = (e: KeyboardEvent) => {
    if (isTyping(e.target)) return;
    const mod = e.metaKey || e.ctrlKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") (e.preventDefault(), e.shiftKey ? editor.redo() : editor.undo());
    else if (mod && k === "y") (e.preventDefault(), editor.redo());
    else if (mod && k === "d") (e.preventDefault(), duplicateSelected());
    else if (k === "escape") (setDrawing(null), setSelected(null), setSelection(null), setRefine(null), setRulerFor(null));
    else if ((k === "delete" || k === "backspace") && selected) (e.preventDefault(), removeSelected());
    else if (k === "enter" && drawing) finishDrawing();
    else if (k.startsWith("arrow") && selected) {
      e.preventDefault();
      const step = e.shiftKey ? 10 : 2;
      nudge(k === "arrowleft" ? -step : k === "arrowright" ? step : 0, k === "arrowup" ? -step : k === "arrowdown" ? step : 0);
    }
  };
  useEffect(() => {
    const h = (e: KeyboardEvent) => keys.current(e);
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, []);

  /** Topmost layer under a point. */
  function hitLayer(p: Pt): Layer | undefined {
    if (!size) return undefined;
    for (const l of [...allLayers].reverse()) {
      if (l.kind === "measure") {
        if (distanceToSegment(p, l.points[0], l.points[1]) < handleRadius() * 1.3) return l;
        continue;
      }
      if (l.kind === "surface" && l.fill.type === "none") continue; // measure-only floor: never in the way
      if (l.kind === "product" && pointInPolygon(p, l.corners)) return l;
      if (l.kind !== "product") {
        if (l.mask) {
          if (maskHit(l.mask, p[0], p[1], size.w, size.h)) return l;
        } else if (l.points.length >= 3 && pointInPolygon(p, l.points)) return l;
      }
    }
    return undefined;
  }

  function startDrag(d: Drag, e: React.PointerEvent) {
    drag.current = d;
    // Keep receiving moves even when the finger leaves the photo.
    svgRef.current?.setPointerCapture?.(e.pointerId);
    editor.beginDrag();
  }

  function endDrag() {
    cancelAnimationFrame(frame.current);
    if (pending.current && drag.current) applyDrag(pending.current);
    pending.current = null;
    drag.current = null;
    editor.endDrag();
  }

  function onPointerDown(e: React.PointerEvent) {
    if (preview) {
      setPreview(false); // a tap brings the tools back
      return;
    }
    const p = toPhoto(e);
    if (drawing) {
      if (e.target !== e.currentTarget) return;
      const points = [...drawing.points, p];
      if (drawing.kind === "measure" && points.length === 2) finishMeasure(points);
      else setDrawing({ ...drawing, points });
      return;
    }
    if (e.target !== e.currentTarget) return; // handles
    if (refine && selection) {
      if (refine === "brush-add" || refine === "brush-remove") {
        brush.current = { mask: selection.mask.slice(), w: selection.w, h: selection.h, value: refine === "brush-add" ? 1 : 0, last: null };
        svgRef.current?.setPointerCapture?.(e.pointerId);
        brushTo(p);
      } else selectAt(p, refine);
      return;
    }
    const hit = hitLayer(p);
    if (hit) {
      setSelected(hit.id);
      setSelection(null);
      if (hit.kind === "product" && hit.planItem && view && linkedPlan) {
        const item = linkedPlan.items.find((i) => i.id === hit.planItem);
        if (item) startDrag({ type: "plan-move", itemId: item.id, q0: photoToPlan(view, p), start: [item.x, item.y] }, e);
      } else if (hit.kind === "product") {
        const floor = hit.floor && layers.find((l) => l.id === hit.floor!.planeId);
        if (hit.floor && floor?.kind === "surface" && planeOf(floor)) {
          const toPlane = imageToPlane(planeOf(floor)!);
          startDrag({ type: "anchor-move", id: hit.id, q0: projectPoint(toPlane, p), start: hit.floor, toPlane }, e);
        } else {
          startDrag({ type: "move", id: hit.id, from: p, start: hit.corners }, e);
        }
      }
      return;
    }
    // A tap next to a selected layer only deselects it; otherwise select what was tapped.
    if (selected) {
      setSelected(null);
      return;
    }
    if (showLayers) selectAt(p);
  }

  /** The floor a photo point lies on (its area or plane), else the most recent floor. */
  function floorAt(p: Pt): SurfaceLayer | undefined {
    const inside = floors.filter((f) => {
      if (f.mask && size) return !!maskHit(f.mask, p[0], p[1], size.w, size.h);
      const poly = f.points.length >= 3 ? f.points : planeOf(f);
      return !!poly && pointInPolygon(p, poly);
    });
    return inside.at(-1) ?? floors.at(-1);
  }

  /** Start measuring: needs a floor with perspective; make one if there is none yet. */
  function startMeasuring() {
    setSelected(null);
    setSelection(null);
    setNotice("");
    if (floors.length) {
      setDrawing({ kind: "measure", points: [] });
      return;
    }
    const floorSeg = segmentation?.segments.find((s) => s.kind === "floor");
    if (floorSeg) {
      const sel = selectionFromSegment(floorSeg)!;
      surfaceFromSelection(sel, { type: "none" }, "floor", segmentation);
      setSelected(null);
      setDrawing({ kind: "measure", points: [] });
      return;
    }
    // No recognition: let the user mark four corners of a rectangular piece of floor.
    setDrawing({ kind: "surface", points: [], fill: { type: "none" }, thenMeasure: true });
  }

  function finishMeasure(points: Pt[]) {
    if (!size) return;
    const floor = floorAt(points[0]);
    setDrawing(null);
    if (!floor) return;
    const id = newId();
    const hasRuler = !!rulerOf(layers, floor.id);
    const line: MeasureLayer = { kind: "measure", id, points, floorId: floor.id, imageW: size.w, imageH: size.h };
    setLayers((ls) => [...ls, line]);
    setSelected(id);
    if (!hasRuler) setRulerFor(id);
  }

  function applyDrag(p: Pt) {
    const d = drag.current;
    if (!d) return;
    if (d.type === "move") {
      const dx = p[0] - d.from[0];
      const dy = p[1] - d.from[1];
      patchLayer(d.id, { corners: d.start.map(([x, y]) => [x + dx, y + dy]) as Quad });
    } else if (d.type === "anchor-move") {
      const q = projectPoint(d.toPlane, p);
      const clamp = (v: number) => Math.min(PLANE * 1.2, Math.max(-PLANE * 0.2, v));
      patchLayer(d.id, { floor: { ...d.start, u: clamp(d.start.u + q[0] - d.q0[0]), v: clamp(d.start.v + q[1] - d.q0[1]) } });
    } else if (d.type === "anchor-scale") {
      // Resizing by hand ends "true size": the width is now whatever you make it.
      const f = Math.hypot(p[0] - d.center[0], p[1] - d.center[1]) / Math.max(1, Math.hypot(d.from[0] - d.center[0], d.from[1] - d.center[1]));
      patchLayer(d.id, { floor: { ...d.start, widthCm: undefined, width: Math.max(10, d.start.width * f) } });
    } else if (d.type === "corner") {
      if (d.distort) {
        patchLayer(d.id, { corners: d.start.map((c, i) => (i === d.index ? p : c)) as Quad });
      } else {
        // Uniform scale around the centre.
        const c = centroid(d.start);
        const f = Math.hypot(p[0] - c[0], p[1] - c[1]) / Math.max(1, Math.hypot(d.from[0] - c[0], d.from[1] - c[1]));
        patchLayer(d.id, { corners: d.start.map(([x, y]) => [c[0] + (x - c[0]) * f, c[1] + (y - c[1]) * f]) as Quad });
      }
    } else if (d.type === "plan-move") {
      if (!view || !linkedPlan) return;
      const q = photoToPlan(view, p);
      updateItem(update, linkedPlan.id, d.itemId, { x: d.start[0] + q[0] - d.q0[0], y: d.start[1] + q[1] - d.q0[1] });
    } else if (d.type === "plane") {
      setLayers((ls) =>
        ls.map((l) => (l.id === d.id && l.kind === "surface" && l.plane ? { ...l, plane: l.plane.map((q, i) => (i === d.index ? p : q)) as Quad } : l)),
      );
    } else {
      setLayers((ls) => ls.map((l) => (l.id === d.id && l.kind !== "product" ? { ...l, points: l.points.map((q, i) => (i === d.index ? p : q)) } : l)));
    }
  }

  // At most one update per screen frame, however fast the pointer events come in.
  const onPointerMove = (e: React.PointerEvent) => {
    if (brush.current) return brushTo(toPhoto(e));
    if (!drag.current) return;
    pending.current = toPhoto(e);
    if (frame.current) return;
    frame.current = requestAnimationFrame(() => {
      frame.current = 0;
      if (pending.current) applyDrag(pending.current);
      pending.current = null;
    });
  };

  const selectedLayer = allLayers.find((l) => l.id === selected);
  const metricOf = (floorId: string) => floorMetric(layers, floorId);
  const floorPlaneOf = (floorId: string) => {
    const f = layers.find((l) => l.id === floorId);
    return f?.kind === "surface" ? planeOf(f) : null;
  };
  /** Label of a measuring line: its known length (ruler) or its measured length. */
  const measureText = (l: MeasureLayer): string => {
    if (l.cm) return `${formatCm(l.cm)} · meetlat`;
    const plane = floorPlaneOf(l.floorId);
    const m = metricOf(l.floorId);
    return plane && m ? formatCm(distanceCm(plane, m, l.points[0], l.points[1])) : "? (geen meetlat)";
  };

  if (!photo) {
    return (
      <section className="panel narrow">
        <h2>Visualiseren</h2>
        <p className="empty">Laad eerst een woning in (tab Woning) om kamers in te richten.</p>
      </section>
    );
  }

  const hasErased = showLayers && erased && erased.key === eraseKey && !!eraseKey;
  const scale = size && displayWidth ? displayWidth / size.w : 0;
  const handleR = handleRadius();

  const cutoutSrc = (l: ProductLayer): string | null => {
    const cut = cutouts[layerCutKey(l)];
    return l.cutout !== "off" && cut && !cut.startsWith("failed") && cut !== "pending" ? cut : null;
  };
  const baseTextureSrc = (l: SurfaceLayer): string | null => {
    if (l.fill.type === "preset") return presetTexture(l.fill.preset);
    if (l.fill.type !== "texture") return null;
    const t = textures[`${l.fill.productId}:${l.crop}`];
    const product = productById.get(l.fill.productId);
    return t && t !== "pending" ? t : product?.image ? proxied(product.image) : null;
  };
  const textureSrc = (l: SurfaceLayer): string | null => {
    const src = baseTextureSrc(l);
    if (!src || !l.rotate) return src;
    if (!rotated[src]) rotatedTexture(src).then((url) => setRotated((r) => (r[src] ? r : { ...r, [src]: url }))).catch(() => undefined);
    return rotated[src] ?? src;
  };

  // Erased areas as masks: a new floor or wall also covers the spot where old furniture stood.
  const eraseMaskUrls = size
    ? eraseLayers.map((l) => {
        if (l.mask) return l.mask;
        return polygonMaskUrl(l.points, size.w, size.h);
      })
    : [];

  const surfaceStyle = (l: SurfaceLayer): React.CSSProperties => {
    const style: React.CSSProperties = { opacity: l.opacity, mixBlendMode: l.blend, isolation: "isolate" };
    const plane = planeOf(l);
    if (l.mask) {
      const masks = [l.mask, ...eraseMaskUrls].map((u) => `url("${u}")`).join(",");
      Object.assign(style, { maskImage: masks, WebkitMaskImage: masks, maskSize: "100% 100%", WebkitMaskSize: "100% 100%" });
      // The mask decides what is visible; the (extended) plane only keeps a new floor from
      // running up the wall where erased furniture stood.
      const ext = plane && extendedPlane(plane, l.role);
      const clip = ext?.quad ?? plane;
      if (clip) style.clipPath = `polygon(${clip.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
    } else {
      style.clipPath = `polygon(${l.points.map(([x, y]) => `${x}px ${y}px`).join(",")})`;
    }
    return style;
  };

  async function exportDesign() {
    if (!size || !photo) return;
    setExporting(true);
    setNotice("");
    try {
      const blob = await renderDesign({
        width: size.w,
        height: size.h,
        background: hasErased ? erased!.url : proxied(photo.url),
        layers: allLayers,
        productSrc: (l) => {
          const p = productById.get(l.productId);
          return cutoutSrc(l) ?? (p?.image ? proxied(p.image) : null);
        },
        textureSrc,
        eraseMasks: eraseMaskUrls,
        shading: (l) => shading[l.id],
        lightSide,
        measureText,
      });
      await shareOrDownload(blob, exportFileName(project, photo.room));
    } catch (e) {
      setNotice(`Opslaan mislukt: ${e instanceof Error ? e.message : e}`);
    } finally {
      setExporting(false);
    }
  }

  const found = segmentation?.segments ?? [];
  const empty = layers.length === 0 && !segmentation && !drawing;

  return (
    <section className="panel visualizer">
      <PhotoStrip photos={photos} activeId={photo.id} edited={edited} onPick={onPickPhoto} />

      <div className="stage-wrap">
        <div className="toolbar row wrap">
          {drawing ? (
            <>
              <span className="hint">
                {drawing.kind === "measure"
                  ? `📏 Tik het begin en het eind van een lijn op de vloer${drawing.points.length ? " — nu het eind" : ""}`
                  : drawing.kind === "erase"
                    ? `Tik rondom wat weg moet (${drawing.points.length} punten)`
                    : drawing.thenMeasure || drawing.thenLink
                      ? `Tik de 4 hoeken van een rechthoekig stuk vloer, bv. tussen de muren (${drawing.points.length}/4)`
                      : `Tik de hoeken van de vloer of muur aan — 4 hoeken geeft perspectief (${drawing.points.length} punten)`}
              </span>
              {drawing.kind !== "measure" && (
                <button className="primary" disabled={drawing.points.length < (drawing.thenMeasure || drawing.thenLink ? 4 : 3)} onClick={finishDrawing}>
                  {drawing.kind === "erase" ? "Weggummen" : "Vlak afmaken"}
                </button>
              )}
              <button onClick={() => setDrawing((d) => (d && d.points.length ? { ...d, points: d.points.slice(0, -1) } : d))} disabled={!drawing.points.length}>
                ↶ Punt terug
              </button>
              <button onClick={() => setDrawing(null)}>Annuleren</button>
            </>
          ) : (
            <>
              <button className="primary" onClick={detect} disabled={!!status}>
                ✨ {segmentation ? "Opnieuw herkennen" : "Herken meubels, muren & vloer"}
              </button>
              <button onClick={() => (setDrawing({ kind: "surface", points: [] }), setSelected(null))}>🖌️ Zelf vlak</button>
              <button onClick={() => (setDrawing({ kind: "erase", points: [] }), setSelected(null))}>🧽 Zelf gummen</button>
              <button onClick={startMeasuring} title="Meet op de vloer; met één bekende maat zet je meubels op ware grootte">
                📏 Meten
              </button>
              {plans.length > 0 && (
                <button className={link ? "on" : ""} onClick={() => (linking ? setLinking(false) : openLinking())} title="Koppel deze foto aan de plattegrond">
                  🗺️ {link ? "Gekoppeld" : "Koppelen"}
                </button>
              )}
              <span className="toolbar-spacer" />
              <button onClick={editor.undo} disabled={!editor.canUndo} title="Ongedaan maken (⌘/Ctrl + Z)" aria-label="Ongedaan maken">
                ↶
              </button>
              <button onClick={editor.redo} disabled={!editor.canRedo} title="Opnieuw (⌘/Ctrl + Shift + Z)" aria-label="Opnieuw">
                ↷
              </button>
              <button
                onPointerDown={() => setShowLayers(false)}
                onPointerUp={() => setShowLayers(true)}
                onPointerLeave={() => setShowLayers(true)}
                onContextMenu={(e) => e.preventDefault()}
                title="Houd ingedrukt om de originele foto te zien"
              >
                👁 Origineel
              </button>
              <button
                className={preview ? "on" : ""}
                onClick={() => (setPreview((v) => !v), setSelected(null), setSelection(null))}
                title="Bekijk het resultaat zonder hulplijnen, meetlijnen en selecties"
                aria-pressed={preview}
              >
                ✨ Voorbeeld
              </button>
              <button onClick={exportDesign} disabled={exporting || !size} title="Bewaar of deel dit ontwerp als foto">
                {exporting ? "Bezig…" : "📷 Opslaan / delen"}
              </button>
              {layers.length > 0 && (
                <button className="ghost" onClick={() => (setLayers(() => []), setSelected(null))} title="Alles van deze foto wissen (ongedaan te maken)">
                  Alles wissen
                </button>
              )}
            </>
          )}
        </div>
        {status && <p className="status">⏳ {status}</p>}
        {notice && <p className="error small">{notice}</p>}

        {empty && (
          <ol className="help">
            <li>
              <strong>Tik op een meubel</strong> in de foto: de AI omlijnt het precies. Kies <strong>Weghalen</strong>.
            </li>
            <li>
              <strong>✨ Herken</strong> vindt ook vloer en muren: tik erop en kies rechts een vloer of verfkleur.
            </li>
            <li>
              <strong>📏 Meten</strong>: tik twee punten op de vloer en vul in hoe lang dat is. Meubels staan dan op ware grootte.
            </li>
            <li>Tik rechts op een meubel: het komt op de vloer te staan. Sleep het op zijn plek.</li>
          </ol>
        )}

        {linking && plan && size && (
          <LinkPanel
            plan={plan}
            planUrl={project.listing?.photos.find((p) => p.id === plan.photoId)?.url ?? ""}
            view={view}
            linkQuad={link?.plan}
            imageW={size.w}
            onLink={linkPhoto}
            onAdjust={(q) => photo && updatePlan(update, plan.id, (pl) => ({ ...pl, links: { ...pl.links, [photo.id]: { ...pl.links[photo.id], plan: q } } }))}
            onUnlink={() => (unlinkPhoto(), setLinking(false))}
            onClose={() => setLinking(false)}
          />
        )}

        {rulerFor && (
          <RulerPrompt
            onCancel={() => setRulerFor(null)}
            onSave={(cm) => {
              patchLayer(rulerFor, { cm });
              setRulerFor(null);
            }}
          />
        )}

        {selection && !selectedLayer && (
          <div className="layer-controls selection-bar">
            <div className="row wrap">
              <strong>{selection.label}</strong>
              {selection.kind === "furniture" || selection.kind === "object" ? (
                <>
                  <button className="primary" onClick={() => eraseSelection(selection, "ai")}>
                    🧽 Weghalen met AI
                  </button>
                  <button onClick={() => eraseSelection(selection, "simple")}>Snel weghalen</button>
                </>
              ) : selection.kind === "floor" ? (
                <>
                  <button className="primary" onClick={() => surfaceFromSelection(selection, { type: "preset", preset: "eiken-naturel" }, "floor")}>
                    🪵 Nieuwe vloer leggen
                  </button>
                  <span className="muted small">of kies rechts een vloer</span>
                </>
              ) : (
                <>
                  <button
                    className="primary"
                    onClick={() => surfaceFromSelection(selection, { type: "color", color: products.find((p) => p.color)?.color ?? "#d8cfc4" }, "wall")}
                  >
                    🎨 Verven
                  </button>
                  <span className="muted small">of kies rechts een kleur, behang of tegels</span>
                </>
              )}
              <button className="ghost" onClick={() => (setSelection(null), setRefine(null))}>
                Sluiten
              </button>
            </div>
            {(selection.kind === "furniture" || selection.kind === "object") && (
              <div className="row wrap">
                <span className="muted small">Niet helemaal goed?</span>
                <div className="segmented" role="group" aria-label="Selectie aanpassen">
                  {([
                    ["add", "➕ Tik erbij"],
                    ["remove", "➖ Tik eraf"],
                    ["brush-add", "🖌️ Kwast +"],
                    ["brush-remove", "🧽 Kwast −"],
                  ] as const).map(([m, label]) => (
                    <button key={m} className={refine === m ? "on" : ""} onClick={() => setRefine((r) => (r === m ? null : m))}>
                      {label}
                    </button>
                  ))}
                </div>
                {(refine === "brush-add" || refine === "brush-remove") && (
                  <label className="row small">
                    Kwast
                    <input type="range" min={0.5} max={8} step={0.5} value={brushSize} onChange={(e) => setBrushSize(Number(e.target.value))} aria-label="Kwastgrootte" />
                  </label>
                )}
                {(refine === "add" || refine === "remove") && (
                  <span className="small">Tik nu op het stuk dat {refine === "add" ? "erbij moet" : "eraf moet"}.</span>
                )}
                {(refine === "brush-add" || refine === "brush-remove") && (
                  <span className="small">Veeg over de randen die {refine === "brush-add" ? "erbij moeten" : "eraf moeten"}.</span>
                )}
              </div>
            )}
          </div>
        )}

        {found.length > 0 && !drawing && !(selection && !selectedLayer) && (
          <div className="found row">
            <span className="muted small">Gevonden:</span>
            {found.map((s) => (
              <button
                key={s.id}
                className={`chip ${s.kind} ${selection?.label === s.label ? "on" : ""}`}
                onClick={() => (setSelected(null), setRefine(null), setSelection(selectionFromSegment(s)))}
              >
                {s.label}
              </button>
            ))}
          </div>
        )}

        {size ? (
          <div ref={stageRef} className="stage" style={{ aspectRatio: `${size.w} / ${size.h}` }}>
            <div className="canvas" style={{ width: size.w, height: size.h, transform: `scale(${scale})` }}>
              {hasErased ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img className="layer" src={erased!.url} alt="" style={{ width: size.w, height: size.h }} />
              ) : (
                <Img className="layer" src={photo.url} alt="" style={{ width: size.w, height: size.h }} />
              )}
              {showLayers &&
                allLayers.map((l) => {
                  if (l.kind === "erase" || l.kind === "measure") return null;
                  if (l.kind === "surface" && l.fill.type === "none") return null;
                  if (l.kind === "surface") {
                    const tex = textureSrc(l);
                    const plane = planeOf(l);
                    return (
                      <div key={l.id} className="layer surface" style={{ width: size.w, height: size.h, ...surfaceStyle(l) }}>
                        {l.fill.type === "color" || !tex ? (
                          <div className="fill" style={{ background: l.fill.type === "color" ? l.fill.color : "#999" }} />
                        ) : l.perspective && plane ? (
                          (() => {
                            // Detected floors and walls: draw the texture on a larger part of the same plane,
                            // so nothing next to the fitted area is left bare.
                            const ext = l.mask ? extendedPlane(plane, l.role) : null;
                            return (
                              <div
                                className="plane"
                                style={{
                                  width: ext?.w ?? PLANE,
                                  height: ext?.h ?? PLANE,
                                  backgroundImage: `url("${tex}")`,
                                  backgroundSize: `${l.scale}px auto`,
                                  backgroundPosition: ext ? `${-ext.u0}px ${-ext.v0}px` : undefined,
                                  transform: ext ? quadToMatrix3d(ext.w, ext.h, ext.quad) : quadToMatrix3d(PLANE, PLANE, plane),
                                }}
                              />
                            );
                          })()
                        ) : (
                          <div className="fill" style={{ backgroundImage: `url("${tex}")`, backgroundSize: `${l.scale}px auto` }} />
                        )}
                        {l.fill.type !== "color" && tex && shading[l.id] && (
                          <>
                            <div className="fill" style={{ backgroundImage: `url("${shading[l.id].multiply}")`, backgroundSize: "100% 100%", mixBlendMode: "multiply" }} />
                            <div className="fill" style={{ backgroundImage: `url("${shading[l.id].screen}")`, backgroundSize: "100% 100%", mixBlendMode: "screen" }} />
                          </>
                        )}
                      </div>
                    );
                  }
                  const product = productById.get(l.productId);
                  if (!product?.image) return null;
                  const h = PRODUCT_W * l.aspect;
                  const floor = l.floor && layers.find((f) => f.id === l.floor!.planeId);
                  const floorPlane = floor?.kind === "surface" ? planeOf(floor) : null;
                  const style: React.CSSProperties = {
                    width: PRODUCT_W,
                    height: h,
                    filter: productFilter(l.light, l.warmth),
                    transform: quadToMatrix3d(PRODUCT_W, h, l.corners) + (l.flip ? ` translateX(${PRODUCT_W}px) scaleX(-1)` : ""),
                  };
                  const cut = cutoutSrc(l);
                  const shade = sideShade(lightSide, l.sideLight ?? 0.8, l.flip);
                  const shapeUrl = `url("${cut ?? proxied(product.image)}")`;
                  return (
                    <Fragment key={l.id}>
                      {(l.shadow ?? 0.5) > 0 && <Shadow layer={l} plane={floorPlane} size={size} />}
                      {cut ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img className="layer product" src={cut} alt={product.title} style={style} />
                      ) : (
                        <Img className="layer product" src={product.image} alt={product.title} style={style} />
                      )}
                      {shade && (
                        <div
                          className="layer"
                          style={{
                            width: style.width,
                            height: style.height,
                            transform: style.transform,
                            background: shade,
                            maskImage: shapeUrl,
                            WebkitMaskImage: shapeUrl,
                            maskSize: "100% 100%",
                            WebkitMaskSize: "100% 100%",
                          }}
                        />
                      )}
                    </Fragment>
                  );
                })}
            </div>

            {/* Interaction layer: outlines and handles, in photo coordinates. Taps are hit-tested in code. */}
            <svg
              ref={svgRef}
              className={`overlay ${drawing ? "drawing" : ""} ${segmentation ? "pickable" : ""} ${preview ? "preview" : ""}`}
              viewBox={`0 0 ${size.w} ${size.h}`}
              preserveAspectRatio="none"
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={() => (endBrush(), endDrag())}
              onPointerCancel={() => (endBrush(), endDrag())}
              onLostPointerCapture={() => (endBrush(), endDrag())}
            >
              {selection && <image className="highlight" href={selection.url} width={size.w} height={size.h} preserveAspectRatio="none" />}
              {brushAt && <circle className="brush" cx={brushAt[0]} cy={brushAt[1]} r={(brushSize / 100) * size.w} />}
              {showLayers &&
                selectedLayer &&
                selectedLayer.kind !== "measure" &&
                ((selectedLayer.kind === "surface" || selectedLayer.kind === "erase") && selectedLayer.mask ? (
                  <image className="highlight selected-area" href={selectedLayer.mask} width={size.w} height={size.h} preserveAspectRatio="none" />
                ) : (
                  <polygon
                    className="outline"
                    points={(selectedLayer.kind === "product" ? selectedLayer.corners : selectedLayer.points).map((p) => p.join(",")).join(" ")}
                  />
                ))}

              {/* "Past het?": the product's footprint on a measured floor. */}
              {showLayers &&
                selectedLayer?.kind === "product" &&
                selectedLayer.floor &&
                (() => {
                  const a = selectedLayer.floor!;
                  const plane = floorPlaneOf(a.planeId);
                  const m = metricOf(a.planeId);
                  if (!plane || !m) return null;
                  const dims = productById.get(selectedLayer.productId)?.dims;
                  const widthCm = a.widthCm ?? a.width * m.sx;
                  const depthCm = dims?.d ?? widthCm * 0.45;
                  const fp = footprint(plane, m, a.u, a.v, widthCm, depthCm, a.angle);
                  const [, , br, bl] = fp;
                  return (
                    <g className="footprint">
                      <polygon points={fp.map((p) => p.join(",")).join(" ")} />
                      <MeasureLabel
                        at={[(br[0] + bl[0]) / 2, (br[1] + bl[1]) / 2 + size.w / 45]}
                        text={`${Math.round(widthCm)} × ${Math.round(depthCm)} cm${dims?.d ? "" : " (diepte geschat)"}`}
                        size={size.w}
                      />
                    </g>
                  );
                })()}

              {/* Measuring lines with their length. */}
              {showLayers &&
                layers
                  .filter((l): l is MeasureLayer => l.kind === "measure")
                  .map((l) => (
                    <g key={l.id} className={`measure ${l.cm ? "ruler" : ""} ${selected === l.id ? "selected" : ""}`}>
                      <line x1={l.points[0][0]} y1={l.points[0][1]} x2={l.points[1][0]} y2={l.points[1][1]} />
                      {l.points.map((p, i) => (
                        <circle key={i} cx={p[0]} cy={p[1]} r={size.w / 260} />
                      ))}
                      <MeasureLabel at={[(l.points[0][0] + l.points[1][0]) / 2, (l.points[0][1] + l.points[1][1]) / 2]} text={measureText(l)} size={size.w} />
                    </g>
                  ))}
              {linking &&
                (linkQuad ?? (floors.at(-1) && planeOf(floors.at(-1)!)))?.slice(0, 2).map((p, i) => (
                  <g key={i} className="link-marker">
                    <circle cx={p[0]} cy={p[1]} r={handleR} />
                    <MeasureLabel at={[p[0], p[1] - handleR * 2.2]} text={i ? "R" : "L"} size={size.w * 1.3} />
                  </g>
                ))}
              {drawing?.kind === "measure" && drawing.points.length === 1 && (
                <circle className="handle draft-point" cx={drawing.points[0][0]} cy={drawing.points[0][1]} r={handleR * 0.7} />
              )}
              {showLayers &&
                layers
                  .filter((l): l is EraseLayer => l.kind === "erase" && !l.mask && l.id !== selected)
                  .map((l) => <polygon key={l.id} className="outline faint" points={l.points.map((p) => p.join(",")).join(" ")} />)}

              {showLayers &&
                selectedLayer?.kind === "product" &&
                !selectedLayer.planItem &&
                selectedLayer.corners.map((c, i) => (
                  <circle
                    key={i}
                    className={`handle ${selectedLayer.distort ? "distort" : ""}`}
                    cx={c[0]}
                    cy={c[1]}
                    r={handleR}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      const from = toPhoto(e);
                      if (selectedLayer.floor) {
                        const c2 = selectedLayer.corners;
                        const center: Pt = [(c2[2][0] + c2[3][0]) / 2, (c2[2][1] + c2[3][1]) / 2];
                        // From true size (cm) back to plane units, so scaling starts from what you see.
                        const a = selectedLayer.floor;
                        const m = a.widthCm ? metricOf(a.planeId) : null;
                        const start = m && a.widthCm ? { ...a, width: (a.widthCm * Math.cos((a.angle * Math.PI) / 180)) / m.sx || a.width } : a;
                        startDrag({ type: "anchor-scale", id: selectedLayer.id, from, center, start }, e);
                      } else {
                        startDrag(
                          { type: "corner", id: selectedLayer.id, index: i, from, start: selectedLayer.corners, distort: selectedLayer.distort },
                          e,
                        );
                      }
                    }}
                  />
                ))}
              {showLayers && selectedLayer?.kind === "surface" && selectedLayer.plane && (
                <>
                  <polygon className="outline plane-outline" points={selectedLayer.plane.map((p) => p.join(",")).join(" ")} />
                  {selectedLayer.plane.map((p, i) => (
                    <rect
                      key={i}
                      className="handle plane-handle"
                      x={p[0] - handleR}
                      y={p[1] - handleR}
                      width={handleR * 2}
                      height={handleR * 2}
                      onPointerDown={(e) => {
                        e.stopPropagation();
                        startDrag({ type: "plane", id: selectedLayer.id, index: i }, e);
                      }}
                    />
                  ))}
                </>
              )}
              {showLayers &&
                selectedLayer &&
                selectedLayer.kind !== "product" &&
                !(selectedLayer.kind !== "measure" && selectedLayer.mask) &&
                selectedLayer.points.map((p, i) => (
                  <circle
                    key={i}
                    className="handle"
                    cx={p[0]}
                    cy={p[1]}
                    r={handleR * 0.85}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      startDrag({ type: "vertex", id: selectedLayer.id, index: i }, e);
                    }}
                  />
                ))}

              {drawing && drawing.points.length > 0 && (
                <>
                  <polygon className={`draft ${drawing.kind}`} points={drawing.points.map((p) => p.join(",")).join(" ")} />
                  {drawing.points.map((p, i) => (
                    <circle key={i} className="handle draft-point" cx={p[0]} cy={p[1]} r={handleR * 0.85} />
                  ))}
                </>
              )}
            </svg>
          </div>
        ) : (
          <div className="stage loading">Foto laden…</div>
        )}


        {selectedLayer?.kind === "product" && selectedLayer.planItem && linkedPlan && (() => {
          const item = linkedPlan.items.find((i) => i.id === selectedLayer.planItem);
          return item ? (
            <PlanItemControls
              item={item}
              product={productById.get(item.productId)}
              visual
              onChange={(patch) => updateItem(update, linkedPlan.id, item.id, patch)}
              onRemove={removeSelected}
              onDuplicate={duplicateSelected}
            />
          ) : null;
        })()}

        {selectedLayer && !(selectedLayer.kind === "product" && selectedLayer.planItem) && (
          <LayerControls
            layer={selectedLayer}
            products={products}
            floors={floors}
            metric={
              selectedLayer.kind === "product"
                ? selectedLayer.floor && metricOf(selectedLayer.floor.planeId)
                : selectedLayer.kind === "measure"
                  ? metricOf(selectedLayer.floorId)
                  : selectedLayer.kind === "surface"
                    ? metricOf(selectedLayer.id)
                    : null
            }
            lengthCm={(() => {
              if (selectedLayer.kind !== "measure") return null;
              const plane = floorPlaneOf(selectedLayer.floorId);
              const m = metricOf(selectedLayer.floorId);
              return plane && m ? distanceCm(plane, m, selectedLayer.points[0], selectedLayer.points[1]) : null;
            })()}
            cutoutState={selectedLayer.kind === "product" ? cutouts[layerCutKey(selectedLayer)] : undefined}
            onChange={(patch) => patchLayer(selectedLayer.id, patch)}
            onPlaceOnFloor={(floorId) => {
              const floor = floors.find((f) => f.id === floorId);
              if (floor && selectedLayer.kind === "product") {
                const placed = placeOnFloor(selectedLayer, floor);
                // On a measured floor, a product with known size goes straight to true size.
                const w = productById.get(selectedLayer.productId)?.dims?.w;
                if (w && metricOf(floor.id) && placed.floor) placed.floor.widthCm = w;
                setLayers((ls) => ls.map((l) => (l.id === selectedLayer.id ? placed : l)));
              }
            }}
            onRemove={removeSelected}
            onDuplicate={duplicateSelected}
            onReorder={(dir) =>
              setLayers((ls) => {
                const i = ls.findIndex((l) => l.id === selectedLayer.id);
                const j = i + dir;
                if (j < 0 || j >= ls.length) return ls;
                const copy = [...ls];
                [copy[i], copy[j]] = [copy[j], copy[i]];
                return copy;
              })
            }
          />
        )}
      </div>

      <Palette
        furniture={furniture}
        surfaces={surfaces}
        onAddProduct={onAddProduct}
        onFill={onFill}
        onAddLink={onAddLink}
        onFavoriteAll={onFavoriteAll}
        room={photo?.room}
        design={design}
      />
    </section>
  );
}

function distanceToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

