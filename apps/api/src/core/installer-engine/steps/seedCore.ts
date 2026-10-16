import { registerCorePermissions } from "../../../bootstrap/registerCorePermissions.js";
import { seedSystemProfileFields } from "../../../bootstrap/seedSystemProfileFields.js";
import { seedDefaultNavItems } from "../../../bootstrap/seedDefaultNavItems.js";
import { ensureBundledThemes } from "../../../modules/themes/bundledThemes.js";
import { ensureDefaultEmojis } from "../../../modules/emojis/defaultEmojis.js";
export async function seedCore(): Promise<void> {
  await registerCorePermissions();
  await seedSystemProfileFields();
  await seedDefaultNavItems();
  // Xentium Dark in the library from the first day, so readers can pick it.
  await ensureBundledThemes();
  // The default smileys in the emoji picker.
  await ensureDefaultEmojis();
}
