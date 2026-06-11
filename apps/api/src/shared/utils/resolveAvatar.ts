import { storage } from "../../infrastructure/storage/LocalStorageProvider.js";

export function resolveAvatar(avatar: string | null | undefined): string | null {
  if (!avatar) return null;
  if (avatar.startsWith("http") || avatar.startsWith("/uploads")) return avatar;
  return storage.publicUrl(avatar);
}

/** Mutate any object (or array of objects) that has an `avatar` field in-place. */
export function withResolvedAvatar<T extends { avatar?: string | null }>(obj: T): T {
  return { ...obj, avatar: resolveAvatar(obj.avatar ?? null) };
}

export function withResolvedAvatarList<T extends { avatar?: string | null }>(list: T[]): T[] {
  return list.map(withResolvedAvatar);
}
