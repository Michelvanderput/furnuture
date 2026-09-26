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

export type Pt = [number, number];
export type Quad = [Pt, Pt, Pt, Pt];

export type CutoutMode = "off" | "simple" | "ai";

/**
 * A product image placed on a room photo. Coordinates are in photo pixels.
 * The image is mapped onto four free corners, so it can be put in perspective.
 */
export interface ProductLayer {
  kind: "product";
  id: string;
  productId: string;
  /** top-left, top-right, bottom-right, bottom-left */
  corners: Quad;
  /** height / width of the product image */
  aspect: number;
  flip: boolean;
  /** How to remove the product photo's background. */
  cutout: CutoutMode;
  /** Colour tolerance for the simple (non-AI) cut-out. */
  tolerance: number;
  /** Corner handles move individually (perspective) instead of scaling. */
  distort: boolean;
}

export type SurfaceFill =
  | { type: "color"; color: string }
  | { type: "texture"; productId: string }
  | { type: "preset"; preset: string };

/** A hand-drawn area (wall, floor) filled with a colour or a texture. */
export interface SurfaceLayer {
  kind: "surface";
  id: string;
  points: Pt[];
  fill: SurfaceFill;
  opacity: number;
  /** multiply keeps the shadows of the photo (good for paint), normal covers it (good for floors). */
  blend: "multiply" | "normal";
  /** Texture tile size in pixels. */
  scale: number;
  /** For 4-point areas: lay the texture in perspective onto the four corners. */
  perspective: boolean;
  /** Part of a product photo used as texture (1 = whole image, 0.3 = centre 30%). */
  crop: number;
}

/** An area of the photo that is painted out (existing furniture removed). */
export interface EraseLayer {
  kind: "erase";
  id: string;
  points: Pt[];
}

export type Layer = ProductLayer | SurfaceLayer | EraseLayer;

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
