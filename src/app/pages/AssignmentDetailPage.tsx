import React, { useState, useEffect, useCallback } from 'react';
import {
  getAssignmentById,
  getSubjectById,
  addProblemToAssignment,
  deleteProblemFromAssignment,
  deleteAssignmentPdf,
  deleteAssignmentCaptureImage,
  getAssignmentCaptureImage,
  getAssignmentCaptureImageDownloadUrl,
  getAssignmentPdf,
  getAssignmentPdfDownloadUrl,
  listAssignmentProblems,
  renameAssignmentProblem,
  saveAssignmentPdf,
  saveAssignmentCaptureImage,
} from '../services/storage';

const MIN_PROBLEM_COUNT = 1;
const MAX_PROBLEM_COUNT = 60;
const MAX_PDF_BYTES = 20 * 1024 * 1024;
const MAX_CAPTURE_BYTES = 8 * 1024 * 1024;
const CAPTURE_TYPES = ['image/png', 'image/jpeg', 'image/webp'];

const normalizeProblemCount = (value: number) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed)) return MIN_PROBLEM_COUNT;
  return Math.min(MAX_PROBLEM_COUNT, Math.max(MIN_PROBLEM_COUNT, parsed));
};

const buildProblemIndexes = (problemCount: number) =>
  Array.from({ length: normalizeProblemCount(problemCount) }, (_value, index) => index + 1);

interface AssignmentDetailPageProps {
  subjectId: string;
  assignmentId: string;
  onBack: () => void;
  onOpenProblem: (problemIndex: number) => void;
}

export function AssignmentDetailPage({ subjectId, assignmentId, onBack, onOpenProblem }: AssignmentDetailPageProps) {
  const [subject, setSubject] = useState<any>(null);
  const [assignment, setAssignment] = useState<any>(null);
  const [fileRecord, setFileRecord] = useState<any>(null);
  const [captureRecord, setCaptureRecord] = useState<any>(null);
  const [problemTitles, setProblemTitles] = useState<Record<number, string>>({});
  const [status, setStatus] = useState('Loading assignment...');
  const [loading, setLoading] = useState(false);

  const loadProblemTitles = useCallback(async () => {
    const problems = await listAssignmentProblems(assignmentId);
    const nextTitles = problems.reduce<Record<number, string>>((acc, problem) => {
      acc[problem.problemIndex] = problem.title;
      return acc;
    }, {});
    setProblemTitles(nextTitles);
  }, [assignmentId]);

  const load = useCallback(async () => {
    try {
      const [assignmentData, subjectData, fileData] = await Promise.all([
        getAssignmentById(assignmentId),
        getSubjectById(subjectId).catch(() => null),
        getAssignmentPdf(assignmentId).catch(() => null),
      ]);
      setAssignment(assignmentData);
      setSubject(subjectData || { id: subjectId, name: "Subject" });
      setFileRecord(fileData || null);
      const captureData = await getAssignmentCaptureImage(assignmentId).catch(() => null);
      setCaptureRecord(captureData || null);
      setStatus('Assignment loaded.');

      try {
        await loadProblemTitles();
      } catch {
        setProblemTitles({});
      }
    } catch {
      setStatus('Assignment not found.');
      alert('Assignment not found');
      onBack();
    }
  }, [subjectId, assignmentId, onBack, loadProblemTitles]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAddProblem = async () => {
    if (!assignment) return;
    setLoading(true);
    try {
      const updated = await addProblemToAssignment(assignment.id);
      setAssignment(updated);
      setStatus(`Added problem ${updated.problemCount}.`);
      await loadProblemTitles();
    } finally {
      setLoading(false);
    }
  };

  const getProblemTitle = (problemIndex: number) =>
    problemTitles[problemIndex] || `Problem ${problemIndex}`;

  const handleRenameProblem = async (problemIndex: number) => {
    if (!assignment) return;
    const nextTitle = window.prompt(
      `Rename Problem ${problemIndex}`,
      getProblemTitle(problemIndex),
    );
    if (nextTitle == null) return;
    const trimmed = nextTitle.trim();
    if (!trimmed) {
      alert('Problem name cannot be empty.');
      return;
    }

    setLoading(true);
    try {
      await renameAssignmentProblem(assignment.id, problemIndex, trimmed);
      setProblemTitles((previous) => ({
        ...previous,
        [problemIndex]: trimmed,
      }));
      setStatus(`Renamed Problem ${problemIndex}.`);
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteProblem = async (problemIndex: number) => {
    if (!assignment) return;
    const shouldDelete = window.confirm(
      `Delete "${getProblemTitle(problemIndex)}"? This removes its saved whiteboard and image.`
    );
    if (!shouldDelete) return;

    setLoading(true);
    try {
      const result = await deleteProblemFromAssignment(assignment.id, problemIndex);
      setAssignment(result.assignment);
      setStatus(
        result.removedArtifacts
          ? `Deleted Problem ${result.removedProblemIndex} and removed its saved data.`
          : `Deleted Problem ${result.removedProblemIndex}.`,
      );
      await loadProblemTitles();
    } finally {
      setLoading(false);
    }
  };

  const handleUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (file.type !== 'application/pdf') {
      setStatus('Please upload a PDF file.');
      return;
    }

    if (file.size > MAX_PDF_BYTES) {
      setStatus('PDF exceeds the 20MB upload limit.');
      return;
    }

    setLoading(true);
    try {
      await saveAssignmentPdf(assignmentId, file);
      setStatus(`Uploaded ${file.name}.`);
      const nextRecord = await getAssignmentPdf(assignmentId);
      setFileRecord(nextRecord || null);
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to upload PDF.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenPdf = async () => {
    try {
      const url = await getAssignmentPdfDownloadUrl(assignmentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to open PDF.');
    }
  };

  const handleCaptureUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!CAPTURE_TYPES.includes(file.type)) {
      setStatus('Please upload PNG, JPEG, or WEBP image.');
      return;
    }

    if (file.size > MAX_CAPTURE_BYTES) {
      setStatus('Image exceeds the 8MB upload limit.');
      return;
    }

    setLoading(true);
    try {
      await saveAssignmentCaptureImage(assignmentId, file);
      setStatus(`Uploaded ${file.name} to image/capture.`);
      const nextRecord = await getAssignmentCaptureImage(assignmentId);
      setCaptureRecord(nextRecord || null);
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to upload capture image.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenCapture = async () => {
    try {
      const url = await getAssignmentCaptureImageDownloadUrl(assignmentId);
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to open capture image.');
    }
  };

  const handleRemoveCapture = async () => {
    setLoading(true);
    try {
      await deleteAssignmentCaptureImage(assignmentId);
      setCaptureRecord(null);
      setStatus('Removed image/capture upload.');
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to remove capture image.');
    } finally {
      setLoading(false);
    }
  };

  const handleRemovePdf = async () => {
    setLoading(true);
    try {
      await deleteAssignmentPdf(assignmentId);
      setFileRecord(null);
      setStatus('Removed uploaded PDF.');
    } catch (error) {
      setStatus((error as Error)?.message || 'Unable to remove PDF.');
    } finally {
      setLoading(false);
    }
  };

  if (!assignment || !subject) {
    return (
      <div className="app-content">
        <p>Loading...</p>
      </div>
    );
  }

  const problemIndexes = buildProblemIndexes(assignment.problemCount);

  return (
    <div className="app-content">
      <div className="welcome-section">
        <button 
          onClick={onBack}
          className="btn-secondary"
          style={{ marginBottom: '16px', width: 'fit-content' }}
        >
          <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M15 10H5M5 10l4 4M5 10l4-4" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          Back to {subject.name}
        </button>
        <h1>📝 {assignment.title}</h1>
        <p>{subject.name} • {normalizeProblemCount(assignment.problemCount)} problems</p>
      </div>

      <div className="form-section mb-3">
        <h2>Problem Sheet Upload</h2>
        <div className="form-row">
          <input
            type="file"
            accept="application/pdf"
            onChange={handleUpload}
            disabled={loading}
          />
          {fileRecord && (
            <>
              <button type="button" className="btn-secondary" onClick={handleOpenPdf} disabled={loading}>
                Open PDF
              </button>
              <button type="button" className="btn-danger" onClick={handleRemovePdf} disabled={loading}>
                Remove PDF
              </button>
            </>
          )}
        </div>
        {fileRecord ? (
          <p className="text-muted text-sm">
            {fileRecord.fileName} ({Math.round(fileRecord.size / 1024)} KB)
          </p>
        ) : (
          <p className="text-muted text-sm">No PDF uploaded yet.</p>
        )}
        <p className="form-help">{status}</p>
        <hr style={{ margin: '12px 0 10px' }} />
        <h3 style={{ margin: '0 0 8px', fontSize: '1rem' }}>Image/Capture Channel</h3>
        <div className="form-row">
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            capture="environment"
            onChange={handleCaptureUpload}
            disabled={loading}
          />
          {captureRecord && (
            <>
              <button type="button" className="btn-secondary" onClick={handleOpenCapture} disabled={loading}>
                Open Capture
              </button>
              <button type="button" className="btn-danger" onClick={handleRemoveCapture} disabled={loading}>
                Remove Capture
              </button>
            </>
          )}
        </div>
        {captureRecord ? (
          <p className="text-muted text-sm">
            {captureRecord.fileName} ({Math.round(captureRecord.size / 1024)} KB)
          </p>
        ) : (
          <p className="text-muted text-sm">No image/capture uploaded yet.</p>
        )}
      </div>

      <div className="form-section mb-3">
        <h2>Manage Problems</h2>
        <div className="form-row">
          <button
            type="button"
            className="btn-primary"
            onClick={handleAddProblem}
            disabled={loading || normalizeProblemCount(assignment.problemCount) >= MAX_PROBLEM_COUNT}
          >
            <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M10 5v10M5 10h10" strokeLinecap="round" />
            </svg>
            Add Problem
          </button>
        </div>
        <p className="form-help">
          Each problem card includes Rename and Delete options. Deleting a problem permanently removes its saved whiteboard and image.
        </p>
      </div>

      <div>
        <h2 className="mb-2" style={{ fontSize: '20px', fontWeight: 600 }}>
          🎯 Problems
        </h2>
        <div className="cards-grid">
          {problemIndexes.map((problemIndex) => (
            <div
              key={problemIndex}
              className="card"
              onClick={() => onOpenProblem(problemIndex)}
              style={{ cursor: 'pointer' }}
            >
              <h2 style={{ fontSize: '18px' }}>{getProblemTitle(problemIndex)}</h2>
              <p className="text-muted text-sm">Click to open whiteboard</p>
              <div className="card-actions">
                <button
                  className="btn-sm btn-primary"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenProblem(problemIndex);
                  }}
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M15 3v4M15 7h4M5 7H3a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2v-2" />
                    <path d="M6 12l9-9M11 3h4v4" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  Open Whiteboard
                </button>
                <button
                  className="btn-sm btn-secondary"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleRenameProblem(problemIndex);
                  }}
                  disabled={loading}
                >
                  Rename
                </button>
                <button
                  className="btn-sm btn-danger problem-delete-icon-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    void handleDeleteProblem(problemIndex);
                  }}
                  disabled={loading || normalizeProblemCount(assignment.problemCount) <= MIN_PROBLEM_COUNT}
                  aria-label={`Delete ${getProblemTitle(problemIndex)}`}
                  title="Delete problem"
                >
                  <svg width="16" height="16" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h14" strokeLinecap="round" />
                    <path d="M8 6V4a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v2" strokeLinecap="round" />
                    <path d="M6 6v10a2 2 0 0 0 2 2h4a2 2 0 0 0 2-2V6" strokeLinecap="round" />
                    <path d="M9 9v6M11 9v6" strokeLinecap="round" />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
