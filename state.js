// This object holds the shared state of the application.
// Using a single object makes it easier to manage and pass between modules.
const AppState = {
    // WebSocket
    socket: null,
    reconnectAttempts: 0,
    
    // File & Data
    currentFile: null,
    transcribedText: "",

    // Audio Recorder & Player
    wavesurfer: null,
    mediaRecorder: null,
    stream: null,
    audioChunks: [],
    isRecording: false,
    isPaused: false,
    editMode: "insert",
    originalBuffer: null, // Stores the master AudioBuffer for editing
    
    // UI State
    isDraggingProgress: false,
    animationFrameId: null,
    recordStartMs: null,
    recordTimerId: null,
};

// We export the object directly. Modules can import it and modify its properties.
// e.g., import AppState from './state.js'; AppState.isRecording = true;
export default AppState;
