-- AlterTable
ALTER TABLE `albums`
    ADD COLUMN `notifyOnPublicUpload` BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE `settings`
    ADD COLUMN `anonymousUploadNotificationsEnabled` BOOLEAN NOT NULL DEFAULT false;
