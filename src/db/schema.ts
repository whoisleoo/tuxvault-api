import { pgTable, uuid, text, boolean, bigint, timestamp, jsonb, index } from 'drizzle-orm/pg-core'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'

export const users = pgTable('users', {
  id:          uuid('id').primaryKey().defaultRandom(),
  username:    text('username').unique().notNull(),
  role:        text('role').notNull().default('user'),
  displayName: text('display_name'),
  createdAt:   timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  lastLogin:   timestamp('last_login', { withTimezone: true }),
})

export const files = pgTable('files', {
  id:            uuid('id').primaryKey().defaultRandom(),
  name:          text('name').notNull(),
  path:          text('path').unique().notNull(),
  parentId:      uuid('parent_id').references((): AnyPgColumn => files.id),
  isDirectory:   boolean('is_directory').notNull(),
  size:          bigint('size', { mode: 'number' }),
  mimeType:      text('mime_type'),
  extension:     text('extension'),
  ownerUsername: text('owner_username').notNull(),
  favorited:     boolean('favorited').notNull().default(false),
  inTrash:       boolean('in_trash').notNull().default(false),
  trashedAt:     timestamp('trashed_at', { withTimezone: true }),
  createdAt:     timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt:     timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index('idx_files_parent_id').on(table.parentId),
  index('idx_files_path').on(table.path),
  index('idx_files_owner').on(table.ownerUsername),
  index('idx_files_trash').on(table.inTrash),
])

export const pendingTwoFa = pgTable('pending_2fa', {
  id:        uuid('id').primaryKey().defaultRandom(),
  username:  text('username').notNull(),
  ipAddress: text('ip_address'),
  otpHash: text('otp_hash').notNull(),
  approved:  boolean('approved').notNull().default(false),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})

export const auditLog = pgTable('audit_log', {
  id:        uuid('id').primaryKey().defaultRandom(),
  userId:    uuid('user_id').references(() => users.id),
  action:    text('action').notNull(),
  fileId:    uuid('file_id').references(() => files.id),
  fileName:  text('file_name').notNull(),
  filePath:  text('file_path').notNull(),
  extra:     jsonb('extra'),
  ipAddress: text('ip_address'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
})
