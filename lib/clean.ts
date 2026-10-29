/** Removes undefined values (Firestore throws on them) by round-tripping through JSON. */
export const dropUndefined = <T>(v: T): T => JSON.parse(JSON.stringify(v ?? null)) as T;
