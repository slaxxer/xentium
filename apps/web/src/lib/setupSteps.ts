/**
 * Where each setup step is done. Shared by the ACP dashboard's setup card and the
 * home page's "Set up your site" card, which ask the same checklist
 * (`/admin/dashboard/overview` and `/admin/dashboard/setup`). Kept out of the ACP
 * chunk so the home page does not pull the admin panel in to read five links.
 */
export const SETUP_STEP_LINK: Record<string, string> = {
  siteName: "/admin/settings", email: "/admin/email", categories: "/admin/articles?view=categories",
  article: "/articles/new", theme: "/admin/themes",
};

export interface SetupStep { key: string; done: boolean; detail?: string | null }
