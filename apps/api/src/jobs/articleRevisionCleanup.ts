import { Worker, type Job } from "bullmq";
import { prisma } from "../infrastructure/db.js";
import { bullConnection, bullPrefix } from "../infrastructure/queue.js";

// §47 — keep at most N most recent revisions per article. Setting key
// articles.max_revisions_per_article overrides the default (20, minimum 5).

const DEFAULT_MAX_REVISIONS = 20;
const MIN_MAX_REVISIONS = 5;

interface JobPayload {
  articleId: string;
}

async function getMaxRevisions(): Promise<number> {
  const setting = await prisma.setting.findUnique({
    where: { key: "articles.max_revisions_per_article" },
  });
  const raw = typeof setting?.value === "number" ? setting.value : DEFAULT_MAX_REVISIONS;
  return Math.max(MIN_MAX_REVISIONS, raw);
}

export async function processArticleRevisionCleanup(job: Job<JobPayload>): Promise<void> {
  const { articleId } = job.data;
  const limit = await getMaxRevisions();

  // Find the cutoff: the createdAt of the Nth most-recent revision. Anything older is removed.
  const keep = await prisma.articleRevision.findMany({
    where: { articleId },
    orderBy: { createdAt: "desc" },
    take: limit,
    select: { id: true },
  });
  const keepIds = keep.map((r) => r.id);
  if (keepIds.length === 0) return;

  await prisma.articleRevision.deleteMany({
    where: { articleId, id: { notIn: keepIds } },
  });
}

export function startArticleRevisionCleanupWorker(): Worker<JobPayload> {
  return new Worker<JobPayload>("article-revision-cleanup", processArticleRevisionCleanup, {
    connection: bullConnection,
    prefix: bullPrefix,
  });
}
