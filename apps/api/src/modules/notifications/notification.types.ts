export type NotificationChannel = "in_app" | "email";

export interface DispatchOptions {
  userId: string;
  type: string;
  title: string;
  body: string;
  link?: string;
  meta?: Record<string, unknown>;
  senderUserId?: string;  // enriches meta with senderUsername + senderAvatar at dispatch time
  channels: NotificationChannel[];
}

export interface NotificationPreferenceResolved {
  inAppEnabled: boolean;
  emailEnabled: boolean;
}
