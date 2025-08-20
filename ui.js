import { CONFIG, ERROR_TYPES } from './config.js';
import AppState from './state.js';
import { connectWebSocket } from './websocket.js';
import { toggleRecording, stopRecording, processAndSendAudio, initializeWavesurfer } from './audio.js';

// --- DOM Element Selectors ---
const DOMElements = {
    // Status & Global
    connectionStatus: document.getElementById("connectionStatus"),
    errorMessage: document.getElementById("errorMessage"),
    processingContainer: document.getElementById("processing-container"),
    // Upload Tab
    dropzone: document.getElementById("dropzone"),
    fileInput: document.getElementById("fileInput"),
    browseBtn: document.getElementById("browseBtn"),
    fileLabel: document.getElementById("fileLabel"),
    // Recorder Tab
    recordBtn: document.getElementById("recordBtn"),
    stopBtn: document.getElementById("stopBtn"),
    playBtn: document.getElementById("playBtn"),
    rewindBtn: document.getElementById("rewindBtn"),
    forwardBtn: document.getElementById("forwardBtn"),
    deleteBtn: document.getElementById("deleteBtn"),
    insertModeBtn: document.getElementById("insertModeBtn"),
    overwriteModeBtn: document.getElementById("overwriteModeBtn"),
    timeline: document.getElementById("timeline"),
    // Progress Bar
    voiceProgressBar: document.getElementById("voiceProgressBar"),
    voiceProgressFill: document.getElementById("voiceProgressFill"),
    voiceProgressHandle: document.getElementById("voiceProgressHandle"),
    currentTimeLabel: document.getElementById("currentTimeLabel"),
    totalTimeLabel: document.getElementById("totalTimeLabel"),
    // Actions
    processBtn: document.getElementById("processBtn"),
    progressLabel: document.getElementById("progressLabel"),
    // Result Section
    resultSection: document.getElementById("resultSection"),
    resultText: document.getElementById("resultText"),
    newSessionBtn: document.getElementById("newSessionBtn"),
    copyBtn: document.getElementById("copyBtn"),
    saveBtn: document.getElementById("saveBtn"),
    // Sounds
    clickSound: document.getElementById("click-sound"),
};

// --- Initialization ---
export function initializeUI() {
    initializeIOSCompatibility();
    initializeProgressBar();
    setupEventListeners();
    updateRecorderUI();
}

function initializeIOSCompatibility() {
    const isIOS = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !window.MSStream;
    if (isIOS) {
        const AudioContextCls = window.AudioContext || window.webkitAudioContext;
        if (AudioContextCls) {
            const audioContext = new AudioContextCls();
            const resume = () => {
                if (audioContext.state === "suspended") audioContext.resume().catch(() => {});
            };
            ["touchstart", "touchend", "mousedown", "click"].forEach((ev) => document.addEventListener(ev, resume, { once: true, passive: true }));
        }
        if (window.location.protocol !== "https:" && window.location.hostname !== "localhost") {
            showErrorMessage("HTTPS requis pour l'enregistrement audio sur iOS", "warning");
        }
    }
}

// --- Event Listeners ---
function setupEventListeners() {
    setupTabListeners();
    setupUploadListeners();
    setupRecorderListeners();
    setupActionListeners();
    setupKeyboardShortcuts();
}

function setupTabListeners() {
    document.querySelectorAll(".tab-button").forEach(btn => {
        btn.addEventListener("click", (e) => {
            e.preventDefault();
            const tabId = btn.dataset.tab;
            document.querySelectorAll(".tab-button").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".tab-pane").forEach(p => p.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(tabId).classList.add("active");
            DOMElements.clickSound.play().catch(() => {});
        });
    });
}

function setupUploadListeners() {
    const { dropzone, fileInput, browseBtn } = DOMElements;
    const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
    ["dragenter", "dragover", "dragleave", "drop"].forEach(ev => {
        dropzone.addEventListener(ev, preventDefaults, false);
        document.body.addEventListener(ev, preventDefaults, false);
    });
    ["dragenter", "dragover"].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.add("dragover")));
    ["dragleave", "drop"].forEach(ev => dropzone.addEventListener(ev, () => dropzone.classList.remove("dragover")));
    dropzone.addEventListener("drop", (e) => {
        if (e.dataTransfer.files?.length > 0) handleFileSelect(e.dataTransfer.files[0]);
    });
    browseBtn.addEventListener("click", (e) => { e.preventDefault(); fileInput.click(); });
    fileInput.addEventListener("change", (e) => { if (e.target.files.length > 0) handleFileSelect(e.target.files[0]); });
}

function setupRecorderListeners() {
    const { recordBtn, stopBtn, playBtn, rewindBtn, forwardBtn, deleteBtn, insertModeBtn, overwriteModeBtn } = DOMElements;
    recordBtn.addEventListener("click", () => { toggleRecording(); DOMElements.clickSound.play().catch(() => {}); });
    stopBtn.addEventListener("click", () => { if (!stopBtn.disabled) stopRecording(); });
    playBtn.addEventListener("click", () => { if (!playBtn.disabled && AppState.wavesurfer) AppState.wavesurfer.playPause(); DOMElements.clickSound.play().catch(()=>{}); });
    rewindBtn.addEventListener("click", () => { if (!rewindBtn.disabled && AppState.wavesurfer) AppState.wavesurfer.skip(-3); });
    forwardBtn.addEventListener("click", () => { if (!forwardBtn.disabled && AppState.wavesurfer) AppState.wavesurfer.skip(3); });
    deleteBtn.addEventListener("click", () => { if (!deleteBtn.disabled) deleteRecording(); });
    insertModeBtn.addEventListener("click", () => { if (!insertModeBtn.disabled) setEditMode("insert"); });
    overwriteModeBtn.addEventListener("click", () => { if (!overwriteModeBtn.disabled) setEditMode("overwrite"); });
}

function setupActionListeners() {
    DOMElements.processBtn.addEventListener("click", processAndSendAudio);
    DOMElements.newSessionBtn.addEventListener("click", resetToStart);
    DOMElements.copyBtn.addEventListener("click", copyFormattedText);
    DOMElements.saveBtn.addEventListener("click", saveTextToFile);
}

function setupKeyboardShortcuts() {
    document.addEventListener("keydown", (e) => {
        if (["INPUT", "TEXTAREA"].includes(e.target.tagName)) return;
        if (e.code === "Space" && AppState.wavesurfer && AppState.wavesurfer.getDuration() > 0 && !AppState.isRecording) { e.preventDefault(); AppState.wavesurfer.playPause(); }
        if (e.code === "KeyR" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); toggleRecording(); }
        if (e.code === "KeyS" && !e.metaKey && !e.ctrlKey) { e.preventDefault(); stopRecording(); }
    });
}

// --- UI State Management ---
export function updateRecorderUI() {
    const { recordBtn, stopBtn, playBtn, rewindBtn, forwardBtn, deleteBtn, insertModeBtn, overwriteModeBtn } = DOMElements;
    const hasRecording = AppState.wavesurfer && AppState.wavesurfer.getDuration() > 0;
    recordBtn.disabled = false;
    stopBtn.disabled = !AppState.isRecording && !AppState.isPaused;
    playBtn.disabled = AppState.isRecording || !hasRecording;
    rewindBtn.disabled = AppState.isRecording || !hasRecording;
    forwardBtn.disabled = AppState.isRecording || !hasRecording;
    deleteBtn.disabled = AppState.isRecording || !hasRecording;
    insertModeBtn.disabled = AppState.isRecording;
    overwriteModeBtn.disabled = AppState.isRecording;

    if (AppState.isRecording) {
        recordBtn.textContent = "⏸️"; recordBtn.classList.add("recording");
    } else {
        recordBtn.textContent = "🎤"; recordBtn.classList.remove("recording");
    }
}

export function updateUIForConnection(isConnected) {
    const { connectionStatus, processBtn } = DOMElements;
    connectionStatus.textContent = isConnected ? "Connecté" : "Déconnecté";
    connectionStatus.style.color = isConnected ? "var(--success-color)" : "var(--error-color)";
    processBtn.disabled = !isConnected || !AppState.currentFile;
}

export function showProgress(message) { DOMElements.progressLabel.textContent = message; DOMElements.progressLabel.style.display = "block"; }
export function hideProgress() { DOMElements.progressLabel.style.display = "none"; }
export function toggleSections(showResult) { DOMElements.resultSection.style.display = showResult ? "block" : "none"; DOMElements.processingContainer.style.display = showResult ? "none" : "block"; }

export function resetToStart() {
    toggleSections(false);
    AppState.currentFile = null;
    AppState.transcribedText = "";
    AppState.originalBuffer = null;
    AppState.audioChunks = [];
    DOMElements.fileLabel.textContent = "";
    DOMElements.resultText.innerHTML = "";
    DOMElements.fileInput.value = "";
    if (AppState.wavesurfer) AppState.wavesurfer.empty();
    updateProgressBar(0, 0);
    updateRecorderUI();
    DOMElements.processBtn.disabled = true;
}

export function resetUIafterProcessing(success) {
    const { processBtn } = DOMElements;
    processBtn.disabled = false;
    processBtn.textContent = "Transcrire et Formater";
    if (!success) {
        hideProgress();
        updateUIForConnection(AppState.socket?.readyState === WebSocket.OPEN);
    }
}

// --- File Handling ---
function handleFileSelect(file) {
    try {
        validateFile(file);
        AppState.currentFile = file;
        DOMElements.fileLabel.textContent = `Sélectionné : ${file.name}`;
        if (AppState.wavesurfer) { AppState.wavesurfer.load(URL.createObjectURL(file)); }
        hideErrorMessage();
    } catch (e) {
        handleError(ERROR_TYPES.FILE, "File validation failed", e);
        AppState.currentFile = null;
    } finally {
        updateUIForConnection(AppState.socket?.readyState === WebSocket.OPEN);
    }
}

function validateFile(file) {
    if (!file) throw { type: "format", message: "No file provided" };
    if (file.size > CONFIG.MAX_FILE_SIZE) throw { type: "size" };
    const name = (file.name || "").toLowerCase();
    const isSupported = CONFIG.SUPPORTED_AUDIO_TYPES.some(type => file.type === type) ||
        [".wav", ".mp3", ".m4a", ".ogg", ".webm"].some(ext => name.endsWith(ext));
    if (!isSupported) throw { type: "format" };
    return true;
}

// --- Progress Bar (UX Improved) ---
function initializeProgressBar() {
    const { voiceProgressBar, voiceProgressHandle } = DOMElements;
    const addListener = (el, events, handler) => events.forEach(e => el.addEventListener(e, handler, { passive: false }));

    addListener(voiceProgressBar, ["mousedown", "touchstart"], handleProgressBarInteraction);
    addListener(voiceProgressHandle, ["mousedown", "touchstart"], handleProgressDragStart);
    addListener(document, ["mousemove", "touchmove"], handleProgressDragMove);
    addListener(document, ["mouseup", "touchend"], handleProgressDragEnd);
}

function getClientX(e) { return e.touches ? e.touches[0].clientX : e.clientX; }

function handleProgressBarInteraction(e) {
    if (AppState.isDraggingProgress) return;
    updateSeekPosition(e);
}

function handleProgressDragStart(e) {
    e.preventDefault(); e.stopPropagation();
    AppState.isDraggingProgress = true;
    DOMElements.voiceProgressHandle.classList.add("dragging");
    if (AppState.wavesurfer && AppState.wavesurfer.isPlaying()) AppState.wavesurfer.pause();
}

function handleProgressDragMove(e) {
    if (!AppState.isDraggingProgress) return;
    e.preventDefault();
    updateSeekPosition(e, false); // Only update visuals, don't seek yet
}

function handleProgressDragEnd(e) {
    if (!AppState.isDraggingProgress) return;
    e.preventDefault();
    updateSeekPosition(e, true); // Final update and actual seek
    AppState.isDraggingProgress = false;
    DOMElements.voiceProgressHandle.classList.remove("dragging");
}

function updateSeekPosition(e, doSeek = true) {
    if (!AppState.wavesurfer || AppState.wavesurfer.getDuration() === 0) return;
    const rect = DOMElements.voiceProgressBar.getBoundingClientRect();
    const clientX = getClientX(e);
    let pct = ((clientX - rect.left) / rect.width) * 100;
    pct = Math.max(0, Math.min(100, pct));
    
    const newTime = (pct / 100) * AppState.wavesurfer.getDuration();
    updateProgressBar(newTime, AppState.wavesurfer.getDuration());

    if (doSeek) {
        AppState.wavesurfer.seekTo(pct / 100);
    }
}

export function updateProgressBar(currentTime, duration) {
    if (isNaN(duration) || duration <= 0) { duration = 0; currentTime = 0; }
    const pct = (currentTime / duration) * 100;
    DOMElements.voiceProgressFill.style.width = `${pct}%`;
    DOMElements.voiceProgressHandle.style.left = `${pct}%`;
    DOMElements.currentTimeLabel.textContent = formatTime(currentTime);
    DOMElements.totalTimeLabel.textContent = formatTime(duration);
    DOMElements.timeline.textContent = `${formatTime(currentTime)} / ${formatTime(duration)}`;
}

// --- Action Handlers & Formatting ---
function deleteRecording() {
    if (confirm("Êtes-vous sûr de vouloir effacer l'enregistrement?")) {
        AppState.currentFile = null;
        AppState.originalBuffer = null;
        AppState.audioChunks = [];
        if (AppState.wavesurfer) AppState.wavesurfer.empty();
        updateProgressBar(0, 0);
        updateRecorderUI();
        updateUIForConnection(AppState.socket?.readyState === WebSocket.OPEN);
        showNotification("Enregistrement effacé");
    }
}

function setEditMode(mode) {
    if (mode === AppState.editMode) return;
    AppState.editMode = mode;
    DOMElements.insertModeBtn.classList.toggle("active", mode === "insert");
    DOMElements.overwriteModeBtn.classList.toggle("active", mode === "overwrite");
    showNotification(mode === "insert" ? "Mode: Insérer" : "Mode: Écraser");
    DOMElements.clickSound.play().catch(()=>{});
}

function copyFormattedText() {
    const plain = DOMElements.resultText.innerText;
    navigator.clipboard.writeText(plain).then(() => {
        showNotification("Rapport copié !");
    }).catch(() => {
        showNotification("Échec de la copie", "error");
    });
}

function saveTextToFile() {
    const text = DOMElements.resultText.innerText;
    if (!text) { showNotification("Aucun texte à sauvegarder", "error"); return; }
    const ts = new Date().toISOString().replace(/[:.]/g, "-").slice(0, -5);
    const filename = `rapport_medivox_${ts}.txt`;
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(a.href);
    showNotification("Fichier sauvegardé !");
}

export function formatTextAsHtml(text) {
    if (!text) return "";
    const lines = text.split("\n");
    return lines.map(line => {
        let s = line.trim().replace(/\*\*(.*?)\*\*/g, `<strong>$1</strong>`);
        if (!s.includes("<strong>") && s.length > 0 && s === s.toUpperCase()) {
            s = `<strong>${s}</strong>`;
        }
        return s;
    }).join("<br>");
}


// --- Error Handling & Notifications ---
export function handleError(type, message, error = null) {
    console.error(`[${type.toUpperCase()}] ${message}:`, error);
    let userMessage = message; let severity = "error";
    if (type === ERROR_TYPES.CONNECTION) { userMessage = `Erreur de connexion. Tentative de reconnexion...`; severity = AppState.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS ? "warning" : "error"; }
    if (type === ERROR_TYPES.AUDIO && error) { userMessage = { NotAllowedError: "Permission d'accès au microphone refusée", NotFoundError: "Aucun microphone détecté" }[error.name] || `Erreur audio: ${error.message}`; }
    if (type === ERROR_TYPES.FILE && error) { userMessage = { size: `Fichier trop volumineux (max ${CONFIG.MAX_FILE_SIZE / (1024 * 1024)}MB)`, format: "Format de fichier non supporté" }[error.type] || `Erreur de fichier.`; }
    if (type === ERROR_TYPES.PERMISSION) { userMessage = "Veuillez autoriser l'accès au microphone."; }
    
    showErrorMessage(userMessage, severity);

    if (type === ERROR_TYPES.CONNECTION && AppState.reconnectAttempts < CONFIG.MAX_RECONNECT_ATTEMPTS) {
        setTimeout(connectWebSocket, CONFIG.RECONNECT_DELAY);
    }
}

function showErrorMessage(message, severity = "error") {
    const { errorMessage } = DOMElements;
    errorMessage.textContent = message;
    errorMessage.className = `error-message ${severity}`;
    errorMessage.style.display = "block";
    if (severity === "warning") setTimeout(hideErrorMessage, 10000);
}

function hideErrorMessage() { DOMElements.errorMessage.style.display = "none"; }

function showNotification(message, type = "success") {
    const n = document.createElement("div");
    n.textContent = message;
    n.style.cssText = `position:fixed;top:20px;right:20px;padding:12px 20px;background-color:var(--${type}-color);color:white;border-radius:4px;z-index:1000;`;
    document.body.appendChild(n);
    setTimeout(() => { document.body.removeChild(n); }, 3000);
}

function formatTime(time) {
    if (!time || isNaN(time)) time = 0;
    const m = Math.floor(time / 60);
    const s = Math.floor(time % 60);
    const d = Math.floor((time % 1) * 10);
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}.${d}`;
}
