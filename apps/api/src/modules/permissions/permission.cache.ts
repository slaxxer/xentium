import { redis, rkey } from "../../infrastructure/redis.js";
import { prisma } from "../../infrastructure/db.js";

const TTL_SECONDS = 300; // 5 minutes — matches §27

export const permissionCache = {
  async getEffective(userId: string): Promise<string[] | null> {
    const cached = await redis.get(rkey("perm:user", userId));
    return cached ? (JSON.parse(cached) as string[]) : null;
  },

  async setEffective(userId: string, perms: string[]): Promise<void> {
    await redis.setex(rkey("perm:user", userId), TTL_SECONDS, JSON.stringify(perms));
  },

  async invalidate(userId: string): Promise<void> {
    await redis.del(rkey("perm:user", userId));
  },

  // Invalidate cache for all members of a group — used after group permission changes
  async invalidateForGroup(groupId: string): Promise<void> {
    const members = await prisma.userGroup.findMany({
      where: { groupId },
      select: { userId: true },
    });
    if (members.length === 0) return;
    const keys = members.map((m) => rkey("perm:user", m.userId));
    await redis.del(...keys);
  },
};
