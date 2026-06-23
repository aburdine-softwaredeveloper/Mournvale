/**
 * skillScreen.ts — Builds the SkillScreenView snapshot from a character +
 * progression. Pure and server-authoritative: the client renders this view and
 * never computes talent/ability state itself.
 *
 * Everything here is derived from the same single sources the rest of the game
 * uses (CLASS_ABILITIES, CLASS_TALENT_TREES, the progression helpers), so the
 * screen, combat, and the save file can never disagree.
 */

import type { CharacterData } from "../../types/game";
import type { ProgressionState } from "../../types/progression";
import type { SkillScreenView, SkillAbilityView, SkillTalentNodeView } from "../../types/network";

import { buildCharacterStats, abilityById } from "../../types/character";
import { CLASS_TALENT_TREES } from "../../types/talents";
import {
  applyProgression,
  knownAbilityIds,
  nodeRank,
  talentNodeState,
  canRankUp,
  xpToNextLevel,
} from "../../types/progression";

export function buildSkillScreenView(
  character: CharacterData,
  prog: ProgressionState
): SkillScreenView {
  const charClass = character.characterClass;
  const tree = CLASS_TALENT_TREES[charClass];

  // Ability scores reflect talent passives + manual allocations.
  const projected = applyProgression(buildCharacterStats(charClass, prog.level), prog, tree);

  const nodes: SkillTalentNodeView[] = tree.nodes.map((node) => ({
    ...node,
    rank: nodeRank(prog, node.id),
    state: talentNodeState(node, prog),
    canRankUp: canRankUp(node, prog),
  }));

  // Where each ability sits in the loadout (id → slot index), for the list view.
  const slotOf = new Map<string, number>();
  prog.equippedAbilityIds.forEach((id, i) => {
    if (id !== null) slotOf.set(id, i);
  });

  const knownAbilities: SkillAbilityView[] = [...knownAbilityIds(prog, tree)]
    .map((id) => {
      const ability = abilityById(charClass, id);
      if (!ability) return null;
      const slotIndex = slotOf.has(id) ? slotOf.get(id)! : null;
      return {
        id: ability.id,
        name: ability.name,
        description: ability.description,
        type: ability.type,
        equipped: slotIndex !== null,
        slotIndex,
      };
    })
    .filter((a): a is SkillAbilityView => a !== null)
    // Equipped first, then by name — stable, readable order for the panel.
    .sort((a, b) =>
      a.equipped !== b.equipped ? (a.equipped ? -1 : 1) : a.name.localeCompare(b.name)
    );

  return {
    characterName: character.name,
    characterClass: charClass,
    level: prog.level,
    xp: prog.xp,
    xpToNext: xpToNextLevel(prog.xp),
    unspentSkillPoints: prog.unspentSkillPoints,
    unspentAttributePoints: prog.unspentAttributePoints,
    abilityScores: projected.abilityScores,
    abilitySlots: [...prog.equippedAbilityIds],
    nodes,
    knownAbilities,
  };
}
