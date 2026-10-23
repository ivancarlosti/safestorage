-- AlterTable
ALTER TABLE `settings`
    ADD COLUMN `showFooter` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showDocsMenu` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showGuidesMenu` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showFaqMenu` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `showGithubIcon` BOOLEAN NOT NULL DEFAULT true;
