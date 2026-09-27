import { guessCategory } from "./categories";
import { assignPhotos, defaultRooms, newId } from "./rooms";
import type { Category, Dims, Item, ItemStatus, Listing, Project, Room, RoomType } from "./types";

type Raw = Record<string, unknown>;

/** A product of version 2 (a collection of links with a status and a room type). */
interface OldProduct {
  id?: string;
  url?: string;
  title?: string;
  image?: string;
  images?: string[];
  thumb?: string;
  priceValue?: number;
  shop?: string;
  category?: Category;
  status?: "optie" | "favoriet" | "afgewezen";
  note?: string;
  color?: string;
  room?: RoomType;
  dims?: Dims;
}

const STATUSES: ItemStatus[] = ["idee", "gekozen", "besteld", "binnen"];

/** Any saved shape (this version, version 2, or the first single record) as a project of this version. */
export function migrate(raw: unknown): Project {
  const r = (raw ?? {}) as Raw;
  const oldListing = (r.listing ?? null) as Listing | null;
  const listing: Listing | null = oldListing
    ? { ...oldListing, photos: (oldListing.photos ?? []).map((p) => ({ id: p.id, url: p.url, room: p.room ?? "overig", roomId: p.roomId })) }
    : null;
  let rooms = Array.isArray(r.rooms) ? (r.rooms as Room[]) : null;
  let items = Array.isArray(r.items) ? (r.items as Item[]) : null;

  if (!rooms) rooms = listing || Array.isArray(r.products) ? defaultRooms(listing) : [];
  if (!items) {
    // Version 2: products → items in the first room of their kind. Rejected ones are left out.
    const products = (Array.isArray(r.products) ? r.products : []) as OldProduct[];
    items = products
      .filter((p) => p.status !== "afgewezen" && (p.url || p.title))
      .map((p, i) => ({
        id: p.id ?? newId(),
        roomId: rooms!.find((room) => room.type === p.room)?.id ?? null,
        title: p.title || p.shop || "Product",
        url: p.url,
        image: p.image || undefined,
        images: p.images ?? [],
        thumb: p.thumb,
        shop: p.shop,
        price: p.priceValue,
        qty: 1,
        category: p.category ?? guessCategory(p.title),
        status: p.status === "favoriet" ? "gekozen" : "idee",
        note: p.note ?? "",
        dims: p.dims,
        color: p.color,
        addedAt: Date.now() - (products.length - i) * 1000,
        source: "link",
      }));
  }
  items = items.map((it) => ({
    ...it,
    qty: it.qty > 0 ? it.qty : 1,
    images: it.images ?? [],
    note: it.note ?? "",
    status: STATUSES.includes(it.status) ? it.status : "idee",
    category: it.category ?? "overig",
  }));
  return {
    listing: listing ? { ...listing, photos: assignPhotos(listing.photos, rooms) } : null,
    rooms,
    items,
    budget: typeof r.budget === "number" ? r.budget : undefined,
    style: typeof r.style === "string" ? r.style : undefined,
  };
}
