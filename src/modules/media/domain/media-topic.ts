export const mediaTopicFilters = [
  { value: "daily-life", label: "日常生活", sourceTopics: ["topic.daily-life", "topic.general"] },
  { value: "current-events", label: "时事新闻", sourceTopics: ["topic.current-events", "topic.news"] },
  { value: "culture-society", label: "文化社会", sourceTopics: ["topic.culture", "topic.society", "topic.non-fiction"] },
  { value: "travel-city", label: "旅行城市", sourceTopics: ["topic.travel", "topic.city"] },
  { value: "work-study", label: "工作学习", sourceTopics: ["topic.work", "topic.study", "topic.education"] },
  { value: "relationships", label: "人际关系", sourceTopics: ["topic.relationships", "topic.conversation"] },
  { value: "hobbies-entertainment", label: "兴趣娱乐", sourceTopics: ["topic.hobbies", "topic.entertainment", "topic.fiction"] },
] as const;

export type MediaTopicFilter = (typeof mediaTopicFilters)[number]["value"];

export function matchesMediaTopic(topics: readonly string[], filter: MediaTopicFilter): boolean {
  const option = mediaTopicFilters.find((item) => item.value === filter);
  if (!option) return false;
  const normalized = new Set(topics.map((topic) => topic.trim().toLocaleLowerCase("en")));
  return option.sourceTopics.some((topic) => normalized.has(topic));
}
