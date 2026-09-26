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
  room: RoomType;
}

export interface Listing {
  url: string;
  title: string;
  photos: Photo[];
}

export type ProductStatus = "optie" | "favoriet" | "afgewezen";

export interface Product {
  id: string;
  url: string;
  title: string;
  image: string;
  images: string[];
  price?: string;
  priceValue?: number;
  shop: string;
  category: Category;
  status: ProductStatus;
  note: string;
  /** Hex colour, used for paint products so they can be applied to walls. */
  color?: string;
}

/** A product image dragged onto a room photo. Coordinates are in photo pixels. */
export interface ProductLayer {
  kind: "product";
  id: string;
  productId: string;
  x: number;
  y: number;
  width: number;
  /** height / width of the product image */
  aspect: number;
  flip: boolean;
  /** Remove near-white background from the product image (no AI, flood fill). */
  cutout: boolean;
}

/** A hand-drawn area (wall, floor) filled with a colour or a product texture. */
export interface SurfaceLayer {
  kind: "surface";
  id: string;
  points: [number, number][];
  fill: { type: "color"; color: string } | { type: "texture"; productId: string };
  opacity: number;
  /** multiply keeps the shadows of the photo (good for paint), normal covers it (good for floors). */
  blend: "multiply" | "normal";
  /** Texture tile width in photo pixels. */
  scale: number;
}

export type Layer = ProductLayer | SurfaceLayer;

export interface Scene {
  photoId: string;
  layers: Layer[];
}

export interface Project {
  listing: Listing | null;
  products: Product[];
  scenes: Record<string, Scene>;
}

/** Response shape of /api/funda */
export interface FundaResult {
  title: string;
  photos: string[];
  /** Room per photo URL, when Funda labels it (e.g. floor plans). */
  rooms?: Record<string, RoomType>;
}

/** Response shape of /api/product */
export interface ProductInfo {
  url: string;
  title: string;
  image: string;
  images: string[];
  price?: string;
  priceValue?: number;
  shop: string;
  category: Category;
  color?: string;
}
