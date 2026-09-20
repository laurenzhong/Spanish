export type MediaAssetStorage = Readonly<{
  putAudio(path: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
  putVideo(path: string, body: Uint8Array, contentType: string): Promise<{ url: string }>;
  putVideoFromFile?(path: string, filePath: string): Promise<{ url: string }>;
  putVideoFromUrl?(path: string, sourceUrl: string): Promise<{ url: string }>;
  remove(path: string, kind?: "audio" | "video"): Promise<void>;
}>;
