/** 计算被阻断（契约 §9.1 BLOCKED-FORMAL 一类）：不出结果，只给原因码。 */
export class BlockedError extends Error {
  constructor(public readonly code: string, message: string) {
    super(message);
    this.name = "BlockedError";
  }
}
