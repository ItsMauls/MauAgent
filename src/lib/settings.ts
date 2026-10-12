import { db } from "@/lib/db";

/** Singleton settings row, created with defaults on first read. */
export const getSettings = () => db.setting.upsert({ where: { id: "default" }, create: {}, update: {} });
