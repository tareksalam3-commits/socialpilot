import {
  Facebook,
  Instagram,
  Linkedin,
  Twitter,
  MessageCircle,
  Send,
  Music2,
  type LucideIcon,
} from 'lucide-react';
import type { SocialPlatform } from './types';

export const PLATFORM_META: Record<
  SocialPlatform,
  { label: string; icon: LucideIcon; color: string; maxLen: number }
> = {
  facebook: { label: 'فيسبوك', icon: Facebook, color: '#1877F2', maxLen: 5000 },
  instagram: { label: 'إنستجرام', icon: Instagram, color: '#E4405F', maxLen: 2200 },
  linkedin: { label: 'لينكدإن', icon: Linkedin, color: '#0A66C2', maxLen: 3000 },
  x: { label: 'إكس', icon: Twitter, color: '#000000', maxLen: 280 },
  threads: { label: 'ثريدز', icon: MessageCircle, color: '#333333', maxLen: 500 },
  tiktok: { label: 'تيك توك', icon: Music2, color: '#000000', maxLen: 2200 },
  telegram: { label: 'تيليجرام', icon: Send, color: '#26A5E4', maxLen: 4096 },
  whatsapp: { label: 'واتساب', icon: MessageCircle, color: '#25D366', maxLen: 65536 },
};

export const PLATFORMS = Object.keys(PLATFORM_META) as SocialPlatform[];
