import { Capacitor } from "@capacitor/core";
import {
  Directory,
  Encoding,
  Filesystem,
} from "@capacitor/filesystem";
import type { AnalysisResult } from "@/lib/analysis";

export type Observation = {
  id: string;
  date: string;
  createdAt: string;
  imageUrl: string;
  imagePath?: string;
  originalName: string;
  sizeMm?: number;
  analysis: AnalysisResult;
};

export type Lesion = {
  id: string;
  name: string;
  location: string;
  notes: string;
  reminderDays: number;
  createdAt: string;
  observations: Observation[];
};

export type NewLesion = {
  name: string;
  location: string;
  notes: string;
  reminderDays: number;
};

export type NewObservation = {
  date: string;
  sizeMm?: number;
  fileName: string;
  dataUrl: string;
  analysis: AnalysisResult;
};

type StoredObservation = Omit<Observation, "imageUrl"> & {
  imagePath: string;
};

type StoredLesion = Omit<Lesion, "observations"> & {
  observations: StoredObservation[];
};

type NativeStore = {
  version: 1;
  lesions: StoredLesion[];
};

const INDEX_PATH = "dermwatch/index.json";
const isNative = Capacitor.isNativePlatform();

function resolveApiUrl() {
  const fallback = "http://127.0.0.1:8788";
  if (typeof window === "undefined") return fallback;

  const candidate = new URLSearchParams(window.location.search).get("api");
  if (!candidate) return fallback;

  try {
    const url = new URL(candidate);
    const isLoopback =
      url.protocol === "http:" &&
      (url.hostname === "127.0.0.1" || url.hostname === "localhost");
    return isLoopback ? url.origin : fallback;
  } catch {
    return fallback;
  }
}

const API_URL = resolveApiUrl();

function resolveImageUrl(imageUrl: string) {
  return isNative ? imageUrl : `${API_URL}${imageUrl}`;
}

function cleanText(value: unknown, maxLength: number) {
  return String(value || "").trim().slice(0, maxLength);
}

function dataUrlParts(dataUrl: string) {
  const match = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=\r\n]+)$/.exec(
    dataUrl,
  );
  if (!match) throw new Error("Unsupported image data");
  const extension = match[1] === "jpeg" ? "jpg" : match[1];
  return { base64: match[2], extension, mime: `image/${match[1]}` };
}

function mimeFromPath(filePath: string) {
  if (filePath.endsWith(".png")) return "image/png";
  if (filePath.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

async function apiRequest<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}${pathname}`, init);
  if (!response.ok) throw new Error(`Local storage error: ${response.status}`);
  return (await response.json()) as T;
}

async function readNativeStore(): Promise<NativeStore> {
  try {
    const result = await Filesystem.readFile({
      path: INDEX_PATH,
      directory: Directory.Data,
      encoding: Encoding.UTF8,
    });
    const parsed = JSON.parse(String(result.data)) as Partial<NativeStore>;
    return {
      version: 1,
      lesions: Array.isArray(parsed.lesions) ? parsed.lesions : [],
    };
  } catch {
    return { version: 1, lesions: [] };
  }
}

async function writeNativeStore(store: NativeStore) {
  await Filesystem.writeFile({
    path: INDEX_PATH,
    directory: Directory.Data,
    data: JSON.stringify(store),
    encoding: Encoding.UTF8,
    recursive: true,
  });
}

async function hydrateObservation(
  observation: StoredObservation,
): Promise<Observation> {
  const result = await Filesystem.getUri({
    path: observation.imagePath,
    directory: Directory.Data,
  });
  return {
    ...observation,
    imageUrl: Capacitor.convertFileSrc(result.uri),
  };
}

async function hydrateLesion(lesion: StoredLesion): Promise<Lesion> {
  return {
    ...lesion,
    observations: await Promise.all(lesion.observations.map(hydrateObservation)),
  };
}

async function getRecords(): Promise<{ lesions: Lesion[] }> {
  if (!isNative) return apiRequest<{ lesions: Lesion[] }>("/api/records");
  const store = await readNativeStore();
  return { lesions: await Promise.all(store.lesions.map(hydrateLesion)) };
}

async function createLesion(input: NewLesion): Promise<Lesion> {
  if (!isNative) {
    return apiRequest<Lesion>("/api/lesions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  const name = cleanText(input.name, 80);
  const location = cleanText(input.location, 100);
  if (!name || !location) throw new Error("Name and location are required");
  const lesion: StoredLesion = {
    id: crypto.randomUUID(),
    name,
    location,
    notes: cleanText(input.notes, 600),
    reminderDays: Math.min(365, Math.max(7, Number(input.reminderDays) || 30)),
    createdAt: new Date().toISOString(),
    observations: [],
  };
  const store = await readNativeStore();
  store.lesions.unshift(lesion);
  await writeNativeStore(store);
  return hydrateLesion(lesion);
}

async function addObservation(
  lesionId: string,
  input: NewObservation,
): Promise<Observation> {
  if (!isNative) {
    return apiRequest<Observation>(`/api/lesions/${lesionId}/observations`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });
  }

  const store = await readNativeStore();
  const lesion = store.lesions.find((item) => item.id === lesionId);
  if (!lesion) throw new Error("Record not found");
  const { base64, extension } = dataUrlParts(input.dataUrl);
  const observationId = crypto.randomUUID();
  const imagePath = `dermwatch/images/${lesionId}/${observationId}.${extension}`;
  await Filesystem.writeFile({
    path: imagePath,
    directory: Directory.Data,
    data: base64,
    recursive: true,
  });
  const numericSize = Number(input.sizeMm);
  const observation: StoredObservation = {
    id: observationId,
    date: /^\d{4}-\d{2}-\d{2}$/.test(input.date)
      ? input.date
      : new Date().toISOString().slice(0, 10),
    createdAt: new Date().toISOString(),
    imagePath,
    originalName: cleanText(input.fileName, 180),
    ...(Number.isFinite(numericSize) && numericSize > 0
      ? { sizeMm: Math.min(100, numericSize) }
      : {}),
    analysis: input.analysis,
  };
  lesion.observations.push(observation);
  lesion.observations.sort((a, b) => a.date.localeCompare(b.date));
  await writeNativeStore(store);
  return hydrateObservation(observation);
}

async function updateAnalysis(
  lesionId: string,
  observationId: string,
  analysis: AnalysisResult,
) {
  if (!isNative) {
    await apiRequest(`/api/lesions/${lesionId}/observations/${observationId}/analysis`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ analysis }),
    });
    return;
  }
  const store = await readNativeStore();
  const observation = store.lesions
    .find((item) => item.id === lesionId)
    ?.observations.find((item) => item.id === observationId);
  if (!observation) throw new Error("Observation not found");
  observation.analysis = analysis;
  await writeNativeStore(store);
}

async function readObservationFile(observation: Observation): Promise<File> {
  if (!isNative) {
    const response = await fetch(`${API_URL}${observation.imageUrl}`);
    if (!response.ok) throw new Error("Image not found");
    const blob = await response.blob();
    return new File([blob], observation.originalName || "image.jpg", {
      type: blob.type || "image/jpeg",
    });
  }
  if (!observation.imagePath) throw new Error("Image path is missing");
  const result = await Filesystem.readFile({
    path: observation.imagePath,
    directory: Directory.Data,
  });
  const dataUrl = `data:${mimeFromPath(observation.imagePath)};base64,${String(result.data)}`;
  const blob = await fetch(dataUrl).then((response) => response.blob());
  return new File([blob], observation.originalName || "image.jpg", {
    type: blob.type,
  });
}

async function deleteLesion(lesionId: string) {
  if (!isNative) {
    await apiRequest(`/api/lesions/${lesionId}`, { method: "DELETE" });
    return;
  }
  const store = await readNativeStore();
  const before = store.lesions.length;
  store.lesions = store.lesions.filter((item) => item.id !== lesionId);
  if (store.lesions.length === before) throw new Error("Record not found");
  await writeNativeStore(store);
  try {
    await Filesystem.rmdir({
      path: `dermwatch/images/${lesionId}`,
      directory: Directory.Data,
      recursive: true,
    });
  } catch {
    // The record may not have any images yet.
  }
}

async function splitObservation(
  lesionId: string,
  observationId: string,
): Promise<Lesion> {
  if (!isNative) {
    return apiRequest<Lesion>(
      `/api/lesions/${lesionId}/observations/${observationId}/split`,
      { method: "POST" },
    );
  }
  const store = await readNativeStore();
  const lesion = store.lesions.find((item) => item.id === lesionId);
  const observationIndex = lesion?.observations.findIndex(
    (item) => item.id === observationId,
  );
  if (!lesion || observationIndex === undefined || observationIndex < 0) {
    throw new Error("Observation not found");
  }
  const observation = lesion.observations[observationIndex];
  const newLesionId = crypto.randomUUID();
  const extension = observation.imagePath.split(".").pop() || "jpg";
  const newPath = `dermwatch/images/${newLesionId}/${observation.id}.${extension}`;
  await Filesystem.mkdir({
    path: `dermwatch/images/${newLesionId}`,
    directory: Directory.Data,
    recursive: true,
  });
  await Filesystem.rename({
    from: observation.imagePath,
    to: newPath,
    directory: Directory.Data,
  });
  lesion.observations.splice(observationIndex, 1);
  const newLesion: StoredLesion = {
    id: newLesionId,
    name: `${lesion.name} — separate`,
    location: lesion.location,
    notes: "Created from a photo that did not match the previous mole.",
    reminderDays: lesion.reminderDays,
    createdAt: new Date().toISOString(),
    observations: [{ ...observation, imagePath: newPath }],
  };
  store.lesions.unshift(newLesion);
  await writeNativeStore(store);
  return hydrateLesion(newLesion);
}

export const storageClient = {
  isNative,
  resolveImageUrl,
  getRecords,
  createLesion,
  addObservation,
  updateAnalysis,
  readObservationFile,
  deleteLesion,
  splitObservation,
};
