import { redirect } from "next/navigation";

/** Backwards-compatible alias for older links and bookmarks. */
export default function SavedItemsAliasPage() {
  redirect("/read/saved-items");
}

