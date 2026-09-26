import type { FloorPlan, PlanItem, Product, Project } from "./types";

type Update = (fn: (p: Project) => Project) => void;

export const plansOf = (p: Project) => p.plans ?? [];

/** The floor plan a photo is linked to, if any. */
export const planForPhoto = (p: Project, photoId: string | undefined) =>
  photoId ? plansOf(p).find((plan) => plan.links[photoId]) : undefined;

export function updatePlan(update: Update, planId: string, fn: (plan: FloorPlan) => FloorPlan) {
  update((p) => ({ ...p, plans: plansOf(p).map((plan) => (plan.id === planId ? fn(plan) : plan)) }));
}

export function updateItem(update: Update, planId: string, itemId: string, patch: Partial<PlanItem>) {
  updatePlan(update, planId, (plan) => ({ ...plan, items: plan.items.map((it) => (it.id === itemId ? { ...it, ...patch } : it)) }));
}

/** Sensible size for a product without known dimensions, by category. */
export function defaultSize(product: Product): { w: number; d: number; h?: number } {
  const d = product.dims ?? {};
  const byCategory: Record<string, [number, number]> = {
    banken: [210, 90],
    stoelen: [50, 55],
    tafels: [160, 90],
    kasten: [120, 45],
    bedden: [160, 210],
    vloerkleden: [200, 290],
    verlichting: [40, 40],
    planten: [45, 45],
  };
  const [w, dd] = byCategory[product.category] ?? [80, 50];
  return { w: d.w ?? w, d: d.d ?? dd, h: d.h };
}

export const formatScale = (cmPerPx?: number) => (cmPerPx ? `1 px = ${cmPerPx.toLocaleString("nl-NL", { maximumFractionDigits: 2 })} cm` : "schaal onbekend");
