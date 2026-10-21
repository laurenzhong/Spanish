import type { Metadata } from "next";
import { getCurrentUser } from "@/src/shared/auth/server";
import { Phrasebook } from "@/src/modules/lexicon-corpus/ui/phrasebook";
import "./phrasebook.css";

export const metadata: Metadata = { title: "短语" };

type PhrasesPageProps = Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>;

export default async function PhrasesPage({ searchParams }: PhrasesPageProps) {
  const [user, params] = await Promise.all([getCurrentUser(), searchParams]);
  const initialSearch = typeof params.search === "string" ? params.search.slice(0, 120) : "";
  return <Phrasebook key={user?.id ?? "guest"} userId={user?.id ?? "guest"} initialSearch={initialSearch} />;
}
