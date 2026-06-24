/**
 * PartyManager.ts — Authoritative party state
 *
 * Owns all parties and pending invitations. The server's message handler
 * calls into this manager; it never mutates party state directly.
 *
 * Design (per session decisions): invite + accept. A player invites
 * another in the same room; the invitee accepts to join. The inviter's
 * party is created on demand if they don't have one. Leader is the
 * creator; if the leader leaves, the party disbands.
 *
 * Architecture: This module is pure state + logic — it returns the set
 * of players who need a fresh PartyView, and the caller does the actual
 * socket sends. That keeps networking out of the manager.
 */

import { randomUUID } from "crypto";
import type { Player } from "../../types/game";
import type { PartyView, PartyMemberView } from "../../types/party";
import { MAX_PARTY_SIZE } from "../../types/party";

interface Party {
  id: string;
  /** Ordered member player ids — leader first */
  memberIds: string[];
  leaderId: string;
}

interface PendingInvite {
  partyId: string;
  fromPlayerId: string;
  toPlayerId: string;
  createdAt: number;
}

export class PartyManager {
  /** All active parties, keyed by party id */
  private readonly parties = new Map<string, Party>();

  /** Which party a player is in, keyed by player id */
  private readonly playerParty = new Map<string, string>();

  /** Pending invites, keyed by `${toPlayerId}:${partyId}` */
  private readonly invites = new Map<string, PendingInvite>();

  // ─────────────────────────────────────────────
  // QUERIES
  // ─────────────────────────────────────────────

  /** Returns the party id a player is in, or null. */
  public getPartyId(playerId: string): string | null {
    return this.playerParty.get(playerId) ?? null;
  }

  /** Returns all player ids in the same party (including the given one). */
  public getPartyMemberIds(playerId: string): string[] {
    const partyId = this.playerParty.get(playerId);
    if (!partyId) return [playerId];
    const party = this.parties.get(partyId);
    return party ? [...party.memberIds] : [playerId];
  }

  /**
   * Builds a client-facing PartyView for a party, resolving member names
   * via the provided lookup. Returns null if the party doesn't exist.
   */
  public buildView(
    partyId: string,
    resolve: (playerId: string) => { name: string; characterClass: string } | null
  ): PartyView | null {
    const party = this.parties.get(partyId);
    if (!party) return null;

    const members: PartyMemberView[] = [];
    for (const id of party.memberIds) {
      const info = resolve(id);
      if (!info) continue;
      members.push({
        playerId: id,
        name: info.name,
        characterClass: info.characterClass,
        isLeader: id === party.leaderId,
      });
    }

    return { partyId: party.id, members };
  }

  // ─────────────────────────────────────────────
  // INVITES
  // ─────────────────────────────────────────────

  /**
   * Records an invitation from one player to another. Returns an error
   * string if the invite is invalid, otherwise null.
   */
  public createInvite(from: Player, to: Player): string | null {
    if (from.id === to.id) return "You cannot invite yourself.";

    // If the inviter is in a party they don't lead, only the leader invites
    const fromPartyId = this.playerParty.get(from.id);
    if (fromPartyId) {
      const party = this.parties.get(fromPartyId);
      if (party && party.leaderId !== from.id) {
        return "Only the party leader can invite others.";
      }
      if (party && party.memberIds.length >= MAX_PARTY_SIZE) {
        return "Your party is already full.";
      }
    }

    // Target must not already be in a party
    if (this.playerParty.has(to.id)) {
      return `${to.character?.name ?? "They"} are already in a party.`;
    }

    // Determine the party id the invite is for (create-on-accept if none yet)
    const partyId = fromPartyId ?? `pending-${from.id}`;

    const key = `${to.id}:${partyId}`;
    this.invites.set(key, {
      partyId,
      fromPlayerId: from.id,
      toPlayerId: to.id,
      createdAt: Date.now(),
    });

    return null;
  }

  /**
   * Accepts an invitation. Returns the set of player ids whose PartyView
   * should be refreshed, plus an error if the accept failed.
   */
  public acceptInvite(
    accepter: Player,
    fromPlayerId: string,
    inviterResolver: (id: string) => Player | undefined
  ): { affected: string[]; error: string | null } {
    // Find the matching invite (any party id from this inviter)
    let matched: PendingInvite | undefined;
    let matchedKey: string | undefined;
    for (const [key, inv] of this.invites) {
      if (inv.toPlayerId === accepter.id && inv.fromPlayerId === fromPlayerId) {
        matched = inv;
        matchedKey = key;
        break;
      }
    }

    if (!matched || !matchedKey) {
      return { affected: [], error: "That invitation has expired." };
    }

    // Consume the invite
    this.invites.delete(matchedKey);

    if (this.playerParty.has(accepter.id)) {
      return { affected: [], error: "You are already in a party." };
    }

    const inviter = inviterResolver(fromPlayerId);
    if (!inviter) {
      return { affected: [], error: "The inviter is no longer available." };
    }

    // Resolve or create the inviter's party
    let partyId = this.playerParty.get(inviter.id);
    if (!partyId) {
      // Create a new party led by the inviter
      partyId = randomUUID();
      const party: Party = {
        id: partyId,
        memberIds: [inviter.id],
        leaderId: inviter.id,
      };
      this.parties.set(partyId, party);
      this.playerParty.set(inviter.id, partyId);
    }

    const party = this.parties.get(partyId);
    if (!party) {
      return { affected: [], error: "That party no longer exists." };
    }

    if (party.memberIds.length >= MAX_PARTY_SIZE) {
      return { affected: [], error: "That party is now full." };
    }

    // Add the accepter
    party.memberIds.push(accepter.id);
    this.playerParty.set(accepter.id, partyId);

    return { affected: [...party.memberIds], error: null };
  }

  // ─────────────────────────────────────────────
  // LEAVING
  // ─────────────────────────────────────────────

  /**
   * Removes a player from their party. If the leader leaves, the party
   * disbands. Returns the ids of players whose view must refresh and
   * whether the party was disbanded.
   *
   * `formerMembers` always includes everyone who was in the party so the
   * caller can clear their rosters appropriately.
   */
  public leaveParty(playerId: string): {
    formerMembers: string[];
    disbanded: boolean;
    stillInParty: string[];
  } {
    const partyId = this.playerParty.get(playerId);
    if (!partyId) {
      return { formerMembers: [], disbanded: false, stillInParty: [] };
    }

    const party = this.parties.get(partyId);
    if (!party) {
      this.playerParty.delete(playerId);
      return { formerMembers: [], disbanded: false, stillInParty: [] };
    }

    const formerMembers = [...party.memberIds];

    // Leader leaving → disband the whole party
    if (party.leaderId === playerId) {
      for (const id of party.memberIds) {
        this.playerParty.delete(id);
      }
      this.parties.delete(partyId);
      return { formerMembers, disbanded: true, stillInParty: [] };
    }

    // Non-leader leaving → just remove them
    party.memberIds = party.memberIds.filter((id) => id !== playerId);
    this.playerParty.delete(playerId);

    // If only the leader remains, disband (a party of one is no party)
    if (party.memberIds.length <= 1) {
      for (const id of party.memberIds) {
        this.playerParty.delete(id);
      }
      this.parties.delete(partyId);
      return { formerMembers, disbanded: true, stillInParty: [] };
    }

    return {
      formerMembers,
      disbanded: false,
      stillInParty: [...party.memberIds],
    };
  }

  /**
   * Cleans up a disconnected player — removes them from their party and
   * clears any invites to/from them. Returns the remaining party members
   * to refresh (empty if no party or it disbanded).
   */
  public handleDisconnect(playerId: string): {
    formerMembers: string[];
    disbanded: boolean;
    stillInParty: string[];
  } {
    // Drop invites involving this player
    for (const [key, inv] of [...this.invites]) {
      if (inv.toPlayerId === playerId || inv.fromPlayerId === playerId) {
        this.invites.delete(key);
      }
    }
    return this.leaveParty(playerId);
  }
}
