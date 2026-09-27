import { renovationOf } from "./renovation";
import type { Project, Quote, Renovation, Task } from "./types";

type P = Project;

export const patchRenovation = (patch: Partial<Renovation>) => (p: P): P => ({ ...p, renovation: { ...renovationOf(p), ...patch } });
const withTasks = (p: P, fn: (tasks: Task[]) => Task[]): P => ({ ...p, renovation: { ...renovationOf(p), tasks: fn(renovationOf(p).tasks) } });

export const addTasks = (tasks: Task[]) => (p: P): P => withTasks(p, (ts) => [...ts, ...tasks]);
export const patchTask = (id: string, patch: Partial<Task>) => (p: P): P => withTasks(p, (ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
export const removeTask = (id: string) => (p: P): P => withTasks(p, (ts) => ts.filter((t) => t.id !== id));
export const replaceTasks = (tasks: Task[]) => (p: P): P => withTasks(p, () => tasks);

/** A new quote; the first one moves the job to "Offertes". */
export const addQuote = (taskId: string, quote: Quote) => (p: P): P =>
  withTasks(p, (ts) => ts.map((t) => (t.id === taskId ? { ...t, quotes: [...t.quotes, quote], status: t.status === "idee" ? "offerte" : t.status } : t)));
export const removeQuote = (taskId: string, quoteId: string) => (p: P): P =>
  withTasks(p, (ts) => ts.map((t) => (t.id === taskId ? { ...t, quotes: t.quotes.filter((q) => q.id !== quoteId), chosenQuote: t.chosenQuote === quoteId ? undefined : t.chosenQuote } : t)));
/** Choosing a quote fixes the price; the job moves on to "Gepland". */
export const chooseQuote = (taskId: string, quoteId: string | undefined) => (p: P): P =>
  withTasks(p, (ts) =>
    ts.map((t) => (t.id === taskId ? { ...t, chosenQuote: quoteId, status: quoteId && (t.status === "idee" || t.status === "offerte") ? "gepland" : t.status } : t)),
  );
