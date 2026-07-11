/** The minimal user reference every list/moderation endpoint returns when it
 *  names a user: enough to render a linked <Username> with its group badge
 *  colour. Built server-side via toUserRef() (apps/api shared/utils/userRef). */
export interface UserRef {
  id: string;
  username: string;
  badgeColor: string | null;
}
