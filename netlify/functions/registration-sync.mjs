
import { timingSafeEqual } from "node:crypto";

const json = (data, status = 200) =>
  Response.json(data, {
    status,
    headers: { "Cache-Control": "no-store" }
  });

const validText = (v, max = 500) =>
  typeof v === "string" && v.trim().length > 0 &&
  v.trim().length <= max;

const optionalText = (v, max = 1000) =>
  v == null || (typeof v === "string" && v.length <= max);

export default async function handler(request) {
  if (request.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const expected = process.env.REGISTRATION_TEST_TOKEN;
  const provided = request.headers.get("x-registration-test-token");

  if (!expected || !provided) {
    return json({ error: "Unauthorized" }, 401);
  }

  const a = Buffer.from(expected);
  const b = Buffer.from(provided);

  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return json({ error: "Unauthorized" }, 401);
  }

  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SECRET_KEY;

  if (!url || !key) {
    return json({ error: "Server configuration missing" }, 503);
  }

  const length = Number(request.headers.get("content-length"));
  if (length > 16000) {
    return json({ error: "Submission too large" }, 413);
  }

  let data;
  try {
    const raw = await request.text();
    if (raw.length > 16000) {
      return json({ error: "Submission too large" }, 413);
    }
    data = JSON.parse(raw);
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  if (
    !data || typeof data !== "object" ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(data.submission_id || "") ||
    !validText(data.contact_name, 150) ||
    !validText(data.contact_email, 254) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.contact_email) ||
    !optionalText(data.contact_phone, 40) ||
    !Array.isArray(data.players) ||
    data.players.length < 1 ||
    data.players.length > 10 ||
    !data.players.every(p =>
      p && validText(p.name, 150) &&
      ["freshman", "sophomore", "varsity"].includes(p.level)
    ) ||
    !Number.isInteger(data.adult_count) ||
    data.adult_count < 0 || data.adult_count > 20 ||
    !Number.isInteger(data.vegetarian_meals) ||
    data.vegetarian_meals < 0 ||
    data.vegetarian_meals > data.adult_count + data.players.length ||
    !optionalText(data.seating_area, 100) ||
    !optionalText(data.preferred_families, 1000) ||
    !optionalText(data.separate_seating, 1000) ||
    !optionalText(data.other_notes, 2000)
  ) {
    return json({ error: "Invalid registration information" }, 400);
  }

  const record = {
    submission_id: data.submission_id,
    contact_name: data.contact_name.trim(),
    contact_email: data.contact_email.trim().toLowerCase(),
    contact_phone: data.contact_phone || null,
    players: data.players.map(p => ({
      name: p.name.trim(),
      level: p.level
    })),
    adult_count: data.adult_count,
    vegetarian_meals: data.vegetarian_meals,
    seating_area: data.seating_area || null,
    preferred_families: data.preferred_families || null,
    separate_seating: data.separate_seating || null,
    other_notes: data.other_notes || null,
    estimated_total: 47 * (data.players.length + data.adult_count),
    payment_status: "not_enabled",
registration_status: "test"
  };

  try {
    const response = await fetch(
      `${url}/rest/v1/banquet_registrations?on_conflict=submission_id`,
      {
        method: "POST",
        headers: {
          apikey: key,
          "Content-Type": "application/json",
          Prefer: "resolution=ignore-duplicates,return=minimal"
        },
        body: JSON.stringify(record)
      }
    );

    if (!response.ok) {
      console.error("Registration insert failed", response.status);
      return json({ error: "Unable to save registration" }, 502);
    }

    return json({ status: "accepted" });
  } catch {
    return json({ error: "Connection unavailable" }, 502);
  }
}
