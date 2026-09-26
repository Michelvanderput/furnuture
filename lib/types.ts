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
  /** Which room it is meant for (budget per room). */
  room?: RoomType;
  /** Size in cm: width, depth, height. */
  dims?: Dims;
}

export interface Dims {
  w?: number;
  d?: number;
  h?: number;
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
  /** Standing on a floor: corners follow the floor's perspective and depth. */
  floor?: FloorAnchor;
  /** Soft contact shadow under the product (0 = none). */
  shadow?: number;
  /** Brightness and warmth to match the room's light (CSS brightness / sepia). */
  light?: number;
  warmth?: number;
  /** Side light from the room's window (0 = off, default 0.8). */
  sideLight?: number;
  /** Floor shadow as a quad in the photo (products coming from the floor plan). */
  shadowQuad?: Quad;
  /** Set for products that live on the floor plan (id of the plan item). */
  planItem?: string;
}

export interface FloorAnchor {
  /** Id of the surface layer whose plane the product stands on. */
  planeId: string;
  /** Middle of the product's bottom edge, in plane units (0..1000). */
  u: number;
  v: number;
  /** Width in plane units. */
  width: number;
  /** Rotation on the floor in degrees (0 = facing the camera). */
  angle: number;
  /** Real width in cm: with a measured floor the product is drawn at true size. */
  widthCm?: number;
}

export type SurfaceFill =
  | { type: "none" }
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
  /** AI-detected area: PNG whose alpha is the area (used instead of points). */
  mask?: string;
  /** Perspective plane (top-left, top-right, bottom-right, bottom-left); defaults to the 4 points. */
  plane?: Quad;
  role?: "floor" | "wall";
  /** Preset textures follow the measured floor's real size unless the user set a size. */
  autoScale?: boolean;
  /** Texture turned a quarter (planks running into the room instead of across). */
  rotate?: boolean;
}

/** An area of the photo that is painted out (existing furniture removed). */
export interface EraseLayer {
  kind: "erase";
  id: string;
  points: Pt[];
  /** AI-detected object: PNG whose alpha is the area to erase (used instead of points). */
  mask?: string;
  /** "ai" = MI-GAN inpainting, "simple" = fill from the surroundings. */
  method: "ai" | "simple";
  label?: string;
}

/**
 * A measuring line on a floor. The first line with `cm` is the floor's ruler:
 * it gives the floor its real size, every other line then shows its length.
 */
export interface MeasureLayer {
  kind: "measure";
  id: string;
  /** Start and end, in photo pixels. */
  points: Pt[];
  floorId: string;
  /** Known real length: this line calibrates the floor. */
  cm?: number;
  /** Photo size, needed to estimate the camera (focal length). */
  imageW: number;
  imageH: number;
}

export type Layer = ProductLayer | SurfaceLayer | EraseLayer | MeasureLayer;

export interface Scene {
  photoId: string;
  layers: Layer[];
}

export interface Project {
  listing: Listing | null;
  products: Product[];
  scenes: Record<string, Scene>;
  /** Floor plans (one per storey), with rooms, furniture and linked photos. */
  plans?: FloorPlan[];
}

/**
 * A floor plan is the 3D model of the house: rooms and furniture are placed on
 * it in real size, and linked photos show that furniture in perspective.
 * All coordinates are pixels of the plan image; `cmPerPx` gives real size.
 */
export interface FloorPlan {
  id: string;
  name: string;
  /** Listing photo with the drawing (or an uploaded one). */
  photoId: string;
  imageW: number;
  imageH: number;
  /** Scale: from a measured line on the plan, or derived from a measured photo. */
  cmPerPx?: number;
  ruler?: { a: Pt; b: Pt; cm: number };
  rooms: PlanRoom[];
  items: PlanItem[];
  /** Photo id -> how that photo's floor lies on the plan. */
  links: Record<string, PhotoLink>;
  /** Furniture found in linked photos, projected onto the plan (what is there now). */
  scanned?: { photoId: string; label: string; polygon: Pt[] }[];
}

export interface PlanRoom {
  id: string;
  name: string;
  type?: RoomType;
  polygon: Pt[];
}

/** A product standing somewhere in the house (plan pixels, real size in cm). */
export interface PlanItem {
  id: string;
  productId: string;
  x: number;
  y: number;
  /** Rotation on the plan in degrees; 0 = the product's front faces down the drawing. */
  angle: number;
  w: number;
  d: number;
  h?: number;
  flip: boolean;
  cutout: CutoutMode;
  tolerance: number;
  shadow?: number;
  light?: number;
  warmth?: number;
}

/** Four floor points in a photo (the floor surface's plane) and the same points on the plan. */
export interface PhotoLink {
  /** Surface layer in that photo whose plane is the floor. */
  floorId: string;
  plan: Quad;
  roomId?: string;
  /** Size of the photo (to rebuild its camera outside the photo editor). */
  imageW: number;
  imageH: number;
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
