import { migrate } from "./migrate";
import type { Project } from "./types";

export const slug = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 40) || "project";

/** Whole project as a JSON file: a backup, or to continue on another device. */
export function backupBlob(project: Project): Blob {
  return new Blob([JSON.stringify({ app: "furnuture", version: 3, savedAt: new Date().toISOString(), project })], { type: "application/json" });
}

export const backupFileName = (project: Project) => `furnuture-${slug(project.listing?.title ?? "project")}-${new Date().toISOString().slice(0, 10)}.json`;

export async function readBackup(file: File): Promise<Project> {
  const data = JSON.parse(await file.text());
  const project = data?.app === "furnuture" ? data.project : data;
  if (!project || typeof project !== "object" || !(Array.isArray(project.items) || Array.isArray(project.products))) {
    throw new Error("Dit is geen furnuture-back-up.");
  }
  return migrate(project);
}

/** Shares a file (iPad share sheet) or downloads it. */
export async function shareOrDownload(blob: Blob, name: string): Promise<void> {
  const file = new File([blob], name, { type: blob.type });
  try {
    if (navigator.canShare?.({ files: [file] })) {
      await navigator.share({ files: [file] });
      return;
    }
  } catch (e) {
    if ((e as Error).name === "AbortError") return;
  }
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
