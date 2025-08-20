import AppState from './state.js';
import { initializeUI, handleError } from './ui.js';
import { initializeWavesurfer } from './audio.js';
import { connectWebSocket } from './websocket.js';
import { ERROR_TYPES } from './config.js';

// --- Application Entry Point ---
document.addEventListener("DOMContentLoaded", () => {
    initializeApplication();
});

function initializeApplication() {
    try {
        initializeUI();
        initializeWavesurfer();
        connectWebSocket();
    } catch (error) {
        handleError(ERROR_TYPES.PROCESSING, "Failed to initialize application", error);
    }
}

// --- Global Event Listeners ---
window.addEventListener("beforeunload", () => {
    if (AppState.socket) AppState.socket.close();
    if (AppState.stream) AppState.stream.getTracks().forEach((t) => t.stop());
    if (AppState.wavesurfer) AppState.wavesurfer.destroy();
});
