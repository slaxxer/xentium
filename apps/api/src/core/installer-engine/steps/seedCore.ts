import { registerCorePermissions } from "../../../bootstrap/registerCorePermissions.js";
import { seedSystemProfileFields } from "../../../bootstrap/seedSystemProfileFields.js";
export async function seedCore(): Promise<void> {
  await registerCorePermissions();
  await seedSystemProfileFields();
}
