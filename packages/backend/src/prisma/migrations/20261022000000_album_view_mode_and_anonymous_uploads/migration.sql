-- AlterTable
ALTER TABLE `albums` ADD COLUMN `viewMode` VARCHAR(191) NOT NULL DEFAULT 'thumbs';

-- AlterTable
ALTER TABLE `links` ADD COLUMN `viewMode` VARCHAR(191) NULL,
    ADD COLUMN `allowUploads` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `hideFiles` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `settings` ADD COLUMN `anonymousUploadsEnabled` BOOLEAN NOT NULL DEFAULT true,
    ADD COLUMN `anonymousUploadsPerIpLimit` INTEGER NOT NULL DEFAULT 100,
    ADD COLUMN `anonymousUploadsWindowMinutes` INTEGER NOT NULL DEFAULT 60,
    ADD COLUMN `anonymousUploadsMaxSize` VARCHAR(191) NOT NULL DEFAULT '0';
