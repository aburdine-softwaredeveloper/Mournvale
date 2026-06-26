/**
 * roomDetails.ts — Close-inspection flavor for the `look` command
 *
 * A room's `description` (rooms.ts) is the at-a-glance blurb shown on arrival.
 * When a player deliberately `look`s, they should get MORE: ambient detail and
 * the concrete objects/features in the room — some of which are story or quest
 * hooks (a bricked-over door, deep wheel ruts that stop dead, a thing wedged in
 * the bell). This module holds that second layer, keyed by room id.
 *
 * This data is intentionally quest-agnostic — it's the same for everyone. The
 * quest-conditional reveal (see Quest.lookClue) is layered on top by the server
 * only while the relevant quest is active.
 */

export interface RoomDetail {
  /** Extra ambient prose appended beneath the room blurb on `look`. */
  detail?: string;
  /** Discrete things the player notices on inspection — objects, features, clues. */
  features?: string[];
}

export const ROOM_DETAILS: Record<string, RoomDetail> = {
  tavern: {
    detail: "Up close, the Lantern wears its age honestly — ring-stained tables, a hearth banked low against the damp.",
    features: [
      "A notice board by the door, thick with curling job-bills.",
      "A trapdoor behind the bar, its iron ring worn bright from use — the way down to the cellar.",
    ],
  },
  cellar: {
    detail: "Your eyes adjust. The casks are stacked three deep, and the skittering never quite stops.",
    features: [
      "Gnaw-marks scar the lower casks, far too large for ordinary vermin.",
      "A second door in the far wall, bricked over — the mortar newer than the stone around it.",
    ],
  },
  market_square: {
    detail: "The stalls sell less than they used to. Half the awnings shelter empty tables.",
    features: [
      "The dry fountain at the center, its basin full of grey rainwater that never seems to clear.",
      "A shuttered house on the square's north side, a single candle burning behind the slats.",
    ],
  },
  north_gate: {
    detail: "The timber is scored with old claw-marks, painted over and scored again.",
    features: [
      "A tally scratched into the gatepost — the watch counting nights since the fog came.",
      "Beyond the bars, the road north dissolves into grey within a dozen paces.",
    ],
  },
  chapel: {
    detail: "The candle on the altar burns without guttering, though no door is open to feed it air.",
    features: [
      "A bell-rope hanging slack from the tower above, frayed where it's been gripped in vain.",
      "Pews worn smooth in two long lines, as if the same hands have gripped them for years.",
    ],
  },
  graveyard: {
    detail: "The mist pools between the stones, knee-deep and slow, parting reluctantly as you walk.",
    features: [
      "Pale moonpetal blossoms growing in the lee of the oldest headstones, cold to the touch.",
      "A fresh grave with no name cut into its marker — only a single scratched spiral.",
    ],
  },
  south_road: {
    detail: "The fog here moves wrong — curling against the wind, as though something inside it is breathing.",
    features: [
      "Wheel ruts cut deep into the mud, then stop dead — as if the cart that made them was lifted clean off the road.",
      "A child's wooden horse lies in the ditch, half-swallowed by grey moss.",
    ],
  },
  fog_road: {
    detail: "Dead trees lean in from both sides. Something low and grey keeps pace with you, just out of sight.",
    features: [
      "Scraps of a merchant's cart, splintered and dragged off the track.",
      "Paw-prints the size of dinner plates, pressed deep into the frozen mud.",
    ],
  },
  fogheart: {
    detail: "The Greyfall is almost solid here, coiling with a slow purpose. The cold has a voice in it.",
    features: [
      "Shapes hang suspended in the murk — a cart, a steeple, a face — things the fog has taken and kept.",
      "At the center, a darkness that turns to watch you back.",
    ],
  },
  smithy: {
    detail: "Heat rolls off the forge in waves, the one truly warm place left in town.",
    features: ["Half-finished blades hanging in rows, waiting for hands that may not come for them."],
  },
  apothecary: {
    detail: "Bundles of dried herbs hang from every beam, and the air stings pleasantly of antiseptic.",
    features: ["A locked cabinet of darker tinctures behind the counter, labels turned to the wall."],
  },
  guard_post: {
    detail: "Maps of the fog line cover one wall, redrawn so often the parchment has gone soft.",
    features: ["A duty roster with more names crossed out than not."],
  },
};
