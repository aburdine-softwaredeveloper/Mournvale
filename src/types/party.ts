/**
 * party.ts — Types for the party system
 *
 * A party is a group of players who have grouped up (invite + accept).
 * Parties are formed at the tavern and persist while members stay
 * connected. The party has a leader (the creator) and members.
 *
 * Architecture: These shapes are shared between client and server. The
 * server owns authoritative party state; the client receives PartyView
 * snapshots to render. The client never mutates party state directly.
 */

/** A single member of a party, as seen by clients */
export interface PartyMemberView {
  /** Session player id */
  playerId: string;
  /** Character display name */
  name: string;
  /** Character class (for the party roster icon/label) */
  characterClass: string;
  /** True if this member is the party leader */
  isLeader: boolean;
}

/**
 * A snapshot of a party's state, sent to each member so they can render
 * the roster. Sent whenever the party changes (join, leave, disband).
 */
export interface PartyView {
  /** Unique party id */
  partyId: string;
  /** Ordered roster — leader first */
  members: PartyMemberView[];
}

/**
 * A pending invitation, shown to the invitee so they can accept/decline.
 */
export interface PartyInviteView {
  /** Id of the party being invited to */
  partyId: string;
  /** Display name of the player who sent the invite */
  fromName: string;
  /** Session id of the inviter (echoed back on accept) */
  fromPlayerId: string;
}

/** Maximum members allowed in one party */
export const MAX_PARTY_SIZE = 4;
