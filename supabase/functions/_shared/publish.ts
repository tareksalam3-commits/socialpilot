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

export async function publishToPlatform(
  platform: string,
  accessToken: string,
  providerAccountId: string | null,
  content: string,
  mediaUrls: string[],
): Promise<string> {
  if (platform === 'facebook') return publishToFacebook(accessToken, content, mediaUrls);
  if (platform === 'instagram') return publishToInstagram(accessToken, providerAccountId ?? '', content, mediaUrls);
  if (platform === 'linkedin' || platform === 'linkedin_page') {
    if (!providerAccountId) throw new Error('Missing LinkedIn author URN for this account');
    return publishToLinkedIn(accessToken, linkedInAuthorUrn(providerAccountId), content, mediaUrls);
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/** Exponential backoff: 5m, 15m, 45m, ... capped at 6h. */
export function nextRetryDelayMs(retryCount: number): number {
  const minutes = Math.min(5 * 3 ** retryCount, 360);
  return minutes * 60 * 1000;
}
