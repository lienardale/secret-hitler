-- Hand-edited: "User"."email" and "displayName" are CITEXT, so the extension must exist
-- before any table does (Prisma 7 no longer emits extension DDL).
CREATE EXTENSION IF NOT EXISTS citext;

CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "UserLocale" AS ENUM ('fr', 'en');

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'MODERATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "EmailTokenPurpose" AS ENUM ('VERIFY_EMAIL');

-- CreateEnum
CREATE TYPE "GameVisibility" AS ENUM ('private', 'public');

-- CreateEnum
CREATE TYPE "GameOutcome" AS ENUM ('finished', 'abandoned');

-- CreateEnum
CREATE TYPE "GameTeam" AS ENUM ('liberal', 'fascist');

-- CreateEnum
CREATE TYPE "GameRole" AS ENUM ('liberal', 'fascist', 'hitler');

-- CreateEnum
CREATE TYPE "PlayerKind" AS ENUM ('user', 'guest');

-- CreateTable
CREATE TABLE "User" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" CITEXT NOT NULL,
    "emailVerified" TIMESTAMP(3),
    "passwordHash" VARCHAR(72),
    "displayName" CITEXT,
    "displayNameKey" VARCHAR(40),
    "displayNameChangedAt" TIMESTAMP(3),
    "ageConfirmedAt" TIMESTAMP(3),
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "locale" "UserLocale" NOT NULL DEFAULT 'fr',
    "sessionVersion" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "userId" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("provider","providerAccountId")
);

-- CreateTable
CREATE TABLE "EmailToken" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "purpose" "EmailTokenPurpose" NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" CHAR(64) NOT NULL,
    "count" INTEGER NOT NULL,
    "windowStart" TIMESTAMP(3) NOT NULL,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Block" (
    "blockerId" UUID NOT NULL,
    "blockedId" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("blockerId","blockedId")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" UUID NOT NULL,
    "room" CHAR(5) NOT NULL,
    "visibility" "GameVisibility" NOT NULL,
    "lang" "UserLocale" NOT NULL,
    "number" INTEGER NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL,
    "endedAt" TIMESTAMP(3) NOT NULL,
    "outcome" "GameOutcome" NOT NULL,
    "winner" "GameTeam",
    "reason" VARCHAR(32),
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GamePlayer" (
    "gameId" UUID NOT NULL,
    "seat" SMALLINT NOT NULL,
    "kind" "PlayerKind" NOT NULL,
    "userId" UUID,
    "name" VARCHAR(40),
    "role" "GameRole" NOT NULL,
    "alive" BOOLEAN NOT NULL,
    "won" BOOLEAN NOT NULL,
    "left" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "GamePlayer_pkey" PRIMARY KEY ("gameId","seat")
);

-- CreateTable
CREATE TABLE "GameLog" (
    "gameId" UUID NOT NULL,
    "data" JSONB NOT NULL,

    CONSTRAINT "GameLog_pkey" PRIMARY KEY ("gameId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_displayName_key" ON "User"("displayName");

-- CreateIndex
CREATE UNIQUE INDEX "User_displayNameKey_key" ON "User"("displayNameKey");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailToken_tokenHash_key" ON "EmailToken"("tokenHash");

-- CreateIndex
CREATE INDEX "EmailToken_userId_purpose_idx" ON "EmailToken"("userId", "purpose");

-- CreateIndex
CREATE INDEX "Block_blockedId_idx" ON "Block"("blockedId");

-- CreateIndex
CREATE INDEX "Game_endedAt_idx" ON "Game"("endedAt");

-- CreateIndex
CREATE INDEX "GamePlayer_userId_idx" ON "GamePlayer"("userId");

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailToken" ADD CONSTRAINT "EmailToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockerId_fkey" FOREIGN KEY ("blockerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Block" ADD CONSTRAINT "Block_blockedId_fkey" FOREIGN KEY ("blockedId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GamePlayer" ADD CONSTRAINT "GamePlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameLog" ADD CONSTRAINT "GameLog_gameId_fkey" FOREIGN KEY ("gameId") REFERENCES "Game"("id") ON DELETE CASCADE ON UPDATE CASCADE;

