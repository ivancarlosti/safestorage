-- CreateTable
CREATE TABLE `users` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `username` VARCHAR(191) NOT NULL,
    `password` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `storageQuota` VARCHAR(191) NOT NULL DEFAULT '0',
    `apiKey` VARCHAR(191) NULL,
    `passwordEditedAt` DATETIME(3) NULL,
    `apiKeyEditedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    UNIQUE INDEX `users_uuid_key`(`uuid`),
    UNIQUE INDEX `users_username_key`(`username`),
    UNIQUE INDEX `users_apiKey_key`(`apiKey`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `roles` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `name` VARCHAR(191) NOT NULL,

    UNIQUE INDEX `roles_name_key`(`name`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `files` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `name` VARCHAR(255) NOT NULL,
    `original` VARCHAR(1024) NOT NULL,
    `type` VARCHAR(255) NOT NULL,
    `size` VARCHAR(191) NOT NULL,
    `hash` VARCHAR(191) NOT NULL,
    `ip` VARCHAR(191) NOT NULL,
    `sourceUrl` VARCHAR(1024) NULL,
    `isS3` BOOLEAN NOT NULL DEFAULT false,
    `isWatched` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `quarantine` BOOLEAN NOT NULL DEFAULT false,

    UNIQUE INDEX `files_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `quarantineFiles` (
    `fileId` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `reason` TEXT NULL,

    UNIQUE INDEX `quarantineFiles_fileId_key`(`fileId`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `snippets` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `content` LONGTEXT NOT NULL,
    `language` VARCHAR(191) NOT NULL,
    `parentUuid` VARCHAR(191) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    UNIQUE INDEX `snippets_uuid_key`(`uuid`),
    UNIQUE INDEX `snippets_identifier_key`(`identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `shortenedLinks` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `destination` VARCHAR(2048) NOT NULL,
    `views` INTEGER NOT NULL DEFAULT 0,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    UNIQUE INDEX `shortenedLinks_uuid_key`(`uuid`),
    UNIQUE INDEX `shortenedLinks_identifier_key`(`identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `albums` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(255) NOT NULL,
    `description` TEXT NULL,
    `zippedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,
    `nsfw` BOOLEAN NOT NULL DEFAULT false,
    `sortOrder` VARCHAR(191) NULL,

    UNIQUE INDEX `albums_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `bans` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `ip` VARCHAR(191) NOT NULL,
    `reason` TEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `links` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `albumId` INTEGER NOT NULL,
    `identifier` VARCHAR(191) NOT NULL,
    `views` INTEGER NOT NULL DEFAULT 0,
    `enabled` BOOLEAN NOT NULL DEFAULT true,
    `enableDownload` BOOLEAN NOT NULL DEFAULT false,
    `expiresAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    UNIQUE INDEX `links_uuid_key`(`uuid`),
    UNIQUE INDEX `links_identifier_key`(`identifier`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `settings` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `rateLimitWindow` INTEGER NOT NULL,
    `rateLimitMax` INTEGER NOT NULL,
    `secret` VARCHAR(191) NOT NULL,
    `serviceName` VARCHAR(191) NOT NULL,
    `chunkSize` VARCHAR(191) NOT NULL,
    `chunkedUploadsTimeout` INTEGER NOT NULL,
    `maxSize` VARCHAR(191) NOT NULL,
    `generateZips` BOOLEAN NOT NULL,
    `generateOriginalFileNameWithIdentifier` BOOLEAN NOT NULL DEFAULT false,
    `generatedFilenameLength` INTEGER NOT NULL,
    `generatedAlbumLength` INTEGER NOT NULL,
    `generatedLinksLength` INTEGER NOT NULL DEFAULT 8,
    `saveDuplicatesToAlbum` BOOLEAN NOT NULL DEFAULT false,
    `blockedExtensions` TEXT NOT NULL,
    `blockNoExtension` BOOLEAN NOT NULL,
    `publicMode` BOOLEAN NOT NULL,
    `userAccounts` BOOLEAN NOT NULL,
    `disableStatisticsCron` BOOLEAN NOT NULL,
    `disableUpdateCheck` BOOLEAN NOT NULL DEFAULT false,
    `backgroundImageURL` VARCHAR(1024) NOT NULL,
    `logoURL` VARCHAR(1024) NOT NULL,
    `metaDescription` TEXT NOT NULL,
    `metaKeywords` TEXT NOT NULL,
    `metaTwitterHandle` VARCHAR(191) NOT NULL,
    `metaDomain` VARCHAR(191) NOT NULL DEFAULT '',
    `serveUploadsFrom` VARCHAR(191) NOT NULL DEFAULT '',
    `enableMixedCaseFilenames` BOOLEAN NOT NULL DEFAULT true,
    `usersStorageQuota` VARCHAR(191) NOT NULL DEFAULT '0',
    `useNetworkStorage` BOOLEAN NOT NULL DEFAULT false,
    `useUrlShortener` BOOLEAN NOT NULL DEFAULT false,
    `generateThumbnails` BOOLEAN NOT NULL DEFAULT true,
    `privacyPolicyPageContent` LONGTEXT NOT NULL,
    `termsOfServicePageContent` LONGTEXT NOT NULL,
    `rulesPageContent` LONGTEXT NOT NULL,
    `S3Region` VARCHAR(191) NOT NULL DEFAULT '',
    `S3Bucket` VARCHAR(191) NOT NULL DEFAULT '',
    `S3AccessKey` VARCHAR(191) NOT NULL DEFAULT '',
    `S3SecretKey` VARCHAR(191) NOT NULL DEFAULT '',
    `S3Endpoint` VARCHAR(1024) NOT NULL DEFAULT '',
    `S3PathStyle` BOOLEAN NOT NULL DEFAULT false,
    `S3PublicUrl` VARCHAR(1024) NOT NULL DEFAULT '',
    `defaultSortOrder` VARCHAR(191) NOT NULL DEFAULT 'createdAt:desc',

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `statistics` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `batchId` INTEGER NULL,
    `type` VARCHAR(191) NULL,
    `data` LONGTEXT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),

    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `tags` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `uuid` VARCHAR(191) NOT NULL,
    `userId` INTEGER NOT NULL,
    `name` VARCHAR(191) NOT NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    UNIQUE INDEX `tags_uuid_key`(`uuid`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `invites` (
    `id` INTEGER NOT NULL AUTO_INCREMENT,
    `createdBy` VARCHAR(191) NOT NULL,
    `usedBy` VARCHAR(191) NULL,
    `code` VARCHAR(191) NOT NULL,
    `used` BOOLEAN NOT NULL DEFAULT false,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `editedAt` DATETIME(3) NULL,

    UNIQUE INDEX `invites_code_key`(`code`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_rolesTousers` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_rolesTousers_AB_unique`(`A`, `B`),
    INDEX `_rolesTousers_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_filesTotags` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_filesTotags_AB_unique`(`A`, `B`),
    INDEX `_filesTotags_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- CreateTable
CREATE TABLE `_albumsTofiles` (
    `A` INTEGER NOT NULL,
    `B` INTEGER NOT NULL,

    UNIQUE INDEX `_albumsTofiles_AB_unique`(`A`, `B`),
    INDEX `_albumsTofiles_B_index`(`B`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `files` ADD CONSTRAINT `files_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `quarantineFiles` ADD CONSTRAINT `quarantineFiles_fileId_fkey` FOREIGN KEY (`fileId`) REFERENCES `files`(`uuid`) ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `shortenedLinks` ADD CONSTRAINT `shortenedLinks_userId_fkey` FOREIGN KEY (`userId`) REFERENCES `users`(`id`) ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_rolesTousers` ADD CONSTRAINT `_rolesTousers_A_fkey` FOREIGN KEY (`A`) REFERENCES `roles`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_rolesTousers` ADD CONSTRAINT `_rolesTousers_B_fkey` FOREIGN KEY (`B`) REFERENCES `users`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_filesTotags` ADD CONSTRAINT `_filesTotags_A_fkey` FOREIGN KEY (`A`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_filesTotags` ADD CONSTRAINT `_filesTotags_B_fkey` FOREIGN KEY (`B`) REFERENCES `tags`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_albumsTofiles` ADD CONSTRAINT `_albumsTofiles_A_fkey` FOREIGN KEY (`A`) REFERENCES `albums`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE `_albumsTofiles` ADD CONSTRAINT `_albumsTofiles_B_fkey` FOREIGN KEY (`B`) REFERENCES `files`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
