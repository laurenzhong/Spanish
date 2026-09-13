import { MediaLibrary, type MediaLibraryResult, type MediaListQuery } from "@/src/modules/media";

export function LearnPageContent({
  result,
  query,
  unavailable = false,
}: Readonly<{
  result: MediaLibraryResult;
  query: MediaListQuery;
  unavailable?: boolean;
}>) {
  return <MediaLibrary query={query} result={result} unavailable={unavailable} />;
}
