/*
	The three built-in roles are *data*, not schema, so `prisma migrate dev` cannot
	express them. They are seeded here because the application expects them to
	exist before it creates the first account: `createAdminUserIfNotExists` (see
	packages/backend/src/utils/Util.ts) connects the initial `admin` user to the
	`owner` and `admin` roles, and fails with P2025 when they are missing.

	The old SQLite migration history seeded the same three rows in
	`20230708062855_add_user_roles`; this migration keeps that behaviour in the
	MySQL baseline.
*/
INSERT INTO `roles` (`name`) VALUES ('owner');
INSERT INTO `roles` (`name`) VALUES ('admin');
INSERT INTO `roles` (`name`) VALUES ('user');
