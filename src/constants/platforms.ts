import { AtSign, Facebook, Instagram, Linkedin, MessageCircle, Music2, Send, Twitter, type LucideIcon } from 'lucide-react';

export type PlatformCategory = 'social' | 'messaging';
export type ConnectMethod = 'meta_oauth' | 'linkedin_oauth' | 'x_oauth' | 'threads_oauth' | 'tiktok_oauth' | 'telegram_manual' | 'whatsapp_manual';

export type PlatformDefinition = {
  id: string;
  label: string;
  category: PlatformCategory;
  icon: LucideIcon;
  color: string; // Tailwind text color class, used for icon tint
  badgeClass: string; // Tailwind bg/text classes for pill-style chips (calendar, drafts)
  connectMethod: ConnectMethod;
  supportsMedia: boolean;
  supportsScheduling: boolean;
  supportsRefresh: boolean;
  translationKey: string;
};

export const PLATFORM_DEFINITIONS: PlatformDefinition[] = [
  {
    id: 'facebook',
    label: 'Facebook Page',
    category: 'social',
    icon: Facebook,
    color: 'text-blue-600',
    badgeClass: 'bg-blue-100 text-blue-700 dark:bg-blue-950 dark:text-blue-300',
    connectMethod: 'meta_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'facebook',
  },
  {
    id: 'instagram',
    label: 'Instagram Business',
    category: 'social',
    icon: Instagram,
    color: 'text-pink-600',
    badgeClass: 'bg-pink-100 text-pink-700 dark:bg-pink-950 dark:text-pink-300',
    connectMethod: 'meta_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'instagram',
  },
  {
    id: 'linkedin',
    label: 'LinkedIn Profile',
    category: 'social',
    icon: Linkedin,
    color: 'text-sky-700',
    badgeClass: 'bg-sky-100 text-sky-700 dark:bg-sky-950 dark:text-sky-300',
    connectMethod: 'linkedin_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'linkedin',
  },
  {
    id: 'linkedin_page',
    label: 'LinkedIn Company Page',
    category: 'social',
    icon: Linkedin,
    color: 'text-indigo-700',
    badgeClass: 'bg-indigo-100 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300',
    connectMethod: 'linkedin_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'linkedin_page',
  },
  {
    id: 'x',
    label: 'X (Twitter)',
    category: 'social',
    icon: Twitter,
    color: 'text-slate-900 dark:text-slate-100',
    badgeClass: 'bg-slate-200 text-slate-900 dark:bg-slate-800 dark:text-slate-100',
    connectMethod: 'x_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'x',
  },
  {
    id: 'threads',
    label: 'Threads',
    category: 'social',
    icon: AtSign,
    color: 'text-neutral-900 dark:text-neutral-100',
    badgeClass: 'bg-neutral-200 text-neutral-900 dark:bg-neutral-800 dark:text-neutral-100',
    connectMethod: 'threads_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'threads',
  },
  {
    id: 'tiktok',
    label: 'TikTok',
    category: 'social',
    icon: Music2,
    color: 'text-teal-600',
    badgeClass: 'bg-teal-100 text-teal-700 dark:bg-teal-950 dark:text-teal-300',
    connectMethod: 'tiktok_oauth',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: true,
    translationKey: 'tiktok',
  },
  {
    id: 'telegram',
    label: 'Telegram',
    category: 'messaging',
    icon: Send,
    color: 'text-cyan-600',
    badgeClass: 'bg-cyan-100 text-cyan-700 dark:bg-cyan-950 dark:text-cyan-300',
    connectMethod: 'telegram_manual',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: false,
    translationKey: 'telegram',
  },
  {
    id: 'whatsapp',
    label: 'WhatsApp Business',
    category: 'messaging',
    icon: MessageCircle,
    color: 'text-green-600',
    badgeClass: 'bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-300',
    connectMethod: 'whatsapp_manual',
    supportsMedia: true,
    supportsScheduling: true,
    supportsRefresh: false,
    translationKey: 'whatsapp',
  },
];

const BY_ID = new Map(PLATFORM_DEFINITIONS.map((p) => [p.id, p]));

export function getPlatformMeta(platform: string): PlatformDefinition | undefined {
  return BY_ID.get(platform);
}

export function platformLabelFallback(platform: string): string {
  return BY_ID.get(platform)?.label ?? platform;
}

export const PLATFORM_IDS = PLATFORM_DEFINITIONS.map((p) => p.id);
export const SOCIAL_PLATFORMS = PLATFORM_DEFINITIONS.filter((p) => p.category === 'social');
export const MESSAGING_PLATFORMS = PLATFORM_DEFINITIONS.filter((p) => p.category === 'messaging');
