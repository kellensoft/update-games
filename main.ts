import { createClient } from "@supabase/supabase-js";
//import "https://deno.land/std@0.224.0/dotenv/load.ts";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_BUCKET = Deno.env.get("SUPABASE_BUCKET");
const SEARCH_URL = Deno.env.get("SEARCH_URL");
const API_KEY = Deno.env.get("API_KEY")!;

if (!SUPABASE_URL || !SUPABASE_KEY || !SUPABASE_BUCKET || !SEARCH_URL || !API_KEY) {
  throw new Error("Missing environment variables");
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

interface GameFields {
  appid: number | null;
  name: string;
  description: string | null;
  release_date: string | null;
  developer: string | null;
  publisher: string | null;
  review_score: number | null;
  owners: number;
}
interface TimeFields {
  hltb_id: number | null;
  main_avg: number | null;
  main_polled: number | null;
  main_median: number | null;
  main_rushed: number | null;
  main_leisure: number | null;
  extra_avg: number | null;
  extra_polled: number | null;
  extra_median: number | null;
  extra_rushed: number | null;
  extra_leisure: number | null;
  completionist_avg: number | null;
  completionist_polled: number | null;
  completionist_median: number | null;
  completionist_rushed: number | null;
  completionist_leisure: number | null;
}

function filterNulls<T extends Record<string, unknown>>(data: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(data).filter(([_, v]) => v !== null && v !== undefined)
  ) as Partial<T>;
}

const handler = async (req: Request): Promise<Response> => {
  if (req.method !== "POST") {
    return new Response("POST required", { status: 405 });
  }
  const reqKey = req.headers.get("x-api-key");
  if (reqKey !== API_KEY) {
    return new Response("Unauthorized", { status: 401 });
  }
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response("Invalid JSON", { status: 400 });
  }
  const { type = "steam" } = body as { type?: string };
  if (type === "steam") {
    const appid = body.appid;
    if (!appid || typeof appid !== "number") {
      return new Response("Missing or invalid appid", { status: 400 });
    }
    const imgUrl = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_sm_120.jpg`;
    const imgRes = await fetch(imgUrl);
    if (imgRes.ok) {
      const imgBuf = new Uint8Array(await imgRes.arrayBuffer());
      const imgPath = `${appid}.jpg`;
      const { error: uploadError } = await supabase
        .storage
        .from(SUPABASE_BUCKET)
        .upload(imgPath, imgBuf, { upsert: true, contentType: "image/jpeg" });
      if (uploadError) {
        console.warn("Supabase image upload failed:", uploadError);
      }
    }
    // 2. Fetch Steam data
    const steamData: Partial<GameFields> = { appid };
    try {
      const res = await fetch(`https://store.steampowered.com/api/appdetails?appids=${appid}`);
      const json = await res.json();
      if (json[appid]?.success) {
        const data = json[appid].data;
        steamData.name = data.name;
        steamData.description = data.short_description ?? null;
        steamData.release_date = data.release_date?.date ?? null;
        steamData.developer = data.developers?.[0] ?? null;
        steamData.publisher = data.publishers?.[0] ?? null;
        steamData.review_score = data.metacritic?.score ?? null;
        steamData.owners = 0;
      }
    } catch (e) {
      console.warn("Steam fetch failed:", e);
    }
    let timeData: Partial<TimeFields> = {};
    if (steamData.name) {
      try {
        const hltbRes = await fetch(SEARCH_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "User-Agent": "Mozilla/5.0 (compatible; HLTBScraper/1.0)",
          },
          body: JSON.stringify({ name: steamData.name }),
        });
        if (hltbRes.ok) {
          const hltbJson = await hltbRes.json();
          timeData = filterNulls(hltbJson);
        }
      } catch (e) {
        console.warn("HLTB fetch failed:", e);
      }
    }
    const upsertData = { ...filterNulls(steamData), ...filterNulls(timeData) };
    const { data, error: upsertError } = await supabase
      .from("games")
      .upsert([upsertData], { onConflict: "appid" })
      .select()
      .single();
    if (upsertError) {
      return new Response("Supabase DB upsert failed", { status: 500 });
    }
    return Response.json(data);
  }
  if (type === "hltb") {
    const { name } = body;
    if (!name || typeof name !== "string") {
      return new Response("Missing or invalid name", { status: 400 });
    }
    let timeData: Partial<TimeFields> = {};
    try {
      const hltbRes = await fetch(SEARCH_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; HLTBScraper/1.0)",
        },
        body: JSON.stringify({ name }),
      });
      if (hltbRes.ok) {
        const hltbJson = await hltbRes.json();
        timeData = filterNulls(hltbJson);
      } else {
        return new Response("HLTB not found", { status: 404 });
      }
    } catch (e) {
      console.warn("HLTB fetch failed:", e);
      return new Response("HLTB fetch failed", { status: 500 });
    }
    const upsertWhere: Record<string, unknown> = timeData.hltb_id
      ? { hltb_id: timeData.hltb_id }
      : { name };
    const { data: oldRows, error: getError } = await supabase
      .from("games")
      .select("*")
      .match(upsertWhere)
      .limit(1);
    if (getError || !oldRows?.length) {
      const { data, error: insErr } = await supabase
        .from("games")
        .upsert([{ ...filterNulls(timeData), name }])
        .select()
        .single();
      if (insErr) return new Response("Supabase upsert failed", { status: 500 });
      return Response.json(data);
    } else {
      const old = oldRows[0];
      const update = { ...old, ...filterNulls(timeData) };
      const { data, error: upsertError } = await supabase
        .from("games")
        .upsert([update], { onConflict: "appid" })
        .select()
        .single();
      if (upsertError) return new Response("Supabase update failed", { status: 500 });
      return Response.json(data);
    }
  }
  return new Response("Invalid type", { status: 400 });
};

Deno.serve(handler);
