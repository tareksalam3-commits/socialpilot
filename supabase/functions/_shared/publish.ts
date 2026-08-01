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

export async function publishToLinkedIn(accessToken: string, authorUrn: string, content: string): Promise<string> {
  const res = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', 'X-Restli-Protocol-Version': '2.0.0' },
    body: JSON.stringify({
      author: authorUrn,
      lifecycleState: 'PUBLISHED',
      specificContent: {
        'com.linkedin.ugc.PostContent': {
          shareCommentary: { text: content },
          shareMediaCategory: 'NONE',
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

export async function publishToInstagram(accessToken: string, content: string, mediaUrls: string[]): Promise<string> {
  if (mediaUrls.length === 0) throw new Error('Instagram requires at least one image or video');
  const video = isVideoUrl(mediaUrls[0]);

  const containerRes = await fetch(`${GRAPH}/me/media`, {
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

  const publishRes = await fetch(`${GRAPH}/me/media_publish`, {
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
  if (platform === 'instagram') return publishToInstagram(accessToken, content, mediaUrls);
  if (platform === 'linkedin' || platform === 'linkedin_page') {
    if (!providerAccountId) throw new Error('Missing LinkedIn author URN for this account');
    return publishToLinkedIn(accessToken, linkedInAuthorUrn(providerAccountId), content);
  }
  throw new Error(`Unsupported platform: ${platform}`);
}

/** Exponential backoff: 5m, 15m, 45m, ... capped at 6h. */
export function nextRetryDelayMs(retryCount: number): number {
  const minutes = Math.min(5 * 3 ** retryCount, 360);
  return minutes * 60 * 1000;
}
