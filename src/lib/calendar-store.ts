import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { CalendarDb } from "@/lib/calendar-types";

const DB_PATH = path.join(process.cwd(), "data", "calendar-db.json");

let writeChain = Promise.resolve();

export async function readCalendarDb(): Promise<CalendarDb> {
  const raw = await readFile(DB_PATH, "utf8");
  return JSON.parse(raw) as CalendarDb;
}

export async function updateCalendarDb(mutator: (current: CalendarDb) => CalendarDb | Promise<CalendarDb>) {
  writeChain = writeChain.then(async () => {
    const current = await readCalendarDb();
    const next = await mutator(current);
    await writeFile(DB_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  });

  await writeChain;
}
