-- CreateTable
CREATE TABLE `albumMembers` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `albumId` INTEGER NOT NULL,
    `userId` INTEGER NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    INDEX `albumMembers_userId_idx`(`userId`),
    UNIQUE INDEX `albumMembers_albumId_userId_key`(`albumId`, `userId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AlterTable
ALTER TABLE `invites`
    ADD COLUMN `email` VARCHAR(255) NULL,
    ADD COLUMN `albumId` INTEGER NULL;

-- AlterTable
ALTER TABLE `settings`
    ADD COLUMN `instanceUrl` VARCHAR(1024) NOT NULL DEFAULT '',
    ADD COLUMN `smtpEnabled` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `smtpHost` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `smtpPort` INTEGER NOT NULL DEFAULT 587,
    ADD COLUMN `smtpSecure` BOOLEAN NOT NULL DEFAULT false,
    ADD COLUMN `smtpUser` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `smtpPassword` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `smtpFrom` VARCHAR(191) NOT NULL DEFAULT '';

-- AddForeignKey
ALTER TABLE `albumMembers` ADD CONSTRAINT `albumMembers_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `albums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `albumMembers` ADD CONSTRAINT `albumMembers_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `invites` ADD CONSTRAINT `invites_albumId_fkey` FOREIGN KEY (`albumId`) REFERENCES `albums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
