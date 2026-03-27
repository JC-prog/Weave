import { sql, relations } from 'drizzle-orm';
import {
  pgSchema,
  uuid,
  varchar,
  timestamp,
} from 'drizzle-orm/pg-core';

// ─── Auth Schema ─────────────────────────────────────────────────────────────
export const authSchema = pgSchema('auth');

// ─── Users ────────────────────────────────────────────────────────────────────
export const users = authSchema.table('users', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  email: varchar('email', { length: 255 }).notNull().unique(),
  passwordHash: varchar('password_hash', { length: 500 }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── API Keys ─────────────────────────────────────────────────────────────────
export const apiKeys = authSchema.table('api_keys', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  keyHash: varchar('key_hash', { length: 500 }).notNull(),
  name: varchar('name', { length: 100 }).notNull(),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Refresh Tokens ───────────────────────────────────────────────────────────
export const refreshTokens = authSchema.table('refresh_tokens', {
  id: uuid('id')
    .primaryKey()
    .default(sql`uuid_generate_v4()`),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenHash: varchar('token_hash', { length: 500 }).notNull(),
  expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  createdAt: timestamp('created_at', { withTimezone: true })
    .notNull()
    .defaultNow(),
});

// ─── Relations ────────────────────────────────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  apiKeys: many(apiKeys),
  refreshTokens: many(refreshTokens),
}));

export const apiKeysRelations = relations(apiKeys, ({ one }) => ({
  user: one(users, {
    fields: [apiKeys.userId],
    references: [users.id],
  }),
}));

export const refreshTokensRelations = relations(refreshTokens, ({ one }) => ({
  user: one(users, {
    fields: [refreshTokens.userId],
    references: [users.id],
  }),
}));

// ─── Inferred Types ───────────────────────────────────────────────────────────
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type ApiKey = typeof apiKeys.$inferSelect;
export type NewApiKey = typeof apiKeys.$inferInsert;
export type RefreshToken = typeof refreshTokens.$inferSelect;
export type NewRefreshToken = typeof refreshTokens.$inferInsert;
