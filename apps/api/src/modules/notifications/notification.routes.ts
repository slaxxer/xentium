import { Router } from "express";
import { requireAuth } from "../../shared/middleware/requireAuth.js";
import { notificationController } from "./notification.controller.js";

export const notificationRouter: Router = Router();

notificationRouter.use(requireAuth);

notificationRouter.get("/",              notificationController.list);
notificationRouter.get("/unread-count",  notificationController.unreadCount);
notificationRouter.post("/read-all",     notificationController.markAllRead);
notificationRouter.patch("/:id/read",    notificationController.markRead);
