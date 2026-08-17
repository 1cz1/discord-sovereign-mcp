import { RESTJSONErrorCodes as Code } from 'discord-api-types/v10';

const GUILD_ACTION_HINT =
  'Guild-level permission checks depend on the client holding the #1 (highest) role. Run discord_assert_control to audit the hierarchy, then discord_elevate_control.';

export interface DiscordErrorInfo {
  message: string;
  code: number | null;
  status: number | null;
  raw: string;
}

const CODE_HINTS: Partial<Record<number, string>> = {
  [Code.UnknownAccount]: 'Unknown account. The token may be invalid or revoked.',
  [Code.UnknownApplication]: 'Unknown application.',
  [Code.UnknownGuild]: 'Unknown guild. It may have been deleted, or the client has no access. Check the guild ID and the DISCORD_ALLOWED_GUILDS allowlist.',
  [Code.UnknownChannel]: 'Unknown channel. It may have been deleted or the client cannot see it.',
  [Code.UnknownMember]: 'Unknown member. That user is not in this guild.',
  [Code.UnknownRole]: 'Unknown role. It may have been deleted. Re-run discord_list_roles for current role IDs.',
  [Code.UnknownMessage]: 'Unknown message. It may have been deleted or the client lacks Read Message History.',
  [Code.UnknownUser]: 'Unknown user. Check the user ID.',
  [Code.UnknownBan]: 'Unknown ban. That user is not banned in this guild.',
  [Code.MaximumNumberOfGuildsReached]: 'Maximum number of guilds reached for this token (100). Leave or delete a server first.',
  [Code.MaximumNumberOfFriendsReached]: 'Maximum number of friends reached.',
  [Code.MaximumNumberOfServerMembersReached]: 'Guild is at its member cap.',
  [Code.MaximumNumberOfGuildRolesReached]: 'Maximum number of roles reached (250 on boosted servers, 100 otherwise). Delete an unused role first.',
  [Code.MaximumNumberOfPinsReachedForTheChannel]: 'Maximum number of pins reached (50 per channel).',
  [Code.MaximumNumberOfGuildChannelsReached]: 'Maximum number of channels reached (500).',
  [Code.Unauthorized]: 'Invalid token or the token was revoked. Check DISCORD_TOKEN.',
  [Code.VerifyYourAccount]: 'Account verification required. Verify the account in the Discord app.',
  [Code.TheUserAccountMustFirstBeVerified]: 'The user account must first be verified in the Discord app.',
  [Code.RequestEntityTooLarge]: 'Request too large. Reduce the payload (messages are capped at 2000 characters).',
  [Code.MissingAccess]: 'Missing access: the client cannot reach this resource. Check the token type and DISCORD_ALLOWED_GUILDS.',
  [Code.MissingPermissions]: `Missing permissions. ${GUILD_ACTION_HINT}`,
  [Code.CannotExecuteActionOnDMChannel]: 'This action is not available on DM channels.',
  [Code.CannotSendMessagesToThisUser]: 'Cannot send messages to that user (privacy settings or mutual friends required).',
  [Code.CannotSendMessagesInNonTextChannel]: 'Cannot send messages in this channel. Check the channel overwrites with discord_calculate_permissions.',
  [Code.InvalidFormBodyOrContentType]: 'Invalid form body. One or more fields failed validation; see the raw error for details.',
  [Code.InvalidToken]: 'Invalid API token.',
  [Code.InvalidRole]: 'Invalid role.',
  [Code.InvalidRecipients]: 'Invalid message recipients.',
  [Code.MaximumNumberOfAttachmentsInAMessageReached]: 'Maximum number of attachments reached (10 per message).',
  [Code.MessageWasBlockedByAutomaticModeration]: 'Message blocked by Automod.',
  [Code.UserBannedFromThisGuild]: 'The client is banned from this guild.',
  [Code.MaximumNumberOfReactionsReached]: 'Maximum reactions reached on this message.',
  [Code.ThisMessageWasAlreadyCrossposted]: 'Message already crossposted.',
  [Code.MessageCanOnlyBePinnedInTheChannelItWasSentIn]: 'Messages can only be pinned in the channel they were sent in.',
  [Code.CannotEditMessageAuthoredByAnotherUser]: 'Cannot edit a message authored by another user.',
  [Code.CannotSendAnEmptyMessage]: 'Cannot send an empty message. Provide content, embeds, or attachments.',
  [Code.ActionCannotBePerformedDueToSlowmodeRateLimit]: 'Slowmode is active on this channel. Wait before sending again.',
  [Code.MaximumNumberOfChannelPermissionOverwritesReached]: 'Maximum permission overwrites reached for this channel (100).',
  [Code.TargetUserIsNotConnectedToVoice]: 'The target user is not connected to a voice channel.',
  [Code.InvalidActionOnArchivedThread]: 'This action is not allowed on an archived thread. Unarchive it first.',
  [Code.ThreadLocked]: 'The thread is locked.',
  [Code.MaximumActiveThreads]: 'Maximum active threads reached.',
  [Code.InvalidOAuth2AccessToken]: 'The OAuth2 access token is invalid or expired. Re-run `npm run oauth`.',
  [Code.MissingRequiredOAuth2Scope]: 'The OAuth2 token is missing a required scope for this operation. Re-run `npm run oauth` with the full scope list.',
  [Code.CannotSendAMessageInAForumChannel]: 'Cannot send a direct message in a forum channel; create a post (thread) instead.',
  [Code.InvalidChannelTypeForPollCreation]: 'Polls are only supported in text channels.',
  [Code.BotsCannotUseThisEndpoint]: 'This endpoint is only available with a user (OAuth2) token. Re-run `npm run oauth`.',
  [Code.OnlyBotsCanUseThisEndpoint]: 'This endpoint is only available with a bot token.',
  [Code.GuildPremiumSubscriptionLevelTooLow]: 'This feature requires a higher server boost level.',
  [Code.MaximumNumberOfStickersReached]: 'Maximum stickers reached.',
  [Code.FileUploadedExceedsMaximumSize]: 'File exceeds the upload size limit.',
  [Code.OwnershipCannotBeMovedToABotUser]: 'Ownership cannot be transferred to a bot user.',
  [Code.ChannelVerificationLevelTooHighForYouToGainAccess]: 'The channel requires a higher verification level than the client has.',
};

export function describeDiscordError(err: unknown): DiscordErrorInfo {
  if (err && typeof err === 'object' && 'code' in err && 'message' in err) {
    const asRecord = err as { code: unknown; message: unknown; status?: unknown };
    const code = Number(asRecord.code);
    const status = typeof asRecord.status === 'number' ? asRecord.status : null;
    const raw = String(asRecord.message ?? '');
    const hint = CODE_HINTS[code];
    const text = hint ? `${raw}. ${hint}` : `${raw}${status === 429 ? ' (rate limited — retry shortly)' : ''}`;
    return { message: text, code: Number.isFinite(code) ? code : null, status, raw };
  }
  if (err instanceof Error) {
    return { message: err.message, code: null, status: null, raw: err.message };
  }
  return { message: String(err), code: null, status: null, raw: String(err) };
}

export function toMcpErrorMessage(err: unknown, context: string): string {
  const info = describeDiscordError(err);
  return `${context}: ${info.message}`;
}