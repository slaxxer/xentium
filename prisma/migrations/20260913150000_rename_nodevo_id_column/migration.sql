-- The last database object carrying the old name: the platform-migration map's
-- pointer to the Xentium-side entity it created.
ALTER TABLE xcf_import_map RENAME COLUMN nodevo_id TO xentium_id;
ALTER INDEX IF EXISTS ncf_import_map_nodevo_id_idx RENAME TO xcf_import_map_xentium_id_idx;
ALTER INDEX IF EXISTS xcf_import_map_nodevo_id_idx RENAME TO xcf_import_map_xentium_id_idx;
