-- AlterTable
ALTER TABLE `settings`
    ADD COLUMN `yourlsApiUrl` VARCHAR(1024) NOT NULL DEFAULT '',
    ADD COLUMN `yourlsSignature` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `timezone` VARCHAR(191) NOT NULL DEFAULT 'UTC',
    ADD COLUMN `recaptchaSiteKey` VARCHAR(191) NOT NULL DEFAULT '',
    ADD COLUMN `recaptchaSecretKey` VARCHAR(191) NOT NULL DEFAULT '',
    DROP COLUMN `generatedLinksLength`;

-- DropTable
-- Short URLs are now created and stored by the configured YOURLS instance,
-- so the local table is no longer used.
DROP TABLE `shortenedLinks`;
