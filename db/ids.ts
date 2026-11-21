// 机器 ID：UUIDv7（契约 §1.2）。时间戳 48 位毫秒 + 随机位；不联网、不依赖外部包。
import { randomBytes } from "node:crypto";

export function uuidv7(now: number = Date.now()): string {
  const b = randomBytes(16);
  const ms = BigInt(now);
  for (let k = 0; k < 6; k++) b[k] = Number((ms >> BigInt(8 * (5 - k))) & 0xffn);
  b[6] = (b[6]! & 0x0f) | 0x70; // version 7
  b[8] = (b[8]! & 0x3f) | 0x80; // variant 10
  const h = b.toString("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
export const UUIDV7_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
