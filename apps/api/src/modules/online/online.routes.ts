import { Router } from "express";
import { prisma } from "../../infrastructure/db.js";
import { redis, rkey } from "../../infrastructure/redis.js";
import { ONLINE_TTL_MS } from "../../shared/middleware/requireAuth.js";
import { resolveAvatar } from "../../shared/utils/resolveAvatar.js";
import { primaryGroupOrder } from "../../shared/utils/userRef.js";
import { optionalAuth } from "../../shared/middleware/requireAuth.js";
import { countGuests, noteRecord, touchGuest } from "../../shared/utils/onlineStats.js";

export const onlineRouter: Router = Router();

/**
 * Who is here: members (with names and groups), how many guests, and the record of
 * visitors at once. The footer's poll is also how a guest is counted (`touchGuest`).
 */
onlineRouter.get("/", optionalAuth, async (req, res) => {
  try {
    const now   = Date.now();
    const since = now - ONLINE_TTL_MS;

    // Lazily remove stale entries then fetch active user IDs
    await redis.zremrangebyscore(rkey("online:users"), 0, since);
    const onlineIds = await redis.zrangebyscore(rkey("online:users"), since, "+inf");

    await touchGuest(req);
    const guests = await countGuests();
    const record = await noteRecord(onlineIds.length + guests);

    if (onlineIds.length === 0) {
      return res.json({ total: 0, groups: [], users: [], guests, record });
    }

    const users = await prisma.user.findMany({
      where:  { id: { in: onlineIds } },
      select: {
        id:       true,
        username: true,
        avatar:   true,
        groups: {
          orderBy: primaryGroupOrder,
          include: {
            group: {
              select: {
                name:        true,
                key:         true,
                progression: { select: { badgeColor: true, badgeLabel: true } },
              },
            },
          },
        },
      },
    });

    const groupMap = new Map<string, {
      name: string; key: string;
      badgeColor: string | null; badgeLabel: string | null;
      count: number;
    }>();

    const userList: { username: string; avatar: string | null; groupKey: string; badgeColor: string | null }[] = [];

    for (const user of users) {
      const primary = user.groups[0];
      if (!primary) continue;
      const g = primary.group;

      userList.push({
      username:   user.username,
      avatar:     resolveAvatar(user.avatar),
      groupKey:   g.key,
      badgeColor: g.progression?.badgeColor ?? null,
    });

      const entry = groupMap.get(g.key);
      if (entry) {
        entry.count++;
      } else {
        groupMap.set(g.key, {
          name:       g.name,
          key:        g.key,
          badgeColor: g.progression?.badgeColor  ?? null,
          badgeLabel: g.progression?.badgeLabel  ?? null,
          count:      1,
        });
      }
    }

    res.json({
      total:  onlineIds.length,
      groups: [...groupMap.values()].sort((a, b) => b.count - a.count),
      users:  userList.sort((a, b) => a.username.localeCompare(b.username)),
      guests,
      record,
    });
  } catch {
    res.json({ total: 0, groups: [], guests: 0, record: null });
  }
});
