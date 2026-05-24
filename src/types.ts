export interface ChatMessage {
  id: string;
  role: "user" | "model";
  text: string;
  timestamp: string;
  attachmentType?: "image" | "zip" | "audio";
  attachmentName?: string;
}

export interface ZipFileEntry {
  name: string;
  path: string;
  content: string | null;
  size: number;
  isFolder: boolean;
  selectedForPrompt: boolean;
}

export type ActiveTool = "chat" | "zip" | "image" | "audio";

export interface TranscribeMode {
  id: string;
  name: string;
  description: string;
  icon: string;
}
