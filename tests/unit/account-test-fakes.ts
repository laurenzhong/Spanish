// @vitest-environment node

import { expect } from "vitest";

import type {
  AccountAdminRepository,
  AccountAdminUser,
  AccountInvitationRecord,
  CreateInvitationRecordInput,
  ListInvitationsOptions,
  ListInvitationsResult,
  RedeemInvitationCasInput,
} from "@/src/modules/account/repositories";
import type {
  AccountProvisioner,
  CreatedAuthUser,
} from "@/src/modules/account/providers";
import type { AccountRole, AccountStatus } from "@/src/modules/account/domain/account-admin";
import type {
  AccountBusinessDataDeletionResult,
  AccountDataDeletionResult,
  AccountDataSummary,
  AccountExportSnapshot,
  CharacterDataDeletionResult,
  PrivacyRepository,
  SavedAudioRecord,
  SavedTranscriptRecord,
  StorageCleanupStatus,
  StorageCleanupTask,
} from "@/src/modules/privacy/repositories";
import type { StorageObjectDeleter } from "@/src/modules/privacy";
import type { AccountActionError } from "@/src/modules/account/errors";
import type {
  AdminAuditEntry,
  AdminAuditListFilters,
  AdminAuditRecord,
  AdminAuditRepository,
} from "@/src/modules/admin";

export const TEST_NOW = new Date("2026-10-21T12:00:00.000Z");

let uuidCounter = 0;

export function nextTestUuid(): string {
  uuidCounter += 1;
  return `00000000-0000-4000-8000-${String(uuidCounter).padStart(12, "0")}`;
}

export function testUuid(value: number): string {
  return `00000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };
type StoredInvitation = Mutable<AccountInvitationRecord>;
type StoredUser = Mutable<AccountAdminUser>;

function cloneInvitation(
  record: AccountInvitationRecord,
): AccountInvitationRecord {
  return { ...record };
}

function cloneUser(user: AccountAdminUser): AccountAdminUser {
  return { ...user };
}

export type SeedUserInput = Readonly<{
  userId?: string;
  publicUid: string;
  displayName?: string | null;
  role?: AccountRole;
  status?: AccountStatus;
  deletionRequestedAt?: Date | null;
}>;

/**
 * In-memory `AccountAdminRepository` that mirrors the real CAS semantics and
 * records a shared event log so ordering tests can assert DB-then-provider order.
 */
export class FakeAccountAdminRepository implements AccountAdminRepository {
  readonly invitations: StoredInvitation[] = [];
  readonly users: StoredUser[] = [];
  readonly reservedPublicUids = new Set<string>();
  readonly events: string[];

  failCreateInvitation = false;

  constructor(events: string[] = []) {
    this.events = events;
  }

  seedUser(input: SeedUserInput): AccountAdminUser {
    const user: AccountAdminUser = {
      userId: input.userId ?? nextTestUuid(),
      publicUid: input.publicUid,
      displayName: input.displayName ?? null,
      role: input.role ?? "member",
      status: input.status ?? "active",
      deletionRequestedAt: input.deletionRequestedAt ?? null,
      createdAt: TEST_NOW,
    };
    this.users.push(user);
    return user;
  }

  async transaction<T>(
    work: (repository: AccountAdminRepository) => Promise<T>,
  ): Promise<T> {
    return work(this);
  }

  async createInvitation(
    input: CreateInvitationRecordInput,
  ): Promise<AccountInvitationRecord | "conflict"> {
    if (this.failCreateInvitation) return "conflict";
    if (
      this.invitations.some(
        (invitation) =>
          invitation.email === input.email &&
          (invitation.status === "pending" || invitation.status === "redeeming"),
      )
    ) {
      return "conflict";
    }
    const record: AccountInvitationRecord = {
      id: nextTestUuid(),
      email: input.email,
      role: input.role,
      status: "pending",
      tokenHash: input.tokenHash,
      invitedByUserId: input.invitedByUserId,
      expiresAt: input.expiresAt,
      acceptedUserId: null,
      acceptedAt: null,
      revokedAt: null,
      failedAt: null,
      failureCode: null,
      notes: input.notes,
      createdAt: TEST_NOW,
      updatedAt: TEST_NOW,
    };
    this.invitations.push(record);
    return cloneInvitation(record);
  }

  findByTokenHash(tokenHash: string): AccountInvitationRecord | null {
    const record = this.invitations.find(
      (invitation) => invitation.tokenHash === tokenHash,
    );
    return record ? cloneInvitation(record) : null;
  }

  async findInvitationById(
    invitationId: string,
  ): Promise<AccountInvitationRecord | null> {
    const record = this.invitations.find(
      (invitation) => invitation.id === invitationId,
    );
    return record ? cloneInvitation(record) : null;
  }

  async findInvitationByTokenHash(
    tokenHash: string,
  ): Promise<AccountInvitationRecord | null> {
    return this.findByTokenHash(tokenHash);
  }

  async listInvitations(
    options: ListInvitationsOptions,
  ): Promise<ListInvitationsResult> {
    let rows = [...this.invitations]
      .filter((invitation) =>
        options.status ? invitation.status === options.status : true,
      )
      .sort((left, right) => {
        const byCreated = right.createdAt.getTime() - left.createdAt.getTime();
        if (byCreated !== 0) return byCreated;
        return right.id.localeCompare(left.id);
      });
    if (options.cursor) {
      const cursor = options.cursor;
      rows = rows.filter(
        (invitation) =>
          invitation.createdAt.getTime() < cursor.createdAt.getTime() ||
          (invitation.createdAt.getTime() === cursor.createdAt.getTime() &&
            invitation.id < cursor.id),
      );
    }
    const hasMore = rows.length > options.limit;
    return {
      rows: rows.slice(0, options.limit).map(cloneInvitation),
      hasMore,
    };
  }

  async expireStaleInvitations(now: Date): Promise<number> {
    let count = 0;
    for (const invitation of this.invitations) {
      if (invitation.status === "pending" && invitation.expiresAt <= now) {
        invitation.status = "expired";
        count += 1;
      }
    }
    return count;
  }

  async reconcileStaleRedemptions(now: Date): Promise<number> {
    let count = 0;
    for (const invitation of this.invitations) {
      if (
        invitation.status === "redeeming" &&
        now.getTime() - invitation.updatedAt.getTime() > 15 * 60 * 1000
      ) {
        invitation.status = "failed";
        invitation.failureCode = "redeem_timeout";
        invitation.failedAt = now;
        count += 1;
      }
    }
    return count;
  }

  async markInvitationRedeeming(
    input: RedeemInvitationCasInput,
  ): Promise<AccountInvitationRecord | null> {
    const record = this.invitations.find(
      (invitation) =>
        invitation.tokenHash === input.tokenHash &&
        invitation.email === input.email &&
        invitation.status === "pending" &&
        invitation.expiresAt > input.now,
    );
    if (!record) return null;
    record.status = "redeeming";
    record.updatedAt = input.now;
    this.events.push(`markInvitationRedeeming:${record.email}`);
    return cloneInvitation(record);
  }

  async markInvitationAccepted(
    invitationId: string,
    acceptedUserId: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null> {
    const record = this.invitations.find(
      (invitation) =>
        invitation.id === invitationId && invitation.status === "redeeming",
    );
    if (!record) return null;
    record.status = "accepted";
    record.acceptedUserId = acceptedUserId;
    record.acceptedAt = now;
    record.updatedAt = now;
    return cloneInvitation(record);
  }

  async markInvitationFailed(
    invitationId: string,
    failureCode: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null> {
    const record = this.invitations.find(
      (invitation) =>
        invitation.id === invitationId &&
        (invitation.status === "pending" || invitation.status === "redeeming"),
    );
    if (!record) return null;
    record.status = "failed";
    record.failureCode = failureCode;
    record.failedAt = now;
    record.updatedAt = now;
    return cloneInvitation(record);
  }

  async revokeInvitation(
    invitationId: string,
    now: Date,
  ): Promise<AccountInvitationRecord | null> {
    const record = this.invitations.find(
      (invitation) =>
        invitation.id === invitationId && invitation.status === "pending",
    );
    if (!record) return null;
    record.status = "revoked";
    record.revokedAt = now;
    record.updatedAt = now;
    return cloneInvitation(record);
  }

  async findUserByPublicUid(
    publicUid: string,
  ): Promise<AccountAdminUser | null> {
    const user = this.users.find((candidate) => candidate.publicUid === publicUid);
    return user ? cloneUser(user) : null;
  }

  async findUserByUserId(userId: string): Promise<AccountAdminUser | null> {
    const user = this.users.find((candidate) => candidate.userId === userId);
    return user ? cloneUser(user) : null;
  }

  async isPublicUidReserved(publicUid: string): Promise<boolean> {
    return this.reservedPublicUids.has(publicUid);
  }

  async countOwners(): Promise<number> {
    return this.users.filter((user) => user.role === "owner").length;
  }

  async setInvitedProfile(
    userId: string,
    role: AccountRole,
    now: Date,
  ): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.userId === userId);
    if (!user) return false;
    user.role = role;
    user.status = "active";
    void now;
    this.events.push(`setInvitedProfile:${role}`);
    return true;
  }

  async updateAccountStatus(
    userId: string,
    status: AccountStatus,
    now: Date,
  ): Promise<boolean> {
    const user = this.users.find((candidate) => candidate.userId === userId);
    if (!user || user.status === status) return false;
    user.status = status;
    void now;
    this.events.push(`updateAccountStatus:${status}`);
    return true;
  }

  async markDeletionRequested(
    userId: string,
    now: Date,
  ): Promise<AccountAdminUser | null> {
    const user = this.users.find((candidate) => candidate.userId === userId);
    if (!user) return null;
    if (!user.deletionRequestedAt) user.deletionRequestedAt = now;
    user.status = "suspended";
    this.events.push("markDeletionRequested");
    return cloneUser(user);
  }
}

export class FakeAccountProvisioner implements AccountProvisioner {
  readonly events: string[];
  readonly createdEmails: string[] = [];
  readonly deletedUserIds: string[] = [];
  readonly bannedUserIds: string[] = [];
  readonly unbannedUserIds: string[] = [];

  failCreate = false;
  failDelete = false;
  failDeleteTimes = 0;
  failBan = false;
  failUnban = false;

  private nextUserId = 900;

  constructor(events: string[] = []) {
    this.events = events;
  }

  async createConfirmedUser(input: { email: string }): Promise<CreatedAuthUser> {
    if (this.failCreate) throw new Error("fake-provisioning-failed");
    this.nextUserId += 1;
    const userId = testUuid(this.nextUserId);
    this.createdEmails.push(input.email);
    this.events.push("createConfirmedUser");
    return { userId };
  }

  async deleteUser(userId: string): Promise<void> {
    if (this.failDelete || this.failDeleteTimes > 0) {
      this.failDeleteTimes = Math.max(0, this.failDeleteTimes - 1);
      throw new Error("fake-provisioning-failed");
    }
    this.deletedUserIds.push(userId);
    this.events.push(`deleteUser:${userId}`);
  }

  async banUser(userId: string): Promise<void> {
    if (this.failBan) throw new Error("fake-provisioning-failed");
    this.bannedUserIds.push(userId);
    this.events.push(`ban:${userId}`);
  }

  async unbanUser(userId: string): Promise<void> {
    if (this.failUnban) throw new Error("fake-provisioning-failed");
    this.unbannedUserIds.push(userId);
    this.events.push(`unban:${userId}`);
  }
}

export class FakeAdminAuditRepository implements AdminAuditRepository {
  readonly entries: AdminAuditEntry[] = [];
  failRecord = false;

  async record(entry: AdminAuditEntry): Promise<void> {
    if (this.failRecord) throw new Error("fake-audit-failed");
    this.entries.push(entry);
  }

  async list(filters: AdminAuditListFilters): Promise<readonly AdminAuditRecord[]> {
    return this.entries
      .filter(
        (entry) =>
          (filters.action ? entry.action === filters.action : true) &&
          (filters.targetKind ? entry.targetKind === filters.targetKind : true) &&
          (filters.targetId ? entry.targetId === filters.targetId : true),
      )
      .slice(0, filters.limit)
      .map((entry, index) => ({
        ...entry,
        id: `audit-${index}`,
        createdAt: TEST_NOW,
      }));
  }

  async listForTarget(
    targetKind: AdminAuditEntry["targetKind"],
    targetId: string,
    limit: number,
  ): Promise<readonly AdminAuditRecord[]> {
    return this.list({ targetKind, targetId, limit });
  }
}

export function emptyExportSnapshot(
  account: AccountExportSnapshot["account"] = null,
): AccountExportSnapshot {
  const collection = <T>(): { rows: readonly T[]; truncated: boolean } => ({
    rows: [],
    truncated: false,
  });
  return {
    account,
    preferences: null,
    practiceSessions: collection(),
    practiceAttempts: collection(),
    evidenceEvents: collection(),
    skillStates: collection(),
    learningBreakpoints: collection(),
    sceneStates: collection(),
    readingProgress: collection(),
    articleSaves: collection(),
    articleHighlights: collection(),
    savedSources: collection(),
    mediaProgress: collection(),
    savedExpressions: collection(),
    learningObservations: collection(),
    learningInsightReports: collection(),
    learningInsightFeedback: collection(),
    vocabularyMarks: collection(),
    vocabularyRecallProgress: collection(),
    conversations: collection(),
    messages: collection(),
  };
}

export type FakePrivacyOptions = Readonly<{
  publicUid?: string;
  reservedPublicUid?: string;
  reservedPublicUids?: Set<string>;
  account?: AccountExportSnapshot["account"];
}>;

/** Minimal in-memory `PrivacyRepository` for account-deletion/export tests. */
export class FakePrivacyRepository implements PrivacyRepository {
  readonly events: string[];
  readonly reservedPublicUids: Set<string>;
  readonly reservedPublicUid: string | null;
  readonly cleanupTasks: StorageCleanupTask[] = [];
  profileExists = true;
  clearCalls = 0;
  deletedProfileCalls = 0;
  failClear = false;
  failRemoveProfile = false;
  lastExportLimits: Readonly<{ perCategory: number; conversations: number; messages: number }> | null = null;
  snapshot: AccountExportSnapshot;

  constructor(options: FakePrivacyOptions = {}, events: string[] = []) {
    this.events = events;
    this.reservedPublicUids = options.reservedPublicUids ?? new Set();
    this.reservedPublicUid = options.reservedPublicUid ?? options.publicUid ?? null;
    this.snapshot = emptyExportSnapshot(
      options.account ?? {
        publicUid: options.publicUid ?? "SN-7K4M-9Q2P",
        displayName: null,
        role: "member",
        accountStatus: "active",
        avatarKind: "initials",
        createdAt: TEST_NOW,
      },
    );
  }

  async transaction<T>(work: (repository: PrivacyRepository) => Promise<T>): Promise<T> {
    return work(this);
  }

  async getAccountDataSummary(): Promise<AccountDataSummary> {
    return {
      conversations: 0,
      evidenceEvents: 0,
      practiceAttempts: 0,
      relationshipMemories: 0,
      savedAudio: 0,
      savedTranscripts: 0,
      sessions: 0,
    };
  }

  async deleteAccountData(): Promise<AccountDataDeletionResult> {
    const cleared = await this.clearAccountBusinessData();
    const removed = await this.deleteAccountProfile();
    return { ...cleared, alreadyDeleted: !removed };
  }

  async clearAccountBusinessData(): Promise<AccountBusinessDataDeletionResult> {
    this.clearCalls += 1;
    this.events.push("clearAccountBusinessData");
    if (this.failClear) throw new Error("fake-clear-failed");
    if (!this.profileExists) {
      return {
        alreadyDeleted: true,
        cleanupTasks: [],
        evidenceDeleted: 0,
        providerCallsAnonymized: 0,
      };
    }
    const account = this.snapshot.account;
    this.reservedPublicUids.add(this.reservedPublicUid ?? account?.publicUid ?? "SN-UNKNOWN-0000");
    return {
      alreadyDeleted: false,
      cleanupTasks: [],
      evidenceDeleted: 1,
      providerCallsAnonymized: 1,
    };
  }

  async deleteAccountProfile(): Promise<boolean> {
    this.deletedProfileCalls += 1;
    this.events.push("deleteAccountProfile");
    if (this.failRemoveProfile) throw new Error("fake-remove-profile-failed");
    if (!this.profileExists) return false;
    this.profileExists = false;
    return true;
  }

  async deleteCharacterData(
    _userId: string,
    characterKey: string,
  ): Promise<CharacterDataDeletionResult> {
    return {
      characterKey,
      conversationsDeleted: 0,
      messagesDeleted: 0,
      relationshipMemoriesDeleted: 0,
      memoryPermissionsRevoked: 0,
      relationshipSnapshotsDeleted: 0,
    };
  }

  async deleteSavedAudio(): Promise<boolean> {
    return false;
  }

  async deleteTranscript(): Promise<boolean> {
    return false;
  }

  async listSavedAudio(): Promise<readonly SavedAudioRecord[]> {
    return [];
  }

  async listTranscripts(): Promise<readonly SavedTranscriptRecord[]> {
    return [];
  }

  async readAccountExport(
    _userId: string,
    limits: Readonly<{ perCategory: number; conversations: number; messages: number }>,
  ): Promise<AccountExportSnapshot> {
    this.lastExportLimits = limits;
    return this.snapshot;
  }

  async updateStorageCleanupTask(
    taskId: string,
    status: StorageCleanupStatus,
    errorMessage?: string,
  ): Promise<boolean> {
    void taskId;
    void status;
    void errorMessage;
    return true;
  }
}

export class FakeStorageObjectDeleter implements StorageObjectDeleter {
  deferred = false;

  async delete(): Promise<{ deferred: boolean; errorMessage?: string }> {
    return this.deferred
      ? { deferred: true, errorMessage: "fake-storage-failed" }
      : { deferred: false };
  }
}

export function expectActionError(
  error: unknown,
  code: AccountActionError["code"],
  status: number,
): void {
  if (!(error instanceof Error)) throw error;
  expect(error.name).toBe("AccountActionError");
  expect((error as AccountActionError).code).toBe(code);
  expect((error as AccountActionError).status).toBe(status);
}

