-- AlterTable
ALTER TABLE `albums`
    ADD COLUMN `identifier` VARCHAR(32) NULL;

-- CreateIndex
CREATE UNIQUE INDEX `albums_identifier_key` ON `albums`(`identifier`);

-- AlterTable
ALTER TABLE `files`
    MODIFY `name` VARCHAR(2048) NOT NULL;
