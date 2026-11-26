-- AlterTable
ALTER TABLE `albums`
    ADD COLUMN `isWebsite` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `links`
    ADD COLUMN `serveWebsite` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `files`
    ADD COLUMN `sitePath` VARCHAR(1024) NULL;

-- AlterTable
ALTER TABLE `settings`
    ADD COLUMN `websiteHostingEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `websiteHostingDomain` VARCHAR(255) NOT NULL DEFAULT '';
