/**
 * Is the interviewer asking something? — the trigger for an automatic answer.
 *
 * The desktop assistant this mirrors hears the two sides on two channels: the
 * meeting audio is the interviewer, the microphone is the candidate, so any
 * finished speech on the first channel is worth answering. A phone has ONE
 * microphone in the room, and it hears both. Answering everything would answer
 * the candidate's own reply — including the suggestion they are reading aloud.
 *
 * So the trigger is narrower here: the latest speech has to LOOK like a
 * question (a question mark from the recogniser, an interrogative opening, or
 * a "tell me about…" prompt), and it must not be the candidate reading the
 * current answer back. "Answer now" is always there for what this misses.
 */

/** Interrogative openings and interview prompts, English. */
const EN_START = /^(and\s+|so\s+|okay\s+|ok\s+|now\s+|right\s+|well\s+)?(what|why|how|when|where|which|who|whom|whose|is|are|was|were|do|does|did|can|could|would|will|should|have|has|had|may|tell me|walk me|talk me|take me|describe|explain|give me|share|talk about|name|list|imagine|suppose|let'?s say)\b/i;
const EN_ANYWHERE = /\b(tell me (about|more)|walk (me|us) through|can you (tell|walk|describe|explain|give|share|talk)|could you (tell|walk|describe|explain|give|share|talk)|would you (say|describe)|what (is|are|was|were|do|did|would|makes)|why (do|did|should|would|are)|how (do|did|would|many|much|long|have)|give (me|us) an example|what about|your (greatest|biggest) (strength|weakness))\b/i;

/** Interrogative openings and interview prompts, Arabic (MSA and Egyptian/Gulf/Levantine). */
const AR_START = /^(و|ف)?\s*(هل|ما|ماذا|لماذا|ليش|ليه|لما|كيف|إزاي|ازاي|متى|امتى|إمتى|أين|اين|فين|وين|كم|قديش|مين|من هو|من هي|أي|اي|ايه|إيه|ايش|إيش|شو|حدثني|حدّثني|حدثنا|احكِ|احكي|احكيلي|كلمني|كلّمني|اشرح|اشرحي|صف|صِف|اوصف|عرّفني|عرفني|عرّفنا|قل لي|قولي|قوللي|أخبرني|اخبرني|ممكن|هل يمكنك|تقدر|تقدري|لو)/;
const AR_ANYWHERE = /(حدثني عن|احكيلي عن|كلمني عن|اشرح لي|ممكن تحكي|ممكن تشرح|إيه هي|ايه هي|ما هي|ما هو|ليه اخترت|لماذا اخترت|نقاط القوة|نقاط الضعف|أعطني مثال|اعطني مثال|اديني مثال)/;

const QUESTION_MARK = /[?؟]\s*["'»”)]*\s*$/;

/**
 * Sentences, as the recogniser punctuated them. A match rather than a split
 * on a lookbehind, and no Unicode property escapes below: both are newer
 * than some of the JavaScript engines this runs on.
 */
export function sentences(text: string): string[] {
  return (text.match(/[^.!?؟]+[.!?؟]*["'»”)]*/g) || [])
    .map((s) => s.trim())
    .filter(Boolean);
}

export const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

const PUNCTUATION = /[.,!?؟،؛;:"'«»“”()[\]{}\-–—…]/g;
const words = (text: string) =>
  text.toLowerCase().replace(PUNCTUATION, ' ').split(/\s+/).filter((w) => w.length > 1);

export const endsWithQuestionMark = (text: string) => QUESTION_MARK.test(text.trim());

/** One sentence that reads as a question or an interview prompt. */
export function isQuestionLike(sentence: string): boolean {
  const s = sentence.trim();
  if (!s) return false;
  if (QUESTION_MARK.test(s)) return true;
  if (wordCount(s) < 3) return false;
  return EN_START.test(s) || EN_ANYWHERE.test(s) || AR_START.test(s) || AR_ANYWHERE.test(s);
}

/**
 * The candidate reading the current suggestion aloud: most of what was just
 * said is already in the answer on screen. The same overlap test the desktop
 * uses to tell its two channels apart, pointed the other way.
 */
export function isReadingAnswer(speech: string, answer: string): boolean {
  if (!answer.trim()) return false;
  const said = words(speech);
  if (said.length < 3) return false;
  const known = new Set(words(answer));
  const shared = said.filter((w) => known.has(w)).length;
  return shared / said.length >= 0.55;
}

/**
 * The question inside `fresh` — the speech not answered yet — or null.
 *
 * Looks at the LAST few sentences only: what comes before the question is
 * usually the candidate finishing their previous answer, and the model gets
 * the whole transcript for context anyway. Sentences that echo the current
 * answer are the candidate reading it, and are skipped.
 */
export function findQuestion(fresh: string, currentAnswer: string): string | null {
  const parts = sentences(fresh);
  if (!parts.length) return null;
  const tail = parts.slice(-3);
  let firstQuestion = -1;
  for (let i = 0; i < tail.length; i += 1) {
    if (isReadingAnswer(tail[i], currentAnswer)) continue;
    if (isQuestionLike(tail[i])) { firstQuestion = i; break; }
  }
  if (firstQuestion === -1) return null;
  // From the first question to the end, plus the sentence that set it up: a
  // question is often two ("You led the migration. How did you handle the
  // downtime?") — unless that sentence is the candidate reading the answer.
  const lead = tail[firstQuestion - 1];
  const from = lead && !isReadingAnswer(lead, currentAnswer) ? firstQuestion - 1 : firstQuestion;
  const question = tail.slice(from).filter((x) => !isReadingAnswer(x, currentAnswer)).join(' ').trim();
  return question.length > 600 ? question.slice(-600) : question;
}

/** The text for a manual "Answer now": the trailing speech, bounded. */
export function lastSpeech(text: string): string {
  const tail = sentences(text).slice(-3).join(' ').trim();
  return tail.length > 600 ? tail.slice(-600) : tail;
}
