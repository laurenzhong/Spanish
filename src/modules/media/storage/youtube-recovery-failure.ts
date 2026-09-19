export type YoutubeRecoveryFailureCode =
  | "CANCELLED"
  | "OUTPUT_LIMIT"
  | "TIMEOUT"
  | "MEMORY_EXHAUSTED"
  | "AGE_RESTRICTED"
  | "MANUAL_SIGNIN_REQUIRED"
  | "FORMAT_UNAVAILABLE"
  | "JS_COMPONENT_FAILED"
  | "SOURCE_ACCESS_FAILED"
  | "NETWORK_FAILED"
  | "FAILED";

export function classifyYoutubeRecoveryFailure(input: Readonly<{
  diagnostic: string;
  code: number | null;
  exceededOutput: boolean;
  timedOut: boolean;
  aborted: boolean;
}>): YoutubeRecoveryFailureCode {
  if (input.aborted) return "CANCELLED";
  if (input.exceededOutput) return "OUTPUT_LIMIT";
  if (input.timedOut) return "TIMEOUT";
  if (/out of memory|MemoryError|cannot allocate|not enough memory/iu.test(input.diagnostic)) return "MEMORY_EXHAUSTED";
  if (/Sign in to confirm your age|age[- ]restricted|confirm your age|This video is only available to users who meet the age requirement/iu.test(input.diagnostic)) return "AGE_RESTRICTED";
  if (/Sign in to confirm|not a bot/iu.test(input.diagnostic)) return "MANUAL_SIGNIN_REQUIRED";
  if (/Requested format is not available/iu.test(input.diagnostic)) return "FORMAT_UNAVAILABLE";
  if (/challenge solving failed|challenge solver script/iu.test(input.diagnostic)) return "JS_COMPONENT_FAILED";
  if (/HTTP Error: (403|429)/u.test(input.diagnostic)) return "SOURCE_ACCESS_FAILED";
  if (/timed out|connection|network/iu.test(input.diagnostic)) return "NETWORK_FAILED";
  return "FAILED";
}
