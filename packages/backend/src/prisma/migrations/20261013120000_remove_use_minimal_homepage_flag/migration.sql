-- The minimal homepage is now the only homepage design, so the flag that used
-- to switch between the full and the minimal version is no longer needed.
ALTER TABLE "settings" DROP COLUMN "useMinimalHomepage";
