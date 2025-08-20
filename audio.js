import { CONFIG, ERROR_TYPES } from './config.js';
import AppState from './state.js';
import { handleError, updateRecorderUI, updateProgressBar, showProgress, resetUIafterProcessing } from './ui.js';
import { sendFileToServer } from './websocket.js';

// --- Wavesurfer Initialization ---
export function initializeWavesurfer() {
    try {
        const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
        const isIOS = /ipad|iphone|ipod/.test(navigator.userAgent.toLowerCase()) && !window.MSStream;

        AppState.wavesurfer = WaveSurfer.create({
            container: "#waveform",
            waveColor: "rgb(200, 200, 200)", progressColor: "rgb(100, 100, 200)",
            barWidth: 2, barGap: 1, barRadius: 2,
            cursorWidth: 2, cursorColor: "#4a9eff",
            height: 128, normalize: true, responsive: true, interact: true,
            backend: isSafari || isIOS ? "MediaElement" : "WebAudio",
        });

        AppState.wavesurfer.on("audioprocess", () => { if (!AppState.isDraggingProgress) updateProgressBar(AppState.wavesurfer.getCurrentTime(), AppState.wavesurfer.getDuration()); });
        AppState.wavesurfer.on("seek", () => { if (!AppState.isDraggingProgress) updateProgressBar(AppState.wavesurfer.getCurrentTime(), AppState.wavesurfer.getDuration()); });
        AppState.wavesurfer.on("play", () => { document.getElementById('playBtn').textContent = "⏸️ Pause"; startProgressAnimation(); });
        AppState.wavesurfer.on("pause", () => { document.getElementById('playBtn').textContent = "▶️ Play"; stopProgressAnimation(); });
        AppState.wavesurfer.on("finish", () => { document.getElementById('playBtn').textContent = "▶️ Play"; stopProgressAnimation(); updateProgressBar(AppState.wavesurfer.getDuration(), AppState.wavesurfer.getDuration()); });
        AppState.wavesurfer.on("ready", () => {
            if (AppState.wavesurfer.backend && AppState.wavesurfer.backend.buffer) { AppState.originalBuffer = AppState.wavesurfer.backend.buffer; } 
            else { AppState.originalBuffer = null; }
            updateRecorderUI();
            updateProgressBar(0, AppState.wavesurfer.getDuration());
        });
        AppState.wavesurfer.on("error", (e) => handleError(ERROR_TYPES.AUDIO, "Waveform error", e));
    } catch (e) {
        handleError(ERROR_TYPES.AUDIO, "Failed to initialize waveform", e);
    }
}

// --- Recording Control ---
export async function toggleRecording() {
    try {
        if (AppState.isRecording) { pauseRecording(); } 
        else if (AppState.isPaused) { resumeRecording(); } 
        else { await startRecording(); }
        updateRecorderUI();
    } catch (e) {
        handleError(ERROR_TYPES.AUDIO, "Recording toggle failed", e);
        resetRecordingState();
    }
}

function pauseRecording() {
    if (AppState.mediaRecorder && AppState.mediaRecorder.state === "recording") {
        AppState.mediaRecorder.pause();
        AppState.isPaused = true;
        AppState.isRecording = false;
        stopRecordingTimer();
    }
}

function resumeRecording() {
    if (AppState.mediaRecorder && AppState.mediaRecorder.state === "paused") {
        AppState.mediaRecorder.resume();
        AppState.isPaused = false;
        AppState.isRecording = true;
        startRecordingTimer();
    }
}

async function startRecording() {
    try {
        const audioConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
        AppState.stream = await navigator.mediaDevices.getUserMedia({ audio: audioConstraints })
            .catch(async () => await navigator.mediaDevices.getUserMedia({ audio: true }));
        
        AppState.mediaRecorder = createMediaRecorder(AppState.stream);
        AppState.audioChunks = [];
        AppState.mediaRecorder.start(250);
        AppState.isRecording = true;
        AppState.isPaused = false;
        AppState.recordStartMs = Date.now() - (AppState.wavesurfer ? AppState.wavesurfer.getCurrentTime() * 1000 : 0);
        startRecordingTimer();
        document.getElementById('start-sound').play().catch(() => {});
    } catch (e) {
        if (["NotAllowedError", "PermissionDeniedError"].includes(e.name)) { handleError(ERROR_TYPES.PERMISSION, "Microphone access denied", e); }
        else { handleError(ERROR_TYPES.AUDIO, "Failed to start recording", e); }
        resetRecordingState();
    }
}

export function stopRecording() {
    try {
        if (AppState.mediaRecorder && (AppState.mediaRecorder.state === "recording" || AppState.mediaRecorder.state === "paused")) {
            AppState.mediaRecorder.stop(); // This will trigger the 'onstop' event
            if (AppState.stream) { AppState.stream.getTracks().forEach((t) => t.stop()); AppState.stream = null; }
            AppState.isRecording = false;
            AppState.isPaused = false;
            stopRecordingTimer();
            document.getElementById('stop-sound').play().catch(() => {});
        }
    } catch (e) {
        handleError(ERROR_TYPES.AUDIO, "Failed to stop recording", e);
    } finally {
        updateRecorderUI();
    }
}

// --- Audio Processing & Editing ---
async function processFinishedRecording() {
    try {
        if (AppState.audioChunks.length === 0) throw new Error("No audio data recorded");
        
        const recordedBlob = new Blob(AppState.audioChunks, { type: AppState.mediaRecorder?.mimeType || "audio/webm" });
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const newRecordingBuffer = await ctx.decodeAudioData(await recordedBlob.arrayBuffer());

        // **CRITICAL FIX APPLIED HERE**: Editing is now done *after* recording by manipulating buffers.
        const finalBuffer = await processAudioEditing(newRecordingBuffer);

        const wavBlob = await audioBufferToWav(finalBuffer);
        if (AppState.wavesurfer) {
            const url = URL.createObjectURL(wavBlob);
            AppState.wavesurfer.load(url);
            AppState.wavesurfer.once("ready", () => URL.revokeObjectURL(url));
        }
        AppState.originalBuffer = finalBuffer;
        AppState.currentFile = new File([wavBlob], "recording.wav", { type: "audio/wav" });

    } catch (e) {
        handleError(ERROR_TYPES.AUDIO, "Failed to process recording", e);
    } finally {
        document.getElementById('processBtn').disabled = !AppState.currentFile;
        resetRecordingState();
    }
}

async function processAudioEditing(newRecordingBuffer) {
    const insertionTime = AppState.wavesurfer ? AppState.wavesurfer.getCurrentTime() : 0;
    if (!AppState.originalBuffer || insertionTime === 0 && AppState.editMode === 'overwrite') {
        return newRecordingBuffer;
    }
    
    try {
        const preSlice = sliceAudioBuffer(AppState.originalBuffer, 0, insertionTime);
        if (AppState.editMode === "insert") {
            const postSlice = sliceAudioBuffer(AppState.originalBuffer, insertionTime, AppState.originalBuffer.duration);
            return concatAudioBuffers([preSlice, newRecordingBuffer, postSlice]);
        } else { // Overwrite
            const newEnd = insertionTime + newRecordingBuffer.duration;
            if (newEnd < AppState.originalBuffer.duration) {
                const postSlice = sliceAudioBuffer(AppState.originalBuffer, newEnd, AppState.originalBuffer.duration);
                return concatAudioBuffers([preSlice, newRecordingBuffer, postSlice]);
            }
            return concatAudioBuffers([preSlice, newRecordingBuffer]);
        }
    } catch (e) {
        console.warn("Audio editing failed, using new recording only:", e);
        return newRecordingBuffer;
    }
}

export function processAndSendAudio() {
    if (!AppState.currentFile || !AppState.socket || AppState.socket.readyState !== WebSocket.OPEN) {
        handleError(ERROR_TYPES.PROCESSING, "Cannot process audio: missing file or connection");
        return;
    }
    const processBtn = document.getElementById('processBtn');
    processBtn.disabled = true;
    processBtn.textContent = "Traitement...";
    
    try {
        showProgress("Envoi de l'audio au serveur...");
        sendFileToServer();
    } catch (e) {
        handleError(ERROR_TYPES.PROCESSING, "Audio processing failed", e);
        resetUIafterProcessing(false);
    }
}

// --- Utilities & Helpers ---

function createMediaRecorder(stream) {
    const mimeTypes = ["audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];
    const selectedType = mimeTypes.find(type => MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(type)) || "";
    const options = { mimeType: selectedType, audioBitsPerSecond: 128000 };
    
    const rec = new MediaRecorder(stream, options);
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) AppState.audioChunks.push(e.data); };
    rec.onstop = () => { processFinishedRecording(); };
    rec.onerror = (ev) => { handleError(ERROR_TYPES.AUDIO, "MediaRecorder error", ev.error); resetRecordingState(); };
    return rec;
}

function resetRecordingState() {
    AppState.isRecording = false;
    AppState.isPaused = false;
    if (AppState.stream) { AppState.stream.getTracks().forEach((t) => t.stop()); AppState.stream = null; }
    AppState.mediaRecorder = null;
    stopRecordingTimer();
    updateRecorderUI();
}

function startRecordingTimer() {
    stopRecordingTimer();
    const tick = () => {
        if (!AppState.isRecording) return;
        const elapsed = (Date.now() - AppState.recordStartMs) / 1000;
        const totalDuration = AppState.originalBuffer ? AppState.originalBuffer.duration : 0;
        let currentTime = (AppState.wavesurfer ? AppState.wavesurfer.getCurrentTime() : 0) + elapsed;
        let displayDuration = Math.max(totalDuration, currentTime);
        
        updateProgressBar(currentTime, displayDuration);
        AppState.recordTimerId = requestAnimationFrame(tick);
    };
    tick();
}

function stopRecordingTimer() {
    if (AppState.recordTimerId) {
        cancelAnimationFrame(AppState.recordTimerId);
        AppState.recordTimerId = null;
    }
}

function startProgressAnimation() {
    stopProgressAnimation();
    const tick = () => {
        if (AppState.wavesurfer && AppState.wavesurfer.isPlaying()) {
            updateProgressBar(AppState.wavesurfer.getCurrentTime(), AppState.wavesurfer.getDuration());
            AppState.animationFrameId = requestAnimationFrame(tick);
        }
    };
    tick();
}

function stopProgressAnimation() {
    if (AppState.animationFrameId) {
        cancelAnimationFrame(AppState.animationFrameId);
        AppState.animationFrameId = null;
    }
}

// --- Buffer Manipulation & WAV Conversion ---
function validateAudioBuffer(buffer) { if (!buffer || !buffer.sampleRate || !buffer.numberOfChannels || buffer.length === 0) throw new Error("Invalid audio buffer"); }

function sliceAudioBuffer(buffer, start, end) {
    validateAudioBuffer(buffer);
    if (start < 0) start = 0; if (end > buffer.duration) end = buffer.duration; if (start >= end) { const ctx = new (window.AudioContext || window.webkitAudioContext)(); return ctx.createBuffer(buffer.numberOfChannels, 1, buffer.sampleRate); }
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const rate = buffer.sampleRate;
    const s = Math.round(rate * start);
    const e = Math.round(rate * end);
    const out = ctx.createBuffer(buffer.numberOfChannels, e - s, rate);
    for (let ch = 0; ch < buffer.numberOfChannels; ch++) { out.copyToChannel(buffer.getChannelData(ch).slice(s, e), ch); }
    return out;
}

function concatAudioBuffers(buffers) {
    if (!buffers || buffers.length === 0) throw new Error("No buffers to concatenate");
    buffers.forEach(validateAudioBuffer);
    const first = buffers[0];
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const totalLength = buffers.reduce((acc, b) => acc + b.length, 0);
    const out = ctx.createBuffer(first.numberOfChannels, totalLength, first.sampleRate);
    let offset = 0;
    for (const b of buffers) {
        for (let ch = 0; ch < b.numberOfChannels; ch++) {
            out.getChannelData(ch).set(b.getChannelData(ch), offset);
        }
        offset += b.length;
    }
    return out;
}

async function audioBufferToWav(buffer) {
    validateAudioBuffer(buffer);
    const targetSampleRate = CONFIG.AUDIO_CONSTRAINTS.sampleRate;
    const targetChannels = CONFIG.AUDIO_CONSTRAINTS.channels;
    let processed = buffer;
    if (buffer.sampleRate !== targetSampleRate || buffer.numberOfChannels !== targetChannels) {
        const OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        const offline = new OfflineCtx(targetChannels, Math.ceil(buffer.duration * targetSampleRate), targetSampleRate);
        const src = offline.createBufferSource();
        src.buffer = buffer;
        src.connect(offline.destination);
        src.start();
        processed = await offline.startRendering();
    }
    const pcm = processed.getChannelData(0);
    const dataView = encodePCMToInt16(pcm);
    const wavView = createWavFile(dataView, targetSampleRate, targetChannels);
    return new Blob([wavView], { type: "audio/wav" });
}

function encodePCMToInt16(samples) {
    const buf = new ArrayBuffer(samples.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < samples.length; i++) {
        let s = Math.max(-1, Math.min(1, samples[i]));
        const v = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(i * 2, Math.round(v), true);
    }
    return view;
}

function createWavFile(dataView, sampleRate, numChannels) {
    const dataLen = dataView.byteLength;
    const buffer = new ArrayBuffer(44 + dataLen);
    const view = new DataView(buffer);
    const writeString = (view, offset, str) => { for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i)); };
    writeString(view, 0, "RIFF"); view.setUint32(4, 36 + dataLen, true); writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt "); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, numChannels, true); view.setUint32(24, sampleRate, true); view.setUint32(28, sampleRate * 2 * numChannels, true); view.setUint16(32, numChannels * 2, true); view.setUint16(34, 16, true);
    writeString(view, 36, "data"); view.setUint32(40, dataLen, true);
    new Uint8Array(buffer, 44).set(new Uint8Array(dataView.buffer));
    return view;
}
