import { CONFIG, ERROR_TYPES } from './config.js';
import AppState from './state.js';
import { updateUIForConnection, showProgress, hideProgress, formatTextAsHtml, toggleSections, resetUIafterProcessing, handleError } from './ui.js';

export function connectWebSocket() {
    if (AppState.socket && (AppState.socket.readyState === WebSocket.OPEN || AppState.socket.readyState === WebSocket.CONNECTING)) {
        return;
    }

    const url = `wss://${CONFIG.SERVER_ADDRESS}`;
    const connectionStatus = document.getElementById("connectionStatus");
    connectionStatus.textContent = "Connexion...";
    connectionStatus.style.color = "var(--warning-color)";
    
    try {
        AppState.socket = new WebSocket(url);
        setupWebSocketHandlers();
    } catch (e) {
        handleError(ERROR_TYPES.CONNECTION, "Failed to create WebSocket connection", e);
        AppState.reconnectAttempts++;
    }
}

function setupWebSocketHandlers() {
    AppState.socket.onopen = () => {
        AppState.reconnectAttempts = 0;
        updateUIForConnection(true);
        showProgress("Connecté au serveur de transcription.");
        setTimeout(hideProgress, 3000);
    };

    AppState.socket.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            handleServerMessage(data);
        } catch (e) {
            handleError(ERROR_TYPES.PROCESSING, "Invalid server response", e);
        }
    };

    AppState.socket.onerror = (err) => {
        handleError(ERROR_TYPES.CONNECTION, "WebSocket error occurred", err);
        updateUIForConnection(false);
    };

    AppState.socket.onclose = (event) => {
        AppState.socket = null;
        updateUIForConnection(false);
        if (!event.wasClean) {
            AppState.reconnectAttempts++;
            handleError(ERROR_TYPES.CONNECTION, "Connection lost", { code: event.code, message: event.reason });
        }
    };
}

function handleServerMessage(data) {
    const { action, message, text, performance, error: serverError } = data;
    try {
        switch (action) {
            case "progress":
                showProgress(message);
                break;
            case "transcription_complete":
                if (!text) throw new Error("No transcription text received");
                AppState.transcribedText = text;
                const speed = performance ? `(${performance.speed || "N/A"})` : "";
                showProgress(`Transcription terminée ${speed}. Mise en forme en cours...`);
                requestFormatting();
                break;
            case "formatting_complete":
                if (!text) throw new Error("No formatted text received");
                hideProgress();
                document.getElementById("resultText").innerHTML = formatTextAsHtml(text);
                toggleSections(true);
                resetUIafterProcessing(true);
                break;
            case "error":
                throw new Error(message || serverError || "Unknown server error");
            default:
                console.warn("Unknown server action:", action);
        }
    } catch (e) {
        handleError(ERROR_TYPES.PROCESSING, "Server message processing failed", e);
        resetUIafterProcessing(false);
    }
}

function requestFormatting() {
    if (!AppState.socket || AppState.socket.readyState !== WebSocket.OPEN) {
        throw new Error("WebSocket not connected");
    }
    if (!AppState.transcribedText) {
        throw new Error("No transcribed text to format");
    }
    try {
        AppState.socket.send(JSON.stringify({ action: "format_text", text: AppState.transcribedText }));
    } catch (e) {
        handleError(ERROR_TYPES.CONNECTION, "Failed to send formatting request", e);
    }
}

/**
 * NOTE ON SENDING LARGE FILES:
 * This function sends the entire file as a Base64 string. This is NOT recommended for large
 * files (e.g., >10-20MB) as it can crash the browser or be rejected by the server.
 * A more robust solution is "chunking": splitting the file into smaller pieces (e.g., 1MB)
 * and sending them sequentially. The server would then reassemble these chunks.
 * This function is kept for simplicity based on the original code.
 */
export function sendFileToServer() {
    if (!AppState.currentFile) {
        handleError(ERROR_TYPES.FILE, "No file to send.");
        return;
    }
    showProgress("Lecture et envoi de l'audio au serveur...");
    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const base64Audio = e.target.result.split(",")[1];
            if (!base64Audio) throw new Error("Failed to encode file to base64");
            const message = {
                action: "transcribe_audio",
                audio: base64Audio,
                metadata: {
                    filename: AppState.currentFile.name || "recording.wav",
                    size: AppState.currentFile.size,
                    type: AppState.currentFile.type || "audio/wav"
                }
            };
            AppState.socket.send(JSON.stringify(message));
        } catch (err) {
            handleError(ERROR_TYPES.PROCESSING, "Failed to send audio data", err);
            resetUIafterProcessing(false);
        }
    };
    reader.onerror = (err) => {
        handleError(ERROR_TYPES.FILE, "Failed to read audio file", err);
        resetUIafterProcessing(false);
    };
    reader.readAsDataURL(AppState.currentFile);
}
