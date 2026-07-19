/**
 * CharacterCreationScreen.ts — Tavern keeper dialogue UI
 *
 * Receives DialogueMessages from the server and renders them:
 *   - Speaker name + typewriter text in the dialogue box
 *   - If the dialogue has `choices`, renders a clickable choice menu
 *   - If the step is "name", renders the free-text input instead
 *
 * Player selections are sent back via the onChoice callback, which the
 * app forwards to the server as dialogue_choice messages.
 *
 * Architecture: This screen is a pure view + input collector. It holds
 * no character state — the server is authoritative. It only knows how
 * to display a dialogue and report the player's answer.
 */

import { typewrite, type TypewriterController } from "../util/typewriter";
import {
  portraitCompositor,
  type PortraitSpec,
} from "../../engine/assets/PortraitCompositor";
import type {
  DialogueMessage,
  CharacterCreationStep,
} from "../../types/network";

export class CharacterCreationScreen {
  private readonly speakerEl: HTMLElement;
  private readonly textEl: HTMLElement;
  private readonly choicesPanel: HTMLElement;
  private readonly choiceList: HTMLElement;
  private readonly inputBox: HTMLElement;
  private readonly nameInput: HTMLInputElement;
  private readonly nameConfirm: HTMLButtonElement;
  private readonly portraitFrame: HTMLElement;
  private readonly portraitImg: HTMLElement;
  private readonly portraitLabel: HTMLElement;

  private activeTypewriter: TypewriterController | null = null;
  private currentStep: CharacterCreationStep | null = null;

  /**
   * Local copy of creation choices, used only to build the live portrait
   * preview. The server remains authoritative for the actual character.
   */
  private previewSpec: Partial<PortraitSpec> = {};

  /** Invoked when the player makes a selection or submits their name */
  private onChoice: ((step: CharacterCreationStep, value: string) => void) | null = null;

  constructor() {
    this.speakerEl = this.requireEl("creation-speaker");
    this.textEl = this.requireEl("creation-text");
    this.choicesPanel = this.requireEl("creation-choices");
    this.choiceList = this.requireEl("creation-choice-list");
    this.inputBox = this.requireEl("creation-input-box");
    this.nameInput = this.requireEl("creation-name-input") as HTMLInputElement;
    this.nameConfirm = this.requireEl("creation-name-confirm") as HTMLButtonElement;
    this.portraitFrame = this.requireEl("creation-portrait");
    this.portraitImg = this.requireEl("creation-portrait-img");
    this.portraitLabel = this.requireEl("creation-portrait-label");

    this.wireNameInput();

    // Portrait PNGs load lazily via <image> href when first rendered, so
    // no preload is needed here.
  }

  /** Registers the callback used to report player answers to the app */
  public setChoiceHandler(
    handler: (step: CharacterCreationStep, value: string) => void
  ): void {
    this.onChoice = handler;
  }

  /**
   * Renders a dialogue message from the server.
   * Decides between choice menu, name input, or plain text based on
   * the message contents.
   */
  public showDialogue(msg: DialogueMessage): void {
    const { speaker, text, choices, step } = msg.payload;

    this.currentStep = step ?? null;

    // Reset UI — hide both interactive panels until typing finishes
    this.choicesPanel.classList.add("hidden");
    this.inputBox.classList.add("hidden");
    // Once the player has made any visual choice, keep the portrait
    // visible (showing the accumulated look). Before that, hide it.
    if (this.hasVisualData()) {
      this.renderPortrait(this.previewSpec);
    } else {
      this.portraitFrame.classList.add("hidden");
    }

    this.speakerEl.textContent = speaker;

    // Cancel any in-progress typing
    if (this.activeTypewriter) this.activeTypewriter.cancel();

    this.activeTypewriter = typewrite(this.textEl, text, 35);

    this.activeTypewriter.done.then(() => {
      // After the keeper finishes speaking, reveal the interaction
      if (step === "name") {
        this.showNameInput();
      } else if (choices && choices.length > 0) {
        this.showChoices(step, choices);
      }
      // If no step/choices (e.g. final farewell), nothing to interact with
    });
  }

  /** Renders the clickable choice menu */
  private showChoices(
    step: CharacterCreationStep | undefined,
    choices: { label: string; value: string; description?: string }[]
  ): void {
    this.choiceList.innerHTML = "";

    choices.forEach((choice, i) => {
      const li = document.createElement("li");
      li.className = "choice-item";
      li.tabIndex = 0;
      li.dataset.value = choice.value;

      const labelEl = document.createElement("span");
      labelEl.className = "choice-label";
      labelEl.textContent = choice.label;
      li.appendChild(labelEl);

      // A one-line blurb under the label (class picks) so nobody chooses blind.
      if (choice.description) {
        const descEl = document.createElement("span");
        descEl.className = "choice-desc";
        descEl.textContent = choice.description;
        li.appendChild(descEl);
      }

      const select = () => {
        if (step) this.submit(step, choice.value);
      };

      li.addEventListener("click", select);
      li.addEventListener("keydown", (e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          select();
        }
      });

      // For visual steps, hovering/focusing a choice previews it live
      if (this.isVisualStep(step)) {
        const preview = () => this.previewChoice(step, choice.value);
        li.addEventListener("mouseenter", preview);
        li.addEventListener("focus", preview);
      }

      this.choiceList.appendChild(li);

      // Focus the first option for keyboard navigation
      if (i === 0) {
        li.focus();
        // Prime the preview with the first option so the frame isn't empty
        if (this.isVisualStep(step)) this.previewChoice(step, choice.value);
      }
    });

    this.choicesPanel.classList.remove("hidden");
  }

  /** True if any visual attribute has been chosen yet */
  private hasVisualData(): boolean {
    return (
      this.previewSpec.gender !== undefined ||
      this.previewSpec.characterClass !== undefined ||
      this.previewSpec.hairColor !== undefined ||
      this.previewSpec.glasses !== undefined
    );
  }

  /** True for steps that affect the portrait's appearance */
  private isVisualStep(step: CharacterCreationStep | undefined): boolean {
    return (
      step === "gender" ||
      step === "class" ||
      step === "hair_color" ||
      step === "glasses"
    );
  }

  /**
   * Updates the preview spec with a tentative choice (hover/focus) and
   * re-renders the portrait. This does not commit anything — the value
   * is only locked in when the player actually selects it (submit()).
   */
  private previewChoice(
    step: CharacterCreationStep | undefined,
    value: string
  ): void {
    const spec = { ...this.previewSpec };
    this.applyToSpec(spec, step, value);
    this.renderPortrait(spec);
  }

  /** Writes a step's value into a portrait spec object */
  private applyToSpec(
    spec: Partial<PortraitSpec>,
    step: CharacterCreationStep | undefined,
    value: string
  ): void {
    switch (step) {
      case "gender":
        spec.gender = value as PortraitSpec["gender"];
        break;
      case "class":
        spec.characterClass = value;
        break;
      case "hair_color":
        spec.hairColor = value;
        break;
      case "glasses":
        spec.glasses = value === "true";
        break;
    }
  }

  /**
   * Renders a portrait from a (possibly partial) spec. Fills in sensible
   * defaults for any not-yet-chosen fields so the preview is always
   * drawable — e.g. before class is picked we still show a full sprite.
   */
  private renderPortrait(spec: Partial<PortraitSpec>): void {
    const full: PortraitSpec = {
      gender: spec.gender ?? "Male",
      characterClass: spec.characterClass ?? "monk",
      hairColor: spec.hairColor ?? "Brown",
      glasses: spec.glasses ?? false,
    };

    this.portraitImg.innerHTML = portraitCompositor.compose(full);
    this.portraitFrame.classList.remove("hidden");
    this.updatePortraitLabel(spec);
  }

  /** Sets the portrait caption from whatever has been chosen so far */
  private updatePortraitLabel(spec: Partial<PortraitSpec>): void {
    this.portraitLabel.textContent = spec.characterClass
      ? spec.characterClass
      : "Adventurer";
  }

  /** Shows the free-text name input */
  private showNameInput(): void {
    this.nameInput.value = "";
    this.inputBox.classList.remove("hidden");
    this.nameInput.focus();
  }

  /** Wires the name input's Enter key and OK button */
  private wireNameInput(): void {
    const submitName = () => {
      const value = this.nameInput.value.trim();
      if (!value) {
        // Never fail silently: shake the field and say what's needed.
        this.nameInput.placeholder = "Every soul needs a name…";
        this.nameInput.classList.remove("input-nudge");
        void this.nameInput.offsetWidth; // restart the animation
        this.nameInput.classList.add("input-nudge");
        this.nameInput.focus();
        return;
      }
      if (this.currentStep === "name") {
        this.submit("name", value);
      }
    };

    this.nameConfirm.addEventListener("click", submitName);
    this.nameInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submitName();
      }
    });
  }

  /** Reports a selection to the app and clears interactive UI */
  private submit(step: CharacterCreationStep, value: string): void {
    // Lock the choice into the preview spec so the portrait persists and
    // accumulates across steps (gender → class → hair → color → glasses).
    if (this.isVisualStep(step)) {
      this.applyToSpec(this.previewSpec, step, value);
      this.renderPortrait(this.previewSpec);
    }

    // On restart, clear the accumulated preview
    if (step === "confirm" && value === "restart") {
      this.previewSpec = {};
    }

    this.choicesPanel.classList.add("hidden");
    this.inputBox.classList.add("hidden");
    this.onChoice?.(step, value);
  }

  private requireEl(id: string): HTMLElement {
    const el = document.getElementById(id);
    if (!el) throw new Error(`CharacterCreationScreen: missing element #${id}`);
    return el;
  }
}
