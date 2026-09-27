export type RoomType =
  | "woonkamer"
  | "keuken"
  | "slaapkamer"
  | "badkamer"
  | "toilet"
  | "hal"
  | "werkkamer"
  | "zolder"
  | "tuin"
  | "buitenkant"
  | "plattegrond"
  | "overig";

export type Category =
  | "banken"
  | "stoelen"
  | "tafels"
  | "kasten"
  | "bedden"
  | "verlichting"
  | "vloerkleden"
  | "raamdecoratie"
  | "vloeren"
  | "verf"
  | "behang"
  | "tegels"
  | "keuken"
  | "sanitair"
  | "decoratie"
  | "planten"
  | "overig";

export interface Photo {
  id: string;
  url: string;
  /** What the photo shows (sorting, and the default room it belongs to). */
  room: RoomType;
  /** The room of this house it belongs to, once rooms exist. */
  roomId?: string;
}

/** Facts of the house, from Funda. */
export interface HouseFacts {
  price?: string;
  livingArea?: string;
  plotArea?: string;
  bedrooms?: string;
  rooms?: string;
  bathrooms?: string;
  stories?: string;
  energyLabel?: string;
  buildYear?: string;
  kind?: string;
  city?: string;
  neighborhood?: string;
}

export interface Listing {
  url: string;
  title: string;
  photos: Photo[];
  facts?: HouseFacts;
  description?: string;
}

/** A room of the new house: what has to be bought is planned per room. */
export interface Room {
  id: string;
  name: string;
  type: RoomType;
  /** "Begane grond", "1e verdieping"… */
  floor?: string;
  /** Floor area in m². */
  area?: number;
  /** Budget for this room in euros. */
  budget?: number;
  note?: string;
}

/** Where an item is on the way from idea to in the house. */
export type ItemStatus = "idee" | "gekozen" | "besteld" | "binnen";

/** Something to buy for a room: from a webshop link, a screenshot, the AI or typed in. */
export interface Item {
  id: string;
  /** null = not yet assigned to a room. */
  roomId: string | null;
  title: string;
  url?: string;
  image?: string;
  images: string[];
  /** Small copy of the image (data URL): shows instantly, also when the shop's link expires. */
  thumb?: string;
  shop?: string;
  /** Price per piece, from the shop. */
  price?: number;
  /** Rough price when there is no product yet (an AI suggestion, or typed in). */
  estimate?: number;
  qty: number;
  category: Category;
  status: ItemStatus;
  /** Must-have (true) or nice-to-have. */
  must?: boolean;
  note: string;
  dims?: Dims;
  color?: string;
  /** This is an alternative for another item (only the main item counts in the totals). */
  alternativeOf?: string;
  /** Earlier prices seen at the shop, newest last. */
  priceHistory?: { at: string; value: number }[];
  addedAt: number;
  source?: "link" | "ai" | "screenshot" | "manual";
  /** Why the AI suggested it. */
  why?: string;
  /** The AI suggestion this item came from (it stays when a real product is chosen). */
  suggestion?: string;
}

export interface Dims {
  w?: number;
  d?: number;
  h?: number;
}

/** Kinds of renovation work; their order is the order work is done in (see lib/renovation.ts). */
export type RenoKind =
  | "sloop"
  | "elektra"
  | "leidingwerk"
  | "installaties"
  | "isolatie"
  | "kozijnen"
  | "stucwerk"
  | "timmerwerk"
  | "keuken"
  | "badkamer"
  | "schilderen"
  | "vloeren"
  | "tuin"
  | "schoonmaak"
  | "overig";

/** From idea to done: request quotes, plan, do. */
export type RenoStatus = "idee" | "offerte" | "gepland" | "bezig" | "klaar";

/** A quote from a contractor. */
export interface Quote {
  id: string;
  company: string;
  /** Total in euros, including VAT. */
  amount: number;
  note?: string;
  contact?: string;
  addedAt: number;
}

/** A renovation job ("klus"): for rooms, or the whole house when `roomIds` is empty. */
export interface Task {
  id: string;
  title: string;
  kind: RenoKind;
  roomIds: string[];
  /** Do it yourself, or hire someone. */
  who: "zelf" | "vakman";
  status: RenoStatus;
  /** Rough cost when there is no chosen quote (for "zelf": the materials). */
  estimate?: number;
  quotes: Quote[];
  chosenQuote?: string;
  /** Planned start (yyyy-mm-dd) and working days. */
  start?: string;
  days?: number;
  /** Has to be done before moving in (dust, floors, electrics). */
  beforeMove: boolean;
  note: string;
  /** Why it was suggested, and subsidy hints (AI or rules). */
  why?: string;
  addedAt: number;
  source?: "suggestie" | "ai" | "zelf";
}

export interface Renovation {
  /** Key handover and moving day (yyyy-mm-dd). */
  keyDate?: string;
  moveDate?: string;
  /** Budget for renovating, in euros. */
  budget?: number;
  tasks: Task[];
}

export interface Project {
  listing: Listing | null;
  rooms: Room[];
  items: Item[];
  renovation?: Renovation;
  /** Total budget for furnishing, in euros. */
  budget?: number;
  /** Preferred style, for the AI ("Scandinavisch, licht hout"). */
  style?: string;
}

/** Response shape of /api/funda */
export interface FundaResult {
  title: string;
  photos: string[];
  /** Room per photo URL, when Funda labels it (e.g. floor plans). */
  rooms?: Record<string, RoomType>;
  facts?: HouseFacts;
  description?: string;
}

/** Response shape of /api/product */
export interface ProductInfo {
  url: string;
  dims?: Dims;
  title: string;
  image: string;
  images: string[];
  price?: string;
  priceValue?: number;
  shop: string;
  category: Category;
  color?: string;
}
