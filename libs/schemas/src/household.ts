import { z } from 'zod';

export const householdSchema = z.object({
  id: z.string(),
  name: z.string(),
  members: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      role: z.enum(['owner', 'member']),
    }),
  ),
});
export type Household = z.infer<typeof householdSchema>;

export const updateHouseholdSchema = z.object({
  name: z.string().trim().min(1).max(100),
});

export const householdInviteSchema = z.object({
  code: z.string(),
  expiresAt: z.iso.datetime(),
});
export type HouseholdInvite = z.infer<typeof householdInviteSchema>;

/** What an invite link shows before someone accepts it. */
export const invitePreviewSchema = z.object({
  householdName: z.string(),
  invitedBy: z.string().nullable(),
  /** Whether the person looking is already in that household. */
  alreadyMember: z.boolean(),
});
export type InvitePreview = z.infer<typeof invitePreviewSchema>;

export const joinHouseholdSchema = z.object({
  code: z.string().min(1).max(100),
});
