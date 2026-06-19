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

  private activeTypewriter: TypewriterController | null = null;
  private currentStep: CharacterCreationStep | null = null;

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

    this.wireNameInput();
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
    choices: { label: string; value: string }[]
  ): void {
    this.choiceList.innerHTML = "";

    choices.forEach((choice, i) => {
      const li = document.createElement("li");
      li.className = "choice-item";
      li.textContent = choice.label;
      li.tabIndex = 0;
      li.dataset.value = choice.value;

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

      this.choiceList.appendChild(li);

      // Focus the first option for keyboard navigation
      if (i === 0) li.focus();
    });

    this.choicesPanel.classList.remove("hidden");
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
      if (!value) return;
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
