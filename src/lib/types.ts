import { Timestamp } from 'firebase/firestore';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
  createdAt: Timestamp;
}

export interface ChatThread {
  id: string;
  userId: string;
  title: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
  model: string;
}

export interface ChatMessage {
  id: string;
  chatId: string;
  role: 'user' | 'model' | 'system';
  content: string;
  type: 'text' | 'video' | 'audio';
  createdAt: Timestamp;
  metadata?: {
    videoUrl?: string;
    audioUrl?: string;
    groundingChunks?: any[];
    thinking?: string;
  };
}
