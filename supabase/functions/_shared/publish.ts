const GRAPH = 'https://graph.facebook.com/v21.0';

function isVideoUrl(url: string): boolean {
  return /\.(mp4|mov|m4v)(\?|$)/i.test(url);
}

export async function publishToFacebook(accessToken: string, content: string, mediaUrls: string[]): Promise<string> {
  if (mediaUrls.length === 0) {
    const res = await fetch(`${GRAPH}/me/feed`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: content, access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook: ${res.status} ${await res.text()}`);
    return (await res.json()).id as string;
  }
  if (isVideoUrl(mediaUrls[0])) {
    const res = await fetch(`${GRAPH}/me/videos`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ description: content, file_url: mediaUrls[0], access_token: accessToken }),
    });
    if (!res.ok) throw new Error(`Facebook video: ${res.status} ${await res.text()}`);
    return (await res.json()).id as string;
  }
  const res = await fetch(`${GRAPH}/me/photos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ caption: content, url: mediaUrls[0], access_token: accessToken }),
  });
  if (!res.ok) throw new Error(`Facebook: ${res.status} ${await res.text()}`);
  return (await res.json()).post_id as string;
}

/** Registers an image upload with LinkedIn and returns the URL to PUT the
 * image bytes to plus the asset URN to reference in the post. */
async function registerLinkedInImageUpload(accessToken: string, authorUrn: string): Promise<{ uploadUrl: string; asset: string }> {
  const res = await fetch('https://api.linkedin.com/v2/assets?action=registerUpload', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      registerUploadRequest: {
        recipes: ['urn:li:digitalmediaRecipe:feedshare-image'],
        owner: authorUrn,
        serviceRelationships: [{ relationshipType: 'OWNER', identifier: 'urn:li:userGeneratedContent' }],
      },
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn image registration: ${res.status} ${await res.text()}`);
  const body = await res.json();
  const uploadUrl = body.value.uploadMechanism['com.linkedin.digitalmedia.uploading.MediaUploadHttpRequest'].uploadUrl as string;
  const asset = body.value.asset as string;
  return { uploadUrl, asset };
}

async function uploadLinkedInImage(accessToken: string, authorUrn: string, imageUrl: string): Promise<string> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Could not fetch image to upload to LinkedIn: ${imageRes.status}`);
  const imageBytes = await imageRes.arrayBuffer();

  const { uploadUrl, asset } = await registerLinkedInImageUpload(accessToken, authorUrn);

  const putRes = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${accessToken}` },
    body: imageBytes,
  });
  if (!putRes.ok) throw new Error(`LinkedIn image upload: ${putRes.status} ${await putRes.text()}`);

  return asset;
}

export async function publishToLinkedIn(accessToken: string, authorUrn: string, content: string, mediaUrls: string[] = []): Promise<string> {
  // LinkedIn only accepts images through UGC posts (no direct video support
  // via this endpoint) — anything else in mediaUrls is skipped rather than
  // failing the whole post.
  const imageUrl = mediaUrls.find((u) => !isVideoUrl(u));
  const asset = imageUrl ? await uploadLinkedInImage(accessToken, authorUrn, imageUrl) : null;

  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.PostContent': {
          shareCommentary: { text: content },
          shareMediaCategory: asset ? 'IMAGE' : 'NONE',
          ...(asset ? { media: [{ status: 'READY', media: asset }] } : {}),
        },
      },
      visibility: { 'com.linkedin.ugc.MemberConnectionVisibility': 'PUBLIC' },
    }),
  });
  if (!res.ok) throw new Error(`LinkedIn: ${res.status} ${await res.text()}`);
  return (await res.json()).id as string;
}

/** Resolves the author URN for a LinkedIn target. Personal profiles were
 * stored with provider_account_id already in `urn:li:person:...` form;
 * company Pages as `urn:li:organization:...` — both from the OAuth connect
 * flow, so no extra lookup is needed at publish time. */
export function linkedInAuthorUrn(providerAccountId: string): string {
  return providerAccountId;
}

async function waitForContainerReady(containerId: string, accessToken: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${GRAPH}/${containerId}?fields=status_code&access_token=${accessToken}`);
    const body = await res.json();
    if (body.status_code === 'FINISHED') return;
    if (body.status_code === 'ERROR') throw new Error('Instagram media container failed to process');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Instagram media container timed out processing');
}

/** Instagram Graph API has no "/me" alias for content endpoints — every
 * container/publish call must be scoped to the IG Business Account ID
 * explicitly (`/{ig-user-id}/media`, `/{ig-user-id}/media_publish`). That ID
 * is what's stored as provider_account_id for Instagram connected accounts
 * (see oauth-selection, which sets it from the Page's linked
 * instagram_business_account.id at connect time). */
export async function publishToInstagram(accessToken: string, igUserId: string, content: string, mediaUrls: string[]): Promise<string> {
  if (!igUserId) throw new Error('Missing Instagram Business Account ID for this account');
  if (mediaUrls.length === 0) throw new Error('Instagram requires at least one image or video');
  const video = isVideoUrl(mediaUrls[0]);

  const containerRes = await fetch(`${GRAPH}/${igUserId}/media`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(
      video
        ? { media_type: 'REELS', video_url: mediaUrls[0], caption: content, access_token: accessToken }
        : { image_url: mediaUrls[0], caption: content, access_token: accessToken },
    ),
  });
  if (!containerRes.ok) throw new Error(`Instagram: ${containerRes.status} ${await containerRes.text()}`);
  const container = await containerRes.json();

  if (video) await waitForContainerReady(container.id, accessToken);

  const publishRes = await fetch(`${GRAPH}/${igUserId}/media_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  if (!publishRes.ok) throw new Error(`Instagram publish: ${publishRes.status} ${await publishRes.text()}`);
  return (await publishRes.json()).id as string;
}

const X_API = 'https://api.twitter.com/2';

/** Uploads one image to X via the v1.1 media endpoint (still the only media
 * upload endpoint X offers — there is no v2 equivalent) using simple,
 * non-chunked upload. Chunked upload (required for video/GIF) is handled by
 * uploadXVideoChunked below. Returns the media_id to attach to the tweet. */
async function uploadXImage(accessToken: string, imageUrl: string): Promise<string> {
  const imageRes = await fetch(imageUrl);
  if (!imageRes.ok) throw new Error(`Could not fetch image to upload to X: ${imageRes.status}`);
  const bytes = new Uint8Array(await imageRes.arrayBuffer());
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  const base64 = btoa(binary);

  const res = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ media_data: base64 }),
  });
  if (!res.ok) throw new Error(`X media upload: ${res.status} ${await res.text()}`);
  return (await res.json()).media_id_string as string;
}

/** Chunked upload — required by X for video/GIF regardless of size. */
async function uploadXVideoChunked(accessToken: string, videoUrl: string): Promise<string> {
  const videoRes = await fetch(videoUrl);
  if (!videoRes.ok) throw new Error(`Could not fetch video to upload to X: ${videoRes.status}`);
  const bytes = new Uint8Array(await videoRes.arrayBuffer());
  const authHeader = { Authorization: `Bearer ${accessToken}` };

  const initRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ command: 'INIT', total_bytes: String(bytes.length), media_type: 'video/mp4', media_category: 'tweet_video' }),
  });
  if (!initRes.ok) throw new Error(`X video upload INIT: ${initRes.status} ${await initRes.text()}`);
  const mediaId = (await initRes.json()).media_id_string as string;

  const chunkSize = 4 * 1024 * 1024;
  for (let i = 0, segment = 0; i < bytes.length; i += chunkSize, segment++) {
    const chunk = bytes.slice(i, i + chunkSize);
    const form = new FormData();
    form.append('command', 'APPEND');
    form.append('media_id', mediaId);
    form.append('segment_index', String(segment));
    form.append('media', new Blob([chunk]));
    const appendRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', { method: 'POST', headers: authHeader, body: form });
    if (!appendRes.ok) throw new Error(`X video upload APPEND: ${appendRes.status} ${await appendRes.text()}`);
  }

  const finalizeRes = await fetch('https://upload.twitter.com/1.1/media/upload.json', {
    method: 'POST',
    headers: { ...authHeader, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ command: 'FINALIZE', media_id: mediaId }),
  });
  if (!finalizeRes.ok) throw new Error(`X video upload FINALIZE: ${finalizeRes.status} ${await finalizeRes.text()}`);

  for (let i = 0; i < 20; i++) {
    const statusRes = await fetch(`https://upload.twitter.com/1.1/media/upload.json?command=STATUS&media_id=${mediaId}`, { headers: authHeader });
    const status = await statusRes.json();
    const state = status.processing_info?.state;
    if (!state || state === 'succeeded') return mediaId;
    if (state === 'failed') throw new Error(`X video processing failed: ${status.processing_info?.error?.message ?? 'unknown error'}`);
    await new Promise((r) => setTimeout(r, (status.processing_info?.check_after_secs ?? 3) * 1000));
  }
  throw new Error('X video processing timed out');
}

export async function publishToX(accessToken: string, content: string, mediaUrls: string[]): Promise<string> {
  const mediaIds: string[] = [];
  if (mediaUrls.length > 0) {
    const mediaId = isVideoUrl(mediaUrls[0]) ? await uploadXVideoChunked(accessToken, mediaUrls[0]) : await uploadXImage(accessToken, mediaUrls[0]);
    mediaIds.push(mediaId);
  }
  const res = await fetch(`${X_API}/tweets`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ text: content, ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }),
  });
  if (!res.ok) throw new Error(`X: ${res.status} ${await res.text()}`);
  return (await res.json()).data.id as string;
}

const THREADS_GRAPH = 'https://graph.threads.net/v1.0';

async function waitForThreadsContainer(containerId: string, accessToken: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${THREADS_GRAPH}/${containerId}?fields=status&access_token=${accessToken}`);
    const body = await res.json();
    if (body.status === 'FINISHED') return;
    if (body.status === 'ERROR') throw new Error('Threads media container failed to process');
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error('Threads media container timed out processing');
}

export async function publishToThreads(accessToken: string, threadsUserId: string, content: string, mediaUrls: string[]): Promise<string> {
  if (!threadsUserId) throw new Error('Missing Threads user id for this account');
  const mediaType = mediaUrls.length === 0 ? 'TEXT' : isVideoUrl(mediaUrls[0]) ? 'VIDEO' : 'IMAGE';

  const containerRes = await fetch(`${THREADS_GRAPH}/${threadsUserId}/threads`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      media_type: mediaType,
      text: content,
      ...(mediaType === 'IMAGE' ? { image_url: mediaUrls[0] } : {}),
      ...(mediaType === 'VIDEO' ? { video_url: mediaUrls[0] } : {}),
      access_token: accessToken,
    }),
  });
  if (!containerRes.ok) throw new Error(`Threads: ${containerRes.status} ${await containerRes.text()}`);
  const container = await containerRes.json();

  if (mediaType === 'VIDEO') await waitForThreadsContainer(container.id, accessToken);

  const publishRes = await fetch(`${THREADS_GRAPH}/${threadsUserId}/threads_publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ creation_id: container.id, access_token: accessToken }),
  });
  if (!publishRes.ok) throw new Error(`Threads publish: ${publishRes.status} ${await publishRes.text()}`);
  return (await publishRes.json()).id as string;
}

async function waitForTikTokPublish(publishId: string, accessToken: string, maxAttempts = 10): Promise<void> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch('https://open.tiktokapis.com/v2/post/publish/status/fetch/', {
      method: 'POST',
      headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ publish_id: publishId }),
    });
    const body = await res.json();
    const status = body.data?.status;
    if (status === 'PUBLISH_COMPLETE') return;
    if (status === 'FAILED') throw new Error(`TikTok publish failed: ${body.data?.fail_reason ?? 'unknown error'}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  // Not an error — TikTok processing can legitimately take longer than this
  // poll window for larger videos; publishing_logs still records success at
  // the init step and the scheduled account-sync sweep will catch a late failure.
}

/** TikTok's Content Posting API only supports video (no static image/text
 * posts). Unaudited apps are additionally restricted by TikTok to
 * private/self-view publishing (or "upload to inbox as draft") until the app
 * passes their content-posting review — a platform-side limitation, not a
 * bug in this integration. */
export async function publishToTikTok(accessToken: string, content: string, mediaUrls: string[]): Promise<string> {
  const videoUrl = mediaUrls.find((u) => isVideoUrl(u));
  if (!videoUrl) throw new Error('TikTok requires a video attachment — image-only or text-only posts are not supported by the Content Posting API');

  const res = await fetch('https://open.tiktokapis.com/v2/post/publish/video/init/', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      post_info: { title: content.slice(0, 150), privacy_level: 'SELF_ONLY', disable_duet: false, disable_comment: false, disable_stitch: false },
      source_info: { source: 'PULL_FROM_URL', video_url: videoUrl },
    }),
  });
  if (!res.ok) throw new Error(`TikTok: ${res.status} ${await res.text()}`);
  const body = await res.json();
  if (body.error?.code && body.error.code !== 'ok') throw new Error(`TikTok: ${body.error.message}`);
  const publishId = body.data.publish_id as string;

  await waitForTikTokPublish(publishId, accessToken);
  return publishId;
}

/** Sends a text/photo/video message to the configured chat via the Bot API.
 * Telegram has no concept of a public "feed post" outside channels — for a
 * channel/group chat_id this is exactly a broadcast post; for a private
 * chat_id it's a direct message. Either way it's the same send* call. */
export async function publishToTelegram(botToken: string, chatId: string, content: string, mediaUrls: string[]): Promise<string> {
  const base = `https://api.telegram.org/bot${botToken}`;
  let res: Response;
  if (mediaUrls.length === 0) {
    res = await fetch(`${base}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text: content }),
    });
  } else if (isVideoUrl(mediaUrls[0])) {
    res = await fetch(`${base}/sendVideo`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, video: mediaUrls[0], caption: content }),
    });
  } else {
    res = await fetch(`${base}/sendPhoto`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, photo: mediaUrls[0], caption: content }),
    });
  }
  const body = await res.json();
  if (!body.ok) throw new Error(`Telegram: ${body.description ?? res.status}`);
  return String(body.result.message_id);
}

/** WhatsApp Business has no public "feed" — the Cloud API only sends
 * messages to a specific recipient number, and outside a 24-hour customer
 * service window (i.e. the recipient hasn't messaged the business recently)
 * Meta requires a pre-approved Message Template rather than free-form text.
 * `metadata.whatsapp_template` on the post (set from the post editor/AI
 * Assistant) selects template mode; otherwise this sends free-form text,
 * which only succeeds inside an open session. `metadata.whatsapp_to`
 * overrides the account's configured default recipient for this one post. */
export async function publishToWhatsApp(
  accessToken: string,
  phoneNumberId: string,
  content: string,
  mediaUrls: string[],
  recipient: string,
  templateName?: string,
): Promise<string> {
  if (!recipient) throw new Error('No recipient phone number configured for this WhatsApp Business account');
  const base = `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`;

  const payload: Record<string, unknown> = templateName
    ? { messaging_product: 'whatsapp', to: recipient, type: 'template', template: { name: templateName, language: { code: 'en_US' }, components: [{ type: 'body', parameters: [{ type: 'text', text: content }] }] } }
    : mediaUrls.length === 0
      ? { messaging_product: 'whatsapp', to: recipient, type: 'text', text: { body: content } }
      : isVideoUrl(mediaUrls[0])
        ? { messaging_product: 'whatsapp', to: recipient, type: 'video', video: { link: mediaUrls[0], caption: content } }
        : { messaging_product: 'whatsapp', to: recipient, type: 'image', image: { link: mediaUrls[0], caption: content } };

  const res = await fetch(base, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(`WhatsApp: ${body?.error?.message ?? res.status}`);
  return body.messages[0].id as string;
}

export async function publishToPlatform(
  platform: string,
  accessToken: string,
  providerAccountId: string | null,
  content: string,
  mediaUrls: string[],
  metadata: Record<string, unknown> = {},
): Promise<string> {
  if (platform === 'facebook') return publishToFacebook(accessToken, content, mediaUrls);
  if (platform === 'instagram') return publishToInstagram(accessToken, providerAccountId ?? '', content, mediaUrls);
  if (platform === 'linkedin' || platform === 'linkedin_page') {
    if (!providerAccountId) throw new Error('Missing LinkedIn author URN for this account');
    return publishToLinkedIn(accessToken, linkedInAuthorUrn(providerAccountId), content, mediaUrls);
  }
  if (platform === 'x') return publishToX(accessToken, content, mediaUrls);
  if (platform === 'threads') return publishToThreads(accessToken, providerAccountId ?? '', content, mediaUrls);
  if (platform === 'tiktok') return publishToTikTok(accessToken, content, mediaUrls);
  if (platform === 'telegram') {
    if (!providerAccountId) throw new Error('Missing Telegram chat id for this account');
    return publishToTelegram(accessToken, providerAccountId, content, mediaUrls);
  }
  if (platform === 'whatsapp') {
    if (!providerAccountId) throw new Error('Missing WhatsApp phone number id for this account');
    const recipient = (metadata.whatsapp_to as string | undefined) ?? (metadata.default_recipient as string | undefined) ?? '';
    return publishToWhatsApp(accessToken, providerAccountId, content, mediaUrls, recipient, metadata.whatsapp_template as string | undefined);
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/** Exponential backoff: 5m, 15m, 45m, ... capped at 6h. */
export function nextRetryDelayMs(retryCount: number): number {
  const minutes = Math.min(5 * 3 ** retryCount, 360);
  return minutes * 60 * 1000;
}
