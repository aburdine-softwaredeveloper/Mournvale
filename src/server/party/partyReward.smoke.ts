/**
 * partyReward.smoke.ts — Verifies the party-membership mechanism that co-op
 * quest rewards rely on: once two players are partied, getPartyMemberIds
 * returns BOTH (including the caller), which is exactly the recipient set
 * grantQuestCompletion (index.ts) distributes quest reward XP across.
 *
 * Run with: npx tsx src/server/party/partyReward.smoke.ts
 */

import assert from "node:assert/strict";

import { PartyManager } from "./PartyManager";

let passed = 0;
function check(label: string, fn: () => void): void {
  fn();
  passed++;
  console.log(`  ok — ${label}`);
}

// Minimal Player-shaped stubs — PartyManager only reads .id and .character.name.
const mk = (id: string, name: string) => ({ id, character: { name } }) as any;

check("a solo player's 'party' is just themselves", () => {
  const pm = new PartyManager();
  assert.deepEqual(pm.getPartyMemberIds("solo"), ["solo"]);
  assert.equal(pm.getPartyId("solo"), null);
});

check("invite + accept partners two players, and both see the full roster", () => {
  const pm = new PartyManager();
  const leader = mk("p1", "Leader");
  const member = mk("p2", "Member");

  assert.equal(pm.createInvite(leader, member), null, "invite accepted");
  const { affected, error } = pm.acceptInvite(member, leader.id, (id) =>
    id === leader.id ? leader : undefined
  );
  assert.equal(error, null, "accept succeeded");
  assert.equal(affected.length, 2, "both members affected");

  // The reward-recipient set grantQuestCompletion iterates:
  const fromLeader = pm.getPartyMemberIds(leader.id).sort();
  const fromMember = pm.getPartyMemberIds(member.id).sort();
  assert.deepEqual(fromLeader, ["p1", "p2"], "leader sees both members");
  assert.deepEqual(fromMember, ["p1", "p2"], "member sees both members");
  assert.equal(pm.getPartyId(leader.id), pm.getPartyId(member.id), "same party id");
});

check("after a member leaves, the reward set narrows back down", () => {
  const pm = new PartyManager();
  const a = mk("a", "A"), b = mk("b", "B"), c = mk("c", "C");
  pm.createInvite(a, b);
  pm.acceptInvite(b, a.id, (id) => (id === a.id ? a : undefined));
  pm.createInvite(a, c);
  pm.acceptInvite(c, a.id, (id) => (id === a.id ? a : undefined));
  assert.deepEqual(pm.getPartyMemberIds(a.id).sort(), ["a", "b", "c"]);

  pm.leaveParty(c.id);
  assert.deepEqual(pm.getPartyMemberIds(a.id).sort(), ["a", "b"], "c no longer rewarded");
});

console.log(`\n✓ party reward smoke: ${passed} checks passed`);
