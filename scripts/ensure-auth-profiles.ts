import "dotenv/config";

import postgres from "postgres";

const connectionString = process.env.DIRECT_DATABASE_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DIRECT_DATABASE_URL or DATABASE_URL is required.");

const sql = postgres(connectionString, { prepare: false, connect_timeout: 10 });
try {
  const result = await sql.begin(async (transaction) => {
    const profiles = await transaction.unsafe(`
      insert into public.profiles (id, public_uid)
      select users.id, public.generate_public_uid() from auth.users users
      left join public.profiles existing on existing.id = users.id
      where existing.id is null
      on conflict (id) do nothing
    `);
    const preferences = await transaction.unsafe(`
      insert into public.user_preferences (user_id)
      select users.id from auth.users users
      left join public.user_preferences existing on existing.user_id = users.id
      where existing.user_id is null
      on conflict (user_id) do nothing
    `);
    return { profiles: profiles.count, preferences: preferences.count };
  });
  process.stdout.write(`profiles inserted: ${result.profiles}; preferences inserted: ${result.preferences}\n`);
} finally {
  await sql.end();
}
