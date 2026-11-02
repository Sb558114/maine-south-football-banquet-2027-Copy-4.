
export default async function handler(request) {
  if (request.method !== "GET") {
    return new Response("Method not allowed", { status: 405 });
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return Response.json(
      { status: "configuration_missing" },
      { status: 503 }
    );
  }

  try {
    const response = await fetch(
      `${url}/rest/v1/banquet_registrations?select=id&limit=0`,
      {
        headers: {
  apikey: key,
},
      }
    );

   return Response.json({
  status: response.ok ? "connected" : "connection_failed",
  http_status: response.status
});
  } catch {
    return Response.json(
      { status: "connection_failed" },
      { status: 502 }
    );
  }
}
