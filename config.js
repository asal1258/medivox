export const CONFIG = {
  SERVER_ADDRESS: "my-radiology-server.medivox.ca",
  RECONNECT_DELAY: 5000,
  MAX_RECONNECT_ATTEMPTS: 5,
  AUDIO_CONSTRAINTS: { sampleRate: 8000, channels: 1, bitDepth: 16 },
  SUPPORTED_AUDIO_TYPES: ["audio/wav", "audio/mp3", "audio/mpeg", "audio/m4a", "audio/x-m4a", "audio/ogg", "audio/webm"],
  MAX_FILE_SIZE: 50 * 1024 * 1024,
};

export const ERROR_TYPES = {
  CONNECTION: "connection",
  AUDIO: "audio",
  FILE: "file",
  PROCESSING: "processing",
  PERMISSION: "permission"
};
