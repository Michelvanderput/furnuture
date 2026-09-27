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

export interface Project {
  listing: Listing | null;
  rooms: Room[];
  items: Item[];
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
