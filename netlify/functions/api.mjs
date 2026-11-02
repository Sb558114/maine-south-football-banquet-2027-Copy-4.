
import crypto from 'node:crypto';

const TEAMS = new Set(['freshman', 'sophomore', 'varsity']);
const FOLDER = 'maine-south-football-2027';
const PRESET = 'maine_south_2027';
const MAX_PHOTO_BYTES = 30 * 1024 * 1024;
const MAX_BODY_CHARS = Math.ceil(MAX_PHOTO_BYTES * 4 / 3) + 500000;

function reply(statusCode, data) {
  return {
    statusCode,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'access-control-allow-origin': 'same-origin'
    },
    body: JSON.stringify(data)
  };
}

async function cloudinaryJSON(url, options) {
  const response = await fetch(url, options);
  let data;
  try {
    data = await response.json();
  } catch {
    throw new Error(`Cloudinary returned non-JSON response (${response.status})`);
  }
  if (!response.ok) {
    const message = String(data?.error?.message || data?.error || `HTTP ${response.status}`);
    throw new Error(`Cloudinary HTTP ${response.status}: ${message.slice(0, 240)}`);
  }
  return data;
}

function getCredentials() {
  const cloud = process.env.CLOUDINARY_CLOUD_NAME;
  const key = process.env.CLOUDINARY_API_KEY;
  const secret = process.env.CLOUDINARY_API_SECRET;
  if (!cloud || !key || !secret) {
    throw new Error('Cloudinary environment variables are missing');
  }
  return { cloud, key, secret };
}

function basicAuth(key, secret) {
  return 'Basic ' + Buffer.from(`${key}:${secret}`).toString('base64');
}

function publicPhoto(asset) {
  const tags = Array.isArray(asset.tags) ? asset.tags : [];
  const team = [...TEAMS].find(t => tags.includes(`ms2027_${t}`));
  if (!team || !asset.secure_url || !asset.public_id) return null;
  return {
    id: asset.public_id,
    url: asset.secure_url,
    team,
    created: asset.created_at || ''
  };
}

export async function handler(event) {
  try {
    const { cloud, key, secret } = getCredentials();
    const action = event.queryStringParameters?.action || 'list';
    const method = event.httpMethod || 'GET';
    const auth = basicAuth(key, secret);

    if (action === 'list' && method === 'GET') {
      const assets = [];
      let cursor;

      for (let page = 0; page < 10; page++) {
        const url = new URL(
          `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/resources/by_asset_folder`
        );
        url.searchParams.set('asset_folder', FOLDER);
        url.searchParams.set('max_results', '100');
        url.searchParams.set('tags', 'true');

        if (cursor) url.searchParams.set('next_cursor', cursor);

        const data = await cloudinaryJSON(url.toString(), {
          headers: { authorization: auth }
        });

        assets.push(...(Array.isArray(data.resources) ? data.resources : []));
        cursor = data.next_cursor;
        if (!cursor) break;
      }

      const photos = assets
        .map(publicPhoto)
        .filter(Boolean)
        .sort((a, b) => b.created.localeCompare(a.created));

      return reply(200, { photos, more: Boolean(cursor) });
    }

    if (action === 'admin-check' && method === 'GET') {
      return reply(403, {
        error: 'Organizer authentication is not yet connected.'
      });
    }

    if (method !== 'POST') {
      return reply(405, { error: 'Method not allowed' });
    }

    if (action === 'delete') {
      return reply(403, {
        error: 'Organizer deletion is not yet enabled.'
      });
    }

    if (action === 'sign-upload') {
      return reply(403, {
        error: 'Signed uploads are not enabled in this test version.'
      });
    }

    if (action === 'upload') {
      if (process.env.UPLOADS_ENABLED !== 'true') {
        return reply(403, { error: 'Uploads are currently disabled.' });
      }

      if ((event.body || '').length > MAX_BODY_CHARS) {
        return reply(413, { error: 'Photo is too large.' });
      }

      let data;
      try {
        data = JSON.parse(event.body || '{}');
      } catch {
        return reply(400, { error: 'Invalid upload request.' });
      }

      if (!TEAMS.has(data.team)) {
        return reply(400, { error: 'Invalid team.' });
      }

      if (
        typeof data.image !== 'string' ||
        !/^data:image\/(jpeg|png|webp|heic|heif);base64,/i.test(data.image)
      ) {
        return reply(400, { error: 'Unsupported image format.' });
      }

      const base64 = data.image.slice(data.image.indexOf(',') + 1);

      if (Math.ceil(base64.length * 3 / 4) > MAX_PHOTO_BYTES) {
        return reply(413, { error: 'Photo is too large.' });
      }

      const form = new URLSearchParams({
        upload_preset: PRESET,
        tags: `ms2027_${data.team}`,
        file: data.image
      });

      const result = await cloudinaryJSON(
        `https://api.cloudinary.com/v1_1/${encodeURIComponent(cloud)}/image/upload`,
        { method: 'POST', body: form }
      );

      return reply(200, { ok: true, id: result.public_id });
    }

    return reply(404, { error: 'Unknown action' });

  } catch (error) {
    console.error(
      'Photo API error:',
      error instanceof Error ? error.message : 'Unknown error'
    );
    return reply(502, {
      error: 'Photo service unavailable. Please try again.'
    });
  }
}
