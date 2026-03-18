// ─────────────────────────────────────────────
//  tools/questions.ts
//  MCP Tool: question_keywords
//  Returns question-style keyword variations (Answer-the-Public style)
//  categorized by question word (what, why, how, when, where, who, which)
// ─────────────────────────────────────────────
import { z } from "zod";
import { generateAtpKeywords } from "../providers/answer-the-public";

// ── Input schema ──────────────────────────────────────────────────────────

export const QuestionKeywordsSchema = z.object({
  keyword: z.string().min(1).describe("The seed keyword to generate questions for"),
  lang: z.string().default("en").describe("Language code, e.g. 'en', 'es'"),
  country: z.string().default("us").describe("Country code, e.g. 'us', 'gb'"),
  questionWords: z
    .array(z.enum(["what", "why", "how", "when", "where", "who", "which", "can", "is", "are", "will"]))
    .default(["what", "why", "how", "when", "where", "who", "which"])
    .describe("Which question words to include in results"),
});

export type QuestionKeywordsInput = z.infer<typeof QuestionKeywordsSchema>;

// ── Output type ───────────────────────────────────────────────────────────

export interface QuestionKeywordsResult {
  keyword: string;
  totalQuestions: number;
  byQuestionWord: Record<string, string[]>;    // { "what": [...], "how": [...] }
  allQuestions: string[];                       // flat sorted list
}

// ── Handler ───────────────────────────────────────────────────────────────

export async function handleQuestionKeywords(
  input: QuestionKeywordsInput
): Promise<QuestionKeywordsResult> {
  const atpData = await generateAtpKeywords({
    keyword: input.keyword,
    lang: input.lang,
    country: input.country,
    include: ["questions"],
  });

  // Filter to only the requested question words
  const filtered: Record<string, string[]> = {};
  for (const word of input.questionWords) {
    if (atpData.questions[word] && atpData.questions[word].length > 0) {
      filtered[word] = atpData.questions[word];
    }
  }

  const allQuestions = Object.values(filtered)
    .flat()
    .filter((kw, idx, arr) => arr.indexOf(kw) === idx) // deduplicate
    .sort();

  return {
    keyword: input.keyword,
    totalQuestions: allQuestions.length,
    byQuestionWord: filtered,
    allQuestions,
  };
}
