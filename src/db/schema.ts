import { boolean, integer, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  isAdmin: boolean("is_admin").notNull().default(false),
});

export const matches = pgTable("matches", {
  id: integer("id").primaryKey(), // football-data.org match id
  stage: text("stage").notNull(), // GROUP_STAGE | LAST_32 | LAST_16 | QUARTER_FINALS | SEMI_FINALS | THIRD_PLACE | FINAL
  groupName: text("group_name"),
  kickoffUtc: timestamp("kickoff_utc", { withTimezone: true }).notNull(),
  status: text("status").notNull(), // SCHEDULED | TIMED | IN_PLAY | PAUSED | FINISHED ...
  homeTeam: text("home_team"),
  awayTeam: text("away_team"),
  homeScore: integer("home_score"),
  awayScore: integer("away_score"),
});

export const predictions = pgTable(
  "predictions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => users.id),
    matchId: integer("match_id").notNull().references(() => matches.id),
    homeScore: integer("home_score").notNull(),
    awayScore: integer("away_score").notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("predictions_user_match").on(t.userId, t.matchId)],
);

export const bonusPicks = pgTable("bonus_picks", {
  userId: integer("user_id").primaryKey().references(() => users.id),
  championTeam: text("champion_team"),
  goldenBootPlayer: text("golden_boot_player"),
  darkHorseTeam: text("dark_horse_team"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const meta = pgTable("meta", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});
