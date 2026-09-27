"use client";

import {
  Archive,
  Armchair,
  Bathtub,
  Bed,
  Chair,
  CheckCircle,
  CookingPot,
  Couch,
  Desk,
  Door,
  GridFour,
  Heart,
  House,
  Image as ImageIcon,
  Lamp,
  Lightbulb,
  Lockers,
  MapTrifold,
  Package,
  PaintBrush,
  PaintRoller,
  Plant,
  Rug,
  Shower,
  Sparkle,
  Stack,
  Stairs,
  Table,
  Toilet,
  Tree,
  Wind,
  type Icon,
  type IconProps,
} from "@phosphor-icons/react";
import {
  Barricade,
  CalendarCheck,
  FrameCorners,
  Hammer,
  HardHat,
  Leaf,
  Lightning,
  Pipe,
  Receipt,
  Thermometer,
  Toolbox,
  Wall,
  Broom,
} from "@phosphor-icons/react";
import type { Category, ItemStatus, RenoKind, RenoStatus, RoomType } from "@/lib/types";

/** One icon family (Phosphor, regular weight) for the whole app; see design-system/furnuture/MASTER.md. */
export const ROOM_ICON: Record<RoomType, Icon> = {
  woonkamer: Couch,
  keuken: CookingPot,
  slaapkamer: Bed,
  badkamer: Bathtub,
  toilet: Toilet,
  hal: Door,
  werkkamer: Desk,
  zolder: Stairs,
  tuin: Tree,
  buitenkant: House,
  plattegrond: MapTrifold,
  overig: Sparkle,
};

export const CATEGORY_ICON: Record<Category, Icon> = {
  banken: Couch,
  stoelen: Chair,
  tafels: Table,
  kasten: Lockers,
  bedden: Bed,
  keuken: CookingPot,
  vloeren: Stack,
  verf: PaintRoller,
  behang: PaintBrush,
  tegels: GridFour,
  sanitair: Shower,
  raamdecoratie: Wind,
  verlichting: Lamp,
  vloerkleden: Rug,
  decoratie: ImageIcon,
  planten: Plant,
  overig: Archive,
};

export const STATUS_ICON: Record<ItemStatus, Icon> = {
  idee: Lightbulb,
  gekozen: Heart,
  besteld: Package,
  binnen: CheckCircle,
};

export const RENO_ICON: Record<RenoKind, Icon> = {
  sloop: Barricade,
  elektra: Lightning,
  leidingwerk: Pipe,
  installaties: Thermometer,
  isolatie: Leaf,
  kozijnen: FrameCorners,
  stucwerk: Wall,
  timmerwerk: Hammer,
  keuken: CookingPot,
  badkamer: Bathtub,
  schilderen: PaintRoller,
  vloeren: Stack,
  tuin: Tree,
  schoonmaak: Broom,
  overig: Toolbox,
};

export const RENO_STATUS_ICON: Record<RenoStatus, Icon> = {
  idee: Lightbulb,
  offerte: Receipt,
  gepland: CalendarCheck,
  bezig: HardHat,
  klaar: CheckCircle,
};

/** Decorative by default (next to visible text); pass a `label` when the icon stands alone. */
export function I({ icon: Glyph, label, size = 18, ...rest }: { icon: Icon; label?: string } & IconProps) {
  return <Glyph size={size} aria-hidden={label ? undefined : true} aria-label={label} role={label ? "img" : undefined} {...rest} />;
}

export const RoomIcon = ({ type, size }: { type: RoomType; size?: number }) => <I icon={ROOM_ICON[type]} size={size} />;
export const RenoIcon = ({ kind, size }: { kind: RenoKind; size?: number }) => <I icon={RENO_ICON[kind]} size={size} />;
export const CategoryIcon = ({ category, size }: { category: Category; size?: number }) => <I icon={CATEGORY_ICON[category]} size={size} />;
export { Armchair };
