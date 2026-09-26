import { roomLabel } from "./categories";
import { migrateProject } from "./migrate";
import type { Project, RoomType } from "./types";

const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "ontwerp";

export function exportFileName(project: Project, room: RoomType): string {
  const house = slug(project.listing?.title ?? "mijn-huis");
  return `${house}-${slug(roomLabel(room))}-${new Date().toISOString().slice(0, 10)}.jpg`;
}

/** Whole project (listing, products, designs) as a JSON file: a backup, or to continue on another device. */
export function backupBlob(project: Project): Blob {
  return new Blob([JSON.stringify({ app: "furnuture", version: 1, savedAt: new Date().toISOString(), project })], {
    type: "application/json",
  });
}

export function backupFileName(project: Project): string {
  return `furnuture-${slug(project.listing?.title ?? "project")}-${new Date().toISOString().slice(0, 10)}.json`;
}

export async function readBackup(file: File): Promise<Project> {
  const data = JSON.parse(await file.text());
  const project = data?.app === "furnuture" ? data.project : data;
  if (!project || !Array.isArray(project.products) || typeof project.scenes !== "object") {
    throw new Error("Dit is geen furnuture-back-up.");
  }
  return migrateProject({ listing: project.listing ?? null, products: project.products, scenes: project.scenes ?? {} });
}
