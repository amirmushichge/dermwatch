"use client";

import { ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import {
  AnalysisResult,
  ChangeResult,
  SingleImageAssessment,
  analyzeImage,
  assessSingleImage,
  compareAnalyses,
  formatPercent,
} from "@/lib/analysis";
import {
  type Lesion,
  storageClient,
} from "@/lib/storage-client";

type UploadDraft = {
  file: File;
  preview: string;
  date: string;
  sizeMm: string;
  analysis?: AnalysisResult;
  error?: string;
};

function localDate(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T12:00:00`));
}

function daysBetween(a: string, b: string) {
  return Math.round(
    Math.abs(
      new Date(`${a}T12:00:00`).getTime() -
        new Date(`${b}T12:00:00`).getTime(),
    ) /
      86_400_000,
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function factorMeterColor(value: number) {
  const intensity = Math.min(1, Math.max(0, value));
  const saturation = Math.round(42 + intensity * 43);
  const lightness = Math.round(76 - intensity * 34);
  return `hsl(5 ${saturation}% ${lightness}%)`;
}

function captureQualityHint(analysis: AnalysisResult) {
  if (analysis.segmentation.centerOffset > 0.3) {
    return "Detection missed the centered spot — use even light and avoid phone or body shadows";
  }
  if (analysis.quality.sharpness < 65) {
    return "Low sharpness — hold steady and tap the spot to focus";
  }
  if (analysis.segmentation.confidence < 55) {
    return "Spot detection is unstable — move closer without digital zoom";
  }
  return "Match the light, distance and camera angle before saving";
}

function nextCheck(lesion: Lesion) {
  const latest = [...lesion.observations].sort((a, b) =>
    b.date.localeCompare(a.date),
  )[0];
  const base = latest ? new Date(`${latest.date}T12:00:00`) : new Date();
  base.setDate(base.getDate() + lesion.reminderDays);
  return base;
}

function statusFromChange(change?: ChangeResult) {
  if (!change) {
    return { label: "Second photo needed", tone: "neutral" };
  }
  if (change.mode === "same-day-retake") {
    return { label: "Same-day retake", tone: "neutral" };
  }
  if (change.captureIssues.length > 0) {
    return { label: "Comparison unreliable", tone: "warning" };
  }
  if (change.identity === "different") {
    return { label: "Likely a different mole", tone: "danger" };
  }
  if (change.identity === "uncertain") {
    return { label: "Identity not confirmed", tone: "warning" };
  }
  if (change.reliability === "low") {
    return { label: "Comparison unreliable", tone: "warning" };
  }
  if (change.level === "stable") {
    return { label: "Visually stable", tone: "good" };
  }
  if (change.level === "noticeable") {
    return { label: "Changes detected", tone: "warning" };
  }
  return { label: "Significant changes", tone: "danger" };
}

function statusFromAssessment(assessment?: SingleImageAssessment) {
  if (!assessment) {
    return { label: "First photo needed", tone: "neutral" };
  }
  if (assessment.level === "retake") {
    return { label: "Retake photo", tone: "warning" };
  }
  if (assessment.level === "attention") {
    return { label: "Photo measurements elevated", tone: "warning" };
  }
  return {
    label: "Baseline recorded",
    tone: "good",
  };
}

export default function Home() {
  const [lesions, setLesions] = useState<Lesion[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [serviceOnline, setServiceOnline] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState("");
  const [showNewLesion, setShowNewLesion] = useState(false);
  const [showUpload, setShowUpload] = useState(false);
  const [showPrivacy, setShowPrivacy] = useState(false);
  const [showBackup, setShowBackup] = useState(false);
  const [backupBusy, setBackupBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [newLesion, setNewLesion] = useState({
    name: "",
    location: "",
    notes: "",
    reminderDays: 30,
  });
  const [uploadTarget, setUploadTarget] = useState("");
  const [drafts, setDrafts] = useState<UploadDraft[]>([]);
  const [now] = useState(() => Date.now());
  const analysisUpgradeActive = useRef(false);

  async function refresh() {
    try {
      const payload = await storageClient.getRecords();
      setLesions(payload.lesions);
      setSelectedId((current) => current || payload.lesions[0]?.id || "");
      setUploadTarget((current) => current || payload.lesions[0]?.id || "");
      setServiceOnline(true);
    } catch {
      setServiceOnline(false);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => void refresh(), 0);
    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    const pending = lesions.flatMap((lesion) =>
      lesion.observations
        .filter(
          (observation) =>
            observation.analysis.version < 2 ||
            !observation.analysis.appearance,
        )
        .map((observation) => ({ lesion, observation })),
    );
    if (
      !serviceOnline ||
      !pending.length ||
      analysisUpgradeActive.current
    ) {
      return;
    }

    analysisUpgradeActive.current = true;
    void (async () => {
      try {
        for (const { lesion, observation } of pending) {
          const file = await storageClient.readObservationFile(observation);
          const analysis = await analyzeImage(file);
          await storageClient.updateAnalysis(
            lesion.id,
            observation.id,
            analysis,
          );
        }
        await refresh();
      } finally {
        analysisUpgradeActive.current = false;
      }
    })();
  }, [lesions, serviceOnline]);

  const selected = useMemo(
    () => lesions.find((item) => item.id === selectedId) || lesions[0],
    [lesions, selectedId],
  );

  const orderedObservations = useMemo(
    () =>
      selected
        ? [...selected.observations].sort((a, b) =>
            a.date.localeCompare(b.date),
          )
        : [],
    [selected],
  );

  const latestComparison = useMemo(() => {
    if (orderedObservations.length < 2) return undefined;
    const previous = orderedObservations.at(-2)!;
    const latest = orderedObservations.at(-1)!;
    return compareAnalyses(
      previous.analysis,
      latest.analysis,
      previous.sizeMm,
      latest.sizeMm,
      daysBetween(previous.date, latest.date),
    );
  }, [orderedObservations]);

  const latestObservation = orderedObservations.at(-1);
  const latestAssessment = latestObservation
    ? assessSingleImage(latestObservation.analysis, latestObservation.sizeMm)
    : undefined;
  const currentStatus = latestComparison
    ? statusFromChange(latestComparison)
    : statusFromAssessment(latestAssessment);
  const totalPhotos = lesions.reduce(
    (sum, lesion) => sum + lesion.observations.length,
    0,
  );
  const dueCount = lesions.filter(
    (lesion) => nextCheck(lesion).getTime() <= now,
  ).length;

  async function createLesion() {
    if (!newLesion.name.trim() || !newLesion.location.trim()) {
      setNotice("Add a name and body location.");
      return;
    }
    setSaving(true);
    try {
      const created = await storageClient.createLesion(newLesion);
      await refresh();
      setSelectedId(created.id);
      setUploadTarget(created.id);
      setShowNewLesion(false);
      setNewLesion({
        name: "",
        location: "",
        notes: "",
        reminderDays: 30,
      });
      setNotice("Record created. Add the first photo.");
      setShowUpload(true);
    } catch {
      setNotice("Could not save the record. Check the local service.");
    } finally {
      setSaving(false);
    }
  }

  async function chooseFiles(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;

    const prepared = files.map((file) => ({
      file,
      preview: URL.createObjectURL(file),
      date: new Date(file.lastModified || Date.now())
        .toISOString()
        .slice(0, 10),
      sizeMm: "",
    }));
    setDrafts(prepared);

    const analyzed = await Promise.all(
      prepared.map(async (draft) => {
        try {
          const analysis = await analyzeImage(draft.file);
          return { ...draft, analysis };
        } catch {
          return {
            ...draft,
            error: "Could not read image",
          };
        }
      }),
    );
    setDrafts(analyzed);
    event.target.value = "";
  }

  function updateDraft(index: number, patch: Partial<UploadDraft>) {
    setDrafts((items) =>
      items.map((item, itemIndex) =>
        itemIndex === index ? { ...item, ...patch } : item,
      ),
    );
  }

  async function saveDrafts() {
    if (!uploadTarget || !drafts.length) return;
    const ready = drafts.filter((draft) => draft.analysis && !draft.error);
    if (!ready.length) {
      setNotice("No ready images to save.");
      return;
    }

    setSaving(true);
    try {
      for (const draft of ready) {
        const dataUrl = await fileToDataUrl(draft.file);
        await storageClient.addObservation(uploadTarget, {
          date: draft.date,
          sizeMm: draft.sizeMm ? Number(draft.sizeMm) : undefined,
          fileName: draft.file.name,
          dataUrl,
          analysis: draft.analysis!,
        });
      }
      drafts.forEach((draft) => URL.revokeObjectURL(draft.preview));
      setDrafts([]);
      setSelectedId(uploadTarget);
      setShowUpload(false);
      await refresh();
      setNotice(
        ready.length > 1
          ? `${ready.length} photos saved. Comparison updated.`
          : "Photo saved.",
      );
    } catch {
      setNotice("Could not save photos on this device.");
    } finally {
      setSaving(false);
    }
  }

  async function deleteLesion(id: string) {
    if (!window.confirm("Delete this record and all of its photos?")) return;
    try {
      await storageClient.deleteLesion(id);
      setSelectedId("");
      await refresh();
      setNotice("Record deleted.");
    } catch {
      setNotice("Could not delete the record.");
    }
  }

  async function splitLatestObservation() {
    if (!selected || orderedObservations.length < 2) return;
    const latest = orderedObservations.at(-1)!;
    setSaving(true);
    try {
      const created = await storageClient.splitObservation(
        selected.id,
        latest.id,
      );
      await refresh();
      setSelectedId(created.id);
      setNotice("The latest photo was moved to a separate record.");
    } catch {
      setNotice("Could not separate the photos.");
    } finally {
      setSaving(false);
    }
  }

  async function exportBackup() {
    setBackupBusy(true);
    try {
      const backup = await storageClient.exportBackup();
      const fileName = await storageClient.saveBackupFile(backup.data);
      setNotice(
        `${backup.summary.records} records and ${backup.summary.photos} photos exported to ${fileName}.`,
      );
    } catch {
      setNotice("Could not create the backup on this device.");
    } finally {
      setBackupBusy(false);
    }
  }

  async function restoreBackup(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (
      !window.confirm(
        "Restore records from this backup? Existing records stay unchanged.",
      )
    ) {
      return;
    }

    setBackupBusy(true);
    try {
      const summary = await storageClient.importBackup(await file.text());
      await refresh();
      setShowBackup(false);
      setNotice(
        `${summary.records} records and ${summary.photos} photos restored.`,
      );
    } catch {
      setNotice("Could not restore this backup. Choose a DermWatch JSON backup.");
    } finally {
      setBackupBusy(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand" aria-label="DermWatch">
          <span className="brand-mark">
            <span />
          </span>
          <span>DermWatch</span>
          <small>local</small>
        </div>
        <div className="header-actions">
          <button
            className="text-button backup-button"
            onClick={() => setShowBackup(true)}
          >
            Backup
          </button>
          <button className="text-button" onClick={() => setShowPrivacy(true)}>
            Photo guide
          </button>
          <span
            className={`service-state ${serviceOnline ? "online" : "offline"}`}
          >
            <i />
            {serviceOnline ? "Stored on this device" : "Storage offline"}
          </span>
          <button
            className="primary-button"
            onClick={() => setShowNewLesion(true)}
            disabled={!serviceOnline}
          >
            <b>＋</b> New record
          </button>
        </div>
      </header>

      <section className="hero">
        <div>
          <span className="eyebrow">PRIVATE SKIN JOURNAL</span>
          <h1>
            See what changed
            <br />
            <em>Remember what didn’t</em>
          </h1>
          <p>
            Build a private, repeatable photo record. DermWatch keeps every
            image on your computer and compares visible features over time.
          </p>
        </div>
        <div className="hero-summary">
          <div>
            <strong>{lesions.length}</strong>
              <span>records</span>
          </div>
          <div>
            <strong>{totalPhotos}</strong>
              <span>photos</span>
          </div>
          <div>
            <strong>{dueCount}</strong>
              <span>due now</span>
          </div>
        </div>
      </section>

      <section className="medical-safety" role="note" aria-label="Medical safety">
        <span className="eyebrow">MEDICAL SAFETY</span>
        <div>
          <h2>DermWatch does not detect skin cancer</h2>
          <p>
            It cannot rule out melanoma or confirm that a spot is benign. It
            does not provide a diagnosis or cancer-risk score. If a spot is
            new, changing, different from the others, itching or bleeding,
            contact a dermatologist.
          </p>
        </div>
      </section>

      {notice && (
        <button className="notice" onClick={() => setNotice("")}>
          {notice}
          <span>×</span>
        </button>
      )}

      {!serviceOnline && !loading && (
        <section className="offline-card">
          <div className="offline-icon">!</div>
          <div>
            <h2>Local storage is not running</h2>
            <p>
              Restart DermWatch, then try again. Your photos remain stored on
              this computer.
            </p>
          </div>
          <button className="secondary-button" onClick={refresh}>
              Try again
          </button>
        </section>
      )}

      {serviceOnline && !loading && lesions.length === 0 && (
        <section className="empty-state">
          <div className="empty-visual">
            <span className="scan-ring one" />
            <span className="scan-ring two" />
            <span className="scan-ring three" />
            <span className="lesion-dot" />
          </div>
          <div>
            <span className="eyebrow">START WITH ONE SPOT</span>
            <h2>Create your first skin record</h2>
            <p>
              Give it a clear name, note the body location and choose a
              reminder interval. Then add a baseline photo.
            </p>
            <button
              className="primary-button large"
              onClick={() => setShowNewLesion(true)}
            >
              Create record
            </button>
          </div>
        </section>
      )}

      {serviceOnline && selected && (
        <section className="workspace">
          <aside className="lesion-list">
            <div className="section-heading">
              <div>
                <span className="eyebrow">SPOTS</span>
                <h2>Records</h2>
              </div>
              <button
                className="icon-button"
                aria-label="Add record"
                onClick={() => setShowNewLesion(true)}
              >
                +
              </button>
            </div>
            <div className="lesion-items">
              {lesions.map((lesion) => {
                const sorted = [...lesion.observations].sort((a, b) =>
                  a.date.localeCompare(b.date),
                );
                const change =
                  sorted.length > 1
                    ? compareAnalyses(
                        sorted.at(-2)!.analysis,
                        sorted.at(-1)!.analysis,
                        sorted.at(-2)!.sizeMm,
                        sorted.at(-1)!.sizeMm,
                        daysBetween(sorted.at(-2)!.date, sorted.at(-1)!.date),
                      )
                    : undefined;
                const last = sorted.at(-1);
                const singleAssessment = last
                  ? assessSingleImage(last.analysis, last.sizeMm)
                  : undefined;
                const status = change
                  ? statusFromChange(change)
                  : statusFromAssessment(singleAssessment);
                return (
                  <button
                    key={lesion.id}
                    className={`lesion-item ${
                      selected.id === lesion.id ? "active" : ""
                    }`}
                    onClick={() => setSelectedId(lesion.id)}
                  >
                    <span className="thumbnail">
                      {last ? (
                        <img
                          src={storageClient.resolveImageUrl(last.imageUrl)}
                          alt=""
                          loading="lazy"
                        />
                      ) : (
                        <i />
                      )}
                    </span>
                    <span className="lesion-copy">
                      <strong>{lesion.name}</strong>
                      <small>{lesion.location}</small>
                      <em className={`mini-status ${status.tone}`}>
                        {status.label}
                      </em>
                    </span>
                    <span className="chevron">›</span>
                  </button>
                );
              })}
            </div>
          </aside>

          <section className="detail-panel">
            <div className="detail-header">
              <div>
                <span className="eyebrow">{selected.location}</span>
                <h2>{selected.name}</h2>
                <p>
                  Every {selected.reminderDays} days
                  {selected.notes ? ` · ${selected.notes}` : ""}
                </p>
              </div>
              <div className="detail-actions">
                <button
                  className="secondary-button"
                  onClick={() => {
                    setUploadTarget(selected.id);
                    setShowUpload(true);
                  }}
                >
                  ＋ Add photos
                </button>
                <button
                  className="more-button"
                  aria-label="Delete record"
                  onClick={() => deleteLesion(selected.id)}
                >
                  ···
                </button>
              </div>
            </div>

            <div className="status-strip">
              <span className={`status-pill ${currentStatus.tone}`}>
                <i />
                {currentStatus.label}
              </span>
              {latestComparison ? (
                <>
                  <span>
                    {latestComparison.mode === "same-day-retake" ||
                    latestComparison.reliability === "low" ? (
                      <>
                        Evolution <strong>not measured</strong>
                      </>
                    ) : (
                      <>
                        {latestComparison.identity === "same"
                          ? "Change index"
                          : "Object mismatch"}{" "}
                        <strong>
                          {Math.round(
                            (latestComparison.identity === "same"
                              ? latestComparison.score
                              : latestComparison.identityScore || 0) * 100,
                          )}
                          /100
                        </strong>
                      </>
                    )}
                  </span>
                  <span>
                    {latestComparison.mode === "same-day-retake" ||
                    latestComparison.captureIssues.length > 0
                      ? "Capture match"
                      : "Identity check"}{" "}
                    <strong>
                      {latestComparison.mode === "same-day-retake" ||
                      latestComparison.captureIssues.length > 0
                        ? latestComparison.identity === "same"
                          ? "similar"
                          : "not confirmed"
                        : latestComparison.identity === "same"
                        ? "match"
                        : latestComparison.identity === "different"
                          ? "mismatch"
                          : "uncertain"}
                    </strong>
                  </span>
                </>
              ) : (
                <span>
                  Baseline photo checked · change tracking begins with the
                  second photo
                </span>
              )}
              <span className="not-diagnosis">Not a diagnosis</span>
            </div>

            {orderedObservations.length === 0 ? (
              <div className="first-photo">
                <div className="upload-glyph">
                  <span />
                </div>
                <h3>Add a baseline photo</h3>
                <p>
                  This becomes the reference point for every future comparison.
                </p>
                <button
                  className="primary-button large"
                  onClick={() => {
                    setUploadTarget(selected.id);
                    setShowUpload(true);
                  }}
                >
                  Choose photos
                </button>
              </div>
            ) : (
              <>
                {latestAssessment && (
                  <section
                    className={`single-assessment ${latestAssessment.level}`}
                  >
                    <div className="assessment-summary">
                      <div>
                        <span className="eyebrow">
                          PHOTO-ONLY MEASUREMENTS
                        </span>
                        <h2>{latestAssessment.headline}</h2>
                        <p>{latestAssessment.message}</p>
                      </div>
                      <div className="assessment-action">
                        <span>Suggested next step</span>
                        <strong>{latestAssessment.action}</strong>
                        <small>Not a diagnosis or cancer-risk score</small>
                      </div>
                    </div>

                    <div className="abcde-grid">
                      {latestAssessment.factors.map((factor) => (
                        <article
                          className={`abcde-item ${factor.state}`}
                          key={factor.code}
                        >
                          <div>
                            <strong>{factor.code}</strong>
                            <span>{factor.label}</span>
                          </div>
                          <em>
                            {factor.state === "attention"
                              ? "higher in this photo"
                              : factor.state === "clear"
                                ? "lower in this photo"
                                : "no data"}
                          </em>
                          <p>{factor.detail}</p>
                          {factor.value !== undefined && (
                            <div
                              className="factor-meter"
                              aria-label={`${factor.label}: ${Math.round(
                                factor.value * 100,
                              )} out of 100`}
                            >
                              <i
                                style={{
                                  width: formatPercent(factor.value),
                                  backgroundColor: factorMeterColor(factor.value),
                                }}
                              />
                            </div>
                          )}
                        </article>
                      ))}
                    </div>

                    <p className="assessment-footnote">
                      ABCDE values describe this image only. They are not a
                      benign/malignant classification. Evolution requires a
                      later photo taken under matched conditions.
                    </p>
                  </section>
                )}

                <div className="comparison-grid">
                  {orderedObservations.slice(-2).map((observation, index) => (
                    <article className="scan-card" key={observation.id}>
                      <div className="scan-label">
                        <span>
                          {orderedObservations.length > 1
                            ? index === 0
                              ? "PREVIOUS PHOTO"
                              : "LATEST PHOTO"
                            : "BASELINE PHOTO"}
                        </span>
                        <strong>{localDate(observation.date)}</strong>
                      </div>
                      <div className="scan-image">
                        <img
                          src={storageClient.resolveImageUrl(observation.imageUrl)}
                          alt={`${selected.name}, ${localDate(observation.date)}`}
                        />
                        <span className="focus-frame" />
                      </div>
                      <div className="scan-metrics">
                        <span>
                          Sharpness
                          <strong>{observation.analysis.quality.sharpness}%</strong>
                        </span>
                        <span>
                          Detection
                          <strong>{observation.analysis.segmentation.confidence}%</strong>
                        </span>
                        <span>
                          Size
                          <strong>
                            {observation.sizeMm
                              ? `${observation.sizeMm} mm`
                              : "not provided"}
                          </strong>
                        </span>
                      </div>
                    </article>
                  ))}
                  {orderedObservations.length === 1 && (
                    <button
                      className="scan-card add-comparison"
                      onClick={() => {
                        setUploadTarget(selected.id);
                        setShowUpload(true);
                      }}
                    >
                      <span>＋</span>
                      <strong>Add a follow-up photo</strong>
                      <small>to begin change tracking</small>
                    </button>
                  )}
                </div>

                {latestComparison && (
                  <section
                    className={`change-report identity-${latestComparison.identity}`}
                  >
                    <div className="section-heading">
                      <div>
                        <span className="eyebrow">AUTOMATED COMPARISON</span>
                        <h2>
                          {latestComparison.mode === "same-day-retake"
                            ? "Same-day photos are not evolution"
                            : latestComparison.captureIssues.length > 0
                              ? "Photos are not comparable enough"
                            : latestComparison.identity === "different"
                            ? "This is likely a different mole"
                            : latestComparison.identity === "uncertain"
                              ? "Identity could not be confirmed"
                              : latestComparison.reliability === "low"
                                ? "Photos are not comparable enough"
                              : "What changed"}
                        </h2>
                      </div>
                      <span className="interval-chip">
                        {latestComparison.mode === "same-day-retake"
                          ? "Same-day retake"
                          : `${daysBetween(
                              orderedObservations.at(-2)!.date,
                              orderedObservations.at(-1)!.date,
                            )} days between photos`}
                      </span>
                    </div>
                    {latestComparison.identity === "same" &&
                    latestComparison.reliability === "good" &&
                    latestComparison.mode === "follow-up" ? (
                      <div className="change-bars">
                        {latestComparison.factors.map((factor) => (
                          <div className="change-row" key={factor.key}>
                            <span>{factor.label}</span>
                            <div>
                              <i style={{ width: formatPercent(factor.value) }} />
                            </div>
                            <strong>{Math.round(factor.value * 100)}</strong>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="identity-result">
                        <div className="identity-score">
                          <span>
                            {latestComparison.mode === "same-day-retake"
                              ? "Comparison context"
                              : latestComparison.identity === "same" ||
                                  latestComparison.captureIssues.length > 0
                                ? "Capture quality"
                                : "Image mismatch"}
                          </span>
                          <strong>
                            {latestComparison.mode === "same-day-retake"
                              ? "Same day"
                              : latestComparison.identity === "same" ||
                                  latestComparison.captureIssues.length > 0
                                ? "Limited"
                                : latestComparison.identityScore === undefined
                                  ? "—"
                                  : `${Math.round(
                                      latestComparison.identityScore * 100,
                                    )}/100`}
                          </strong>
                        </div>
                        <p>{latestComparison.message}</p>
                        {latestComparison.identity === "different" &&
                          latestComparison.captureIssues.length === 0 &&
                          latestComparison.mode === "follow-up" && (
                          <button
                            className="secondary-button"
                            onClick={splitLatestObservation}
                            disabled={saving}
                          >
                            Move latest photo to a separate record
                          </button>
                        )}
                      </div>
                    )}
                    {latestComparison.identity === "same" &&
                      latestComparison.reliability === "good" &&
                      latestComparison.mode === "follow-up" && (
                      <p className="report-note">{latestComparison.message}</p>
                    )}
                  </section>
                )}

                <section className="timeline">
                  <div className="section-heading">
                    <div>
                      <span className="eyebrow">HISTORY</span>
                      <h2>Every observation</h2>
                    </div>
                    <span>{orderedObservations.length} photos</span>
                  </div>
                  <div className="timeline-track">
                    {orderedObservations.map((observation, index) => (
                      <div className="timeline-point" key={observation.id}>
                        <span className={index === 0 ? "baseline" : ""}>
                          {index + 1}
                        </span>
                        <strong>{localDate(observation.date)}</strong>
                        <small>
                          {index === 0
                            ? "Baseline"
                            : daysBetween(
                                  orderedObservations[index - 1].date,
                                  observation.date,
                                ) === 0
                              ? "Same-day retake"
                              : `${daysBetween(
                                  orderedObservations[index - 1].date,
                                  observation.date,
                                )} days later`}
                        </small>
                      </div>
                    ))}
                  </div>
                </section>
              </>
            )}
          </section>
        </section>
      )}

      <footer>
        <span>DermWatch runs locally. Photos never leave this computer.</span>
        <span>
          If a spot changes, bleeds or grows quickly, seek professional care.
        </span>
      </footer>

      {showNewLesion && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card compact"
            role="dialog"
            aria-modal="true"
            aria-labelledby="new-lesion-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowNewLesion(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="eyebrow">NEW SPOT</span>
            <h2 id="new-lesion-title">Create a skin record</h2>
            <p className="modal-intro">
              Keep one mole or skin spot in each record.
            </p>
            <label>
              Name
              <input
                value={newLesion.name}
                onChange={(event) =>
                  setNewLesion({ ...newLesion, name: event.target.value })
                }
                placeholder="e.g. Left shoulder mole"
                autoFocus
              />
            </label>
            <label>
              Body location
              <input
                value={newLesion.location}
                onChange={(event) =>
                  setNewLesion({ ...newLesion, location: event.target.value })
                }
                placeholder="Shoulder, back, lower leg…"
              />
            </label>
            <label>
              Reminder interval
              <select
                value={newLesion.reminderDays}
                onChange={(event) =>
                  setNewLesion({
                    ...newLesion,
                    reminderDays: Number(event.target.value),
                  })
                }
              >
                <option value={14}>Every 2 weeks</option>
                <option value={30}>Every month</option>
                <option value={60}>Every 2 months</option>
                <option value={90}>Every 3 months</option>
                <option value={180}>Every 6 months</option>
              </select>
            </label>
            <label>
              Note <small>optional</small>
              <textarea
                value={newLesion.notes}
                onChange={(event) =>
                  setNewLesion({ ...newLesion, notes: event.target.value })
                }
                placeholder="When you noticed it, anything unusual…"
              />
            </label>
            <button
              className="primary-button wide"
              onClick={createLesion}
              disabled={saving}
            >
              {saving ? "Saving…" : "Create record"}
            </button>
          </section>
        </div>
      )}

      {showUpload && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card upload-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="upload-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowUpload(false)}
              aria-label="Close"
            >
              ×
            </button>
            <div className="upload-heading">
              <div>
              <span className="eyebrow">NEW OBSERVATION</span>
              <h2 id="upload-title">Add photos</h2>
              <p>
                Select one photo or a batch. Each image keeps its own date.
                </p>
              </div>
              <label className="target-select">
                Record
                <select
                  value={uploadTarget}
                  onChange={(event) => setUploadTarget(event.target.value)}
                >
                  {lesions.map((lesion) => (
                    <option key={lesion.id} value={lesion.id}>
                      {lesion.name} · {lesion.location}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            <label className="drop-zone">
              <input
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={chooseFiles}
              />
              <span className="drop-icon">＋</span>
                <strong>Choose one or more photos</strong>
                <small>JPEG, PNG or WebP · 1200 × 1200 px or larger</small>
            </label>

            {storageClient.isNative && (
              <label className="capture-zone">
                <input
                  type="file"
                  accept="image/*"
                  capture="environment"
                  onChange={chooseFiles}
                />
                <span>＋</span>
                <strong>Take a photo</strong>
                <small>Use the rear camera and keep the phone steady</small>
              </label>
            )}

            {drafts.length > 0 && (
              <div className="draft-list">
                {drafts.map((draft, index) => (
                  <article className="draft-item" key={draft.preview}>
                    <img src={draft.preview} alt="" />
                    <div className="draft-info">
                      <strong>{draft.file.name}</strong>
                      <small>
                        {(draft.file.size / 1_048_576).toFixed(1)} MB
                      </small>
                      {draft.analysis ? (
                        <>
                          <span
                            className={`quality-badge ${draft.analysis.quality.status}`}
                          >
                            {draft.analysis.quality.status === "good"
                              ? "Good quality"
                              : draft.analysis.quality.status === "review"
                                ? "Review quality"
                                : "Retake recommended"}
                          </span>
                          {draft.analysis.quality.status !== "good" && (
                            <small className="capture-hint">
                              {captureQualityHint(draft.analysis)}
                            </small>
                          )}
                        </>
                      ) : draft.error ? (
                        <span className="quality-badge retake">
                          {draft.error}
                        </span>
                      ) : (
                        <span className="quality-badge">Analyzing…</span>
                      )}
                    </div>
                    <label>
                      Date
                      <input
                        type="date"
                        value={draft.date}
                        onChange={(event) =>
                          updateDraft(index, { date: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Size, mm <small>if known</small>
                      <input
                        type="number"
                        min="0.1"
                        max="100"
                        step="0.1"
                        value={draft.sizeMm}
                        onChange={(event) =>
                          updateDraft(index, { sizeMm: event.target.value })
                        }
                        placeholder="—"
                      />
                    </label>
                    <button
                      className="remove-draft"
                    aria-label="Remove photo"
                      onClick={() =>
                        setDrafts((items) =>
                          items.filter((_, itemIndex) => itemIndex !== index),
                        )
                      }
                    >
                      ×
                    </button>
                  </article>
                ))}
              </div>
            )}

            <div className="modal-footer">
              <p>
                The analysis tracks image changes. It does not detect disease.
              </p>
              <button
                className="primary-button"
                onClick={saveDrafts}
                disabled={
                  saving ||
                  !drafts.length ||
                  drafts.some((draft) => !draft.analysis && !draft.error)
                }
              >
                {saving
                  ? "Saving to F:…"
                  : `Save ${
                      drafts.length
                        ? `${drafts.length} ${drafts.length === 1 ? "photo" : "photos"}`
                        : ""
                    }`}
              </button>
            </div>
          </section>
        </div>
      )}

      {showPrivacy && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card guide-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="guide-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowPrivacy(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="eyebrow">REPEATABLE CAPTURE</span>
            <h2 id="guide-title">How to make photos comparable</h2>
            <div className="guide-grid">
              <div>
                <b>01</b>
                <strong>Use the same soft light</strong>
                <p>Avoid direct sun, glare, colored lamps and phone shadows.</p>
              </div>
              <div>
                <b>02</b>
                <strong>Keep the camera parallel</strong>
                <p>Do not tilt the phone or use digital zoom.</p>
              </div>
              <div>
                <b>03</b>
                <strong>Match the distance</strong>
                <p>Place a ruler or scale marker beside the spot.</p>
              </div>
              <div>
                <b>04</b>
                <strong>Center the mole</strong>
                <p>Leave a small area of surrounding skin in frame.</p>
              </div>
            </div>
            <button
              className="primary-button wide"
              onClick={() => setShowPrivacy(false)}
            >
              Got it
            </button>
          </section>
        </div>
      )}

      {showBackup && (
        <div className="modal-backdrop" role="presentation">
          <section
            className="modal-card compact backup-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="backup-title"
          >
            <button
              className="modal-close"
              onClick={() => setShowBackup(false)}
              aria-label="Close"
            >
              ×
            </button>
            <span className="eyebrow">LOCAL BACKUP</span>
            <h2 id="backup-title">Keep your records portable</h2>
            <p className="modal-intro">
              Export one private JSON file containing every record, photo and
              measurement. Store it somewhere only you can access.
            </p>
            <div className="backup-summary" aria-label="Backup contents">
              <div>
                <strong>{lesions.length}</strong>
                <span>records</span>
              </div>
              <div>
                <strong>{totalPhotos}</strong>
                <span>photos</span>
              </div>
            </div>
            <button
              className="primary-button wide"
              onClick={exportBackup}
              disabled={backupBusy || !serviceOnline}
            >
              {backupBusy ? "Preparing backup…" : "Export private backup"}
            </button>
            <label className="secondary-button backup-import">
              Restore from backup
              <input
                type="file"
                accept="application/json,.json"
                onChange={restoreBackup}
                disabled={backupBusy || !serviceOnline}
              />
            </label>
            <p className="backup-note">
              Restoring adds the backup records without deleting anything
              already on this device.
            </p>
          </section>
        </div>
      )}
    </main>
  );
}
