import { Notice, TFile, normalizePath } from "obsidian";
import type { BoardView } from "./board-view";
import { Item, newId } from "./types";

/** save a binary blob into the board's assets folder, returning the created file */
async function saveAssetBinary(view: BoardView, filename: string, buf: ArrayBuffer): Promise<TFile> {
  const folder = view.file?.parent?.path && view.file.parent.path !== "/"
    ? view.file.parent.path + "/assets"
    : "assets";
  const base = normalizePath(folder);
  if (!view.app.vault.getAbstractFileByPath(base)) {
    await view.app.vault.createFolder(base).catch(() => {});
  }
  const safe = filename.replace(/[\\/:*?"<>|]/g, "-") || "recording.webm";
  let path = normalizePath(`${base}/${safe}`);
  let i = 1;
  const dot = safe.lastIndexOf(".");
  const stem = dot > 0 ? safe.slice(0, dot) : safe;
  const ext = dot > 0 ? safe.slice(dot) : "";
  while (view.app.vault.getAbstractFileByPath(path)) {
    path = normalizePath(`${base}/${stem}-${i++}${ext}`);
  }
  return view.app.vault.createBinary(path, buf);
}

/** popup recorder for a record card: pick mic, record, save as vault audio file */
export function openRecordPopup(view: BoardView, it: Item) {
  view.closePreview();
  const ov = view.contentEl.createDiv({ cls: "mgn-preview" });
  const panel = ov.createDiv({ cls: "mgn-preview-panel mgn-record-panel" });
  const head = panel.createDiv({ cls: "mgn-preview-head" });
  head.createDiv({ cls: "mgn-preview-crumbs" }).createSpan({ cls: "mgn-crumb-current", text: "Record" });
  const body = panel.createDiv({ cls: "mgn-preview-body mgn-record-body" });

  const micRow = body.createDiv({ cls: "mgn-record-mic-row" });
  micRow.createSpan({ text: "Microphone: " });
  const micSelect = micRow.createEl("select", { cls: "dropdown" });

  const status = body.createDiv({ cls: "mgn-record-status", text: "Ready" });
  const viz = body.createEl("canvas", { cls: "mgn-record-viz", attr: { width: "280", height: "56" } });
  const vizCtx = viz.getContext("2d");
  const timer = body.createDiv({ cls: "mgn-record-timer", text: "00:00" });
  let existingAudio: HTMLAudioElement | null = null;
  if (it.path) {
    const f = view.resolveFile(it.path);
    if (f) {
      existingAudio = body.createEl("audio", { attr: { controls: "true" } });
      existingAudio.src = view.app.vault.getResourcePath(f as TFile);
    }
  }

  const btnRow = body.createDiv({ cls: "mgn-record-btn-row" });
  const recordBtn = btnRow.createEl("button", { text: it.path ? "Record again" : "Record" });
  const stopBtn = btnRow.createEl("button", { text: "Stop" });
  stopBtn.disabled = true;

  let stream: MediaStream | null = null;
  let recorder: MediaRecorder | null = null;
  let chunks: BlobPart[] = [];
  let startedAt = 0;
  let timerHandle: number | undefined;
  let newBlob: Blob | null = null;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let vizFrame: number | undefined;

  const stopTimer = () => { if (timerHandle) window.clearInterval(timerHandle); timerHandle = undefined; };
  const stopStream = () => { stream?.getTracks().forEach((t) => t.stop()); stream = null; };
  const stopViz = () => {
    if (vizFrame) cancelAnimationFrame(vizFrame);
    vizFrame = undefined;
    audioCtx?.close();
    audioCtx = null;
    analyser = null;
    vizCtx?.clearRect(0, 0, viz.width, viz.height);
  };
  const drawViz = () => {
    if (!analyser || !vizCtx) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    vizCtx.clearRect(0, 0, viz.width, viz.height);
    const barCount = 32;
    const step = Math.floor(data.length / barCount);
    const barW = viz.width / barCount;
    const style = getComputedStyle(viz);
    vizCtx.fillStyle = style.color || "#888";
    for (let i = 0; i < barCount; i++) {
      // deviation from silence (128) across this bar's slice, as a 0..1 level
      let peak = 0;
      for (let j = 0; j < step; j++) {
        peak = Math.max(peak, Math.abs(data[i * step + j] - 128) / 128);
      }
      const h = Math.max(2, peak * viz.height);
      vizCtx.fillRect(i * barW + 1, (viz.height - h) / 2, barW - 2, h);
    }
    vizFrame = requestAnimationFrame(drawViz);
  };

  const populateMics = async () => {
    micSelect.empty();
    const devices = await navigator.mediaDevices.enumerateDevices();
    const mics = devices.filter((d) => d.kind === "audioinput");
    for (const d of mics) {
      micSelect.createEl("option", { value: d.deviceId, text: d.label || "Microphone" });
    }
    const preferred = view.plugin.settings.defaultMicId;
    if (preferred && mics.some((d) => d.deviceId === preferred)) micSelect.value = preferred;
  };
  populateMics().catch(() => { status.setText("Could not list microphones"); });

  const finish = () => {
    stopTimer();
    stopViz();
    stopStream();
    recorder?.stop();
    recorder = null;
    document.removeEventListener("keydown", keyHandler, true);
    ov.remove();
  };
  const keyHandler = (e: KeyboardEvent) => {
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); finish(); }
  };
  document.addEventListener("keydown", keyHandler, true);
  ov.addEventListener("pointerdown", (e) => { if (e.target === ov) finish(); });

  recordBtn.addEventListener("click", async () => {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: micSelect.value ? { deviceId: { exact: micSelect.value } } : true,
      });
    } catch {
      status.setText("Microphone access denied");
      return;
    }
    chunks = [];
    recorder = new MediaRecorder(stream);
    recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };
    recorder.onstop = async () => {
      newBlob = new Blob(chunks, { type: "audio/webm" });
      const buf = await newBlob.arrayBuffer();
      const tf = await saveAssetBinary(view, "recording.webm", buf);
      it.path = tf.path;
      it.duration = Math.round((Date.now() - startedAt) / 1000);
      view.commit(false);
      view.rerenderItem(it);
      status.setText("Saved");
      finish();
    };
    recorder.start();
    startedAt = Date.now();
    status.setText("Recording…");
    recordBtn.disabled = true;
    stopBtn.disabled = false;

    audioCtx = new AudioContext();
    analyser = audioCtx.createAnalyser();
    analyser.fftSize = 256;
    audioCtx.createMediaStreamSource(stream).connect(analyser);
    drawViz();
    timerHandle = window.setInterval(() => {
      const s = Math.floor((Date.now() - startedAt) / 1000);
      timer.setText(`${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`);
    }, 250);
  });

  stopBtn.addEventListener("click", () => {
    stopTimer();
    stopViz();
    stopStream();
    recorder?.stop();
    recordBtn.disabled = false;
    stopBtn.disabled = true;
  });
}

/** transcribe a record card's audio via the OpenAI Whisper API, dropping the
 * result into a new note card connected back to the recording */
export async function transcribeRecord(view: BoardView, it: Item) {
  const apiKey = view.plugin.getOpenAiApiKey();
  if (!apiKey) {
    new Notice("Set an OpenAI API key in Settings → Recording first");
    return;
  }
  const f = view.resolveFile(it.path);
  if (!f) {
    new Notice("Recording file not found");
    return;
  }
  new Notice("Transcribing...");
  let text: string;
  try {
    const buf = await view.app.vault.readBinary(f);
    const form = new FormData();
    form.append("file", new Blob([buf], { type: "audio/webm" }), f.name);
    form.append("model", "whisper-1");
    const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
    if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
    const data = await res.json();
    text = (data.text ?? "").trim();
  } catch (err) {
    new Notice(`Transcription failed: ${err instanceof Error ? err.message : err}`);
    return;
  }
  if (!text) {
    new Notice("Transcription returned no text");
    return;
  }
  const note = view.addItem({ type: "note", text, w: view.plugin.settings.defaultNoteWidth }, it.x + it.w + 60, it.y);
  view.board.edges.push({ id: newId(), from: it.id, to: note.id, arrow: true, mode: "free" });
  view.commit();
}
