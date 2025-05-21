import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SUPABASE_BUCKET = Deno.env.get("SUPABASE_BUCKET");
const API_KEY = Deno.env.get("API_KEY")!;

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

  const appid = body.appid;
  if (!appid || typeof appid !== "number") {
    return new Response("Missing or invalid appid", { status: 400 });
  }

  const imgUrl = `https://shared.cloudflare.steamstatic.com/store_item_assets/steam/apps/${appid}/capsule_sm_120.jpg`;
  const imgRes = await fetch(imgUrl);
  if (!imgRes.ok) {
    return new Response("Image fetch failed", { status: 404 });
  }
  const imgBuf = new Uint8Array(await imgRes.arrayBuffer());

  const imgPath = `${appid}.jpg`;
  const { error: uploadError } = await supabase
    .storage
    .from(SUPABASE_BUCKET)
    .upload(imgPath, imgBuf, { upsert: true, contentType: "image/jpeg" });
  if (uploadError) {
    return new Response("Supabase image upload failed", { status: 500 });
  }

  let steamData: any = {};
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
    }
  } catch {

  }

  let timeData: any = {};
  if (steamData.name) {
    try {
      const searchUrl = "https://howlongtobeat.com/api/search";
      const hltbRes = await fetch(searchUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (compatible; HLTBScraper/1.0)",
        },
        body: JSON.stringify({ searchType: "games", searchTerms: steamData.name.split(" "), size: 1 }),
      });
      const hltbJson = await hltbRes.json();
      const game = hltbJson.data?.[0];
      if (game) {
        timeData = {
          main_avg: game.gameplayMain ?? null,
          main_polled: game.compMain ?? null,
          main_median: game.medianMain ?? null,
          main_rushed: game.rushedMain ?? null,
          main_leisure: game.leisureMain ?? null,
          extra_avg: game.gameplayMainExtra ?? null,
          extra_polled: game.compMainExtra ?? null,
          extra_median: game.medianMainExtra ?? null,
          extra_rushed: game.rushedMainExtra ?? null,
          extra_leisure: game.leisureMainExtra ?? null,
          completionist_avg: game.gameplayCompletionist ?? null,
          completionist_polled: game.compCompletionist ?? null,
          completionist_median: game.medianCompletionist ?? null,
          completionist_rushed: game.rushedCompletionist ?? null,
          completionist_leisure: game.leisureCompletionist ?? null,
        };
      }
    } catch {

    }
  }

  const upsertData = {
    appid,
    name: steamData.name ?? "",
    description: steamData.description ?? null,
    release_date: steamData.release_date ?? null,
    developer: steamData.developer ?? null,
    publisher: steamData.publisher ?? null,
    review_score: steamData.review_score ?? null,
    owners: 0,
    ...timeData,
  };
  const { data, error: upsertError } = await supabase
    .from("games")
    .upsert([upsertData], { onConflict: ["appid"] })
    .select()
    .single();
  if (upsertError) {
    return new Response("Supabase DB upsert failed", { status: 500 });
  }

  return Response.json(data);
};

Deno.serve(handler);
