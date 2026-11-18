// Server-side copy of the communities: id → subtopics. The UI's list is SKILLS in
// stream-platform/skills.js; keep the ids and subs in sync.
import { HABITS } from "./habits.js";

export const COMMUNITIES = {
  writing: ["Creative Writing", "Professional Writing", "Storytelling"],
  art: ["Sketching", "Painting", "Digital Art"],
  cooking: ["Preparing Meals", "Learning Recipes", "Baking"],
  speaking: ["Presenting", "Speaking Confidently"],
  instrument: ["Guitar", "Piano", "Drums"],
  language: ["Spanish", "French", "Japanese", "Other Languages"],
  reading: ["Reading Faster", "Comprehension", "Reading More Often"],
  fitness: ["Running", "Weightlifting", "Flexibility"],
  photography: ["Taking Photos", "Editing Photos"],
  dancing: ["Learning Routines", "Rhythm", "Technique"],
};

export const isCommunity = (id) => Object.hasOwn(COMMUNITIES, id);

// Where a habit's check-ins are shared: the commitment's choice (habit_commitment.community:
// "none" = private, null = the habit's default). Returns { skill, sub } or null.
export function shareTarget(habit, choice) {
  if (choice === "none") return null;
  const h = HABITS[habit];
  const skill = choice && isCommunity(choice) ? choice : h?.community;
  if (!skill || !isCommunity(skill)) return null;
  const subs = COMMUNITIES[skill];
  return { skill, sub: h?.community === skill && subs.includes(h.sub) ? h.sub : subs[0] };
}
