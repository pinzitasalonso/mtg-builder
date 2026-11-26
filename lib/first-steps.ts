// What a free account gets every day, and which of it this account has
// tried: the home page's "Your free plan" block. Most new accounts made a
// deck and asked the coach, and few found the Deck Score or a practice
// match, because nothing said they were there.
// (No database here: the browser reads this file too. What an account has
// tried is read in lib/first-steps-server.ts.)

import { FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY } from "@/lib/limits";

export type StepId = "coach" | "match" | "score";

/** Which of the three the account has done at least once. */
export type FirstSteps = Record<StepId, boolean>;

export interface StepCopy {
  id: StepId;
  title: string;
  text: string;
  /** What a free account gets a day: "2 questions a day". */
  daily: string;
}

const aDay = (n: number, one: string, more: string) => `${n} ${n === 1 ? one : more} a day`;

/** The three, in the order a new player meets them. The numbers are the
    limits' own (lib/limits.ts), so this copy follows them. */
export const FIRST_STEPS: StepCopy[] = [
  {
    id: "coach",
    title: "Ask the deck coach",
    text: "Describe the deck you want and it builds the list. Or ask what to cut.",
    daily: aDay(FREE_AI_PER_DAY, "question", "questions"),
  },
  {
    id: "match",
    title: "Play a practice match",
    text: "Your deck against a smart opponent that plays its own, turn by turn.",
    daily: aDay(FREE_PRACTICE_PER_DAY, "match", "matches"),
  },
  {
    id: "score",
    title: "Get a Deck Score",
    text: "How strong the deck is, its bracket, and what beats it.",
    daily: aDay(FREE_SCANS_PER_DAY, "scan", "scans"),
  },
];

/** True once there's nothing left to point at. */
export const allTried = (s: FirstSteps): boolean => s.coach && s.match && s.score;

/** The block's heading: how often, when the three limits are the same. */
export function stepsHeading(limits: number[] = [FREE_AI_PER_DAY, FREE_PRACTICE_PER_DAY, FREE_SCANS_PER_DAY]): string {
  const n = limits[0]!;
  if (limits.some((l) => l !== n)) return "Three things to try, free every day.";
  return `Three things to try, ${n === 1 ? "once" : n === 2 ? "twice" : `${n} times`} a day each.`;
}
