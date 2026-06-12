import { syncMatches } from "@/lib/sync";

export async function GET(req: Request) {
  if (process.env.CRON_SECRET && req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    return Response.json(await syncMatches());
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 });
  }
}
