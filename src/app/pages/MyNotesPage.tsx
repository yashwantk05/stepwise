import React, { useRef, useState, useEffect, useCallback, useMemo } from 'react';
import {
  AlertCircle,
  BadgeHelp,
  BookOpen,
  FileText,
  Grid3X3,
  Lightbulb,
  Mic,
  Plus,
  Search,
  Share2,
  Upload,
} from 'lucide-react';
import {
  listSubjects,
  createSubject,
  listNotes,
  createTextNote,
  updateTextNote,
  deleteNote,
} from '../services/storage';
import type { StudyToolType } from '../services/studyTools';
import { generateNoteInsight, type NoteInsightMode } from '../services/noteInsights';
import { extractImageText, extractPdfText, fileNameToTitle } from '../services/noteUploads';

const formatDate = (time: number) => new Date(time).toLocaleDateString();

interface SubjectRecord {
  id: string;
  name: string;
}

interface NoteRecord {
  id: string;
  title: string;
  content: string;
  tags?: string[];
  updatedAt: number;
}

interface SummaryInsight {
  summary: string;
  keyPoints: string[];
  revisionChecklist: string[];
}

interface FormulaInsight {
  formulas: Array<{
    name: string;
    expression: string;
    meaning: string;
  }>;
}

interface MistakeInsight {
  mistakes: Array<{
    mistake: string;
    fix: string;
  }>;
}

const defaultNoteContent = `Add your class notes here.

- Key ideas
- Important formulas
- Mistakes to revisit
- Revision reminders`;

export function MyNotesPage({ onOpenTool }: { onOpenTool: (tool: StudyToolType, subjectId?: string) => void }) {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [loading, setLoading] = useState(false);
  const [saveMessage, setSaveMessage] = useState('');
  const [activeTab, setActiveTab] = useState<'notes' | 'summary' | 'formulas' | 'mistakes'>('notes');
  const [insightLoading, setInsightLoading] = useState(false);
  const [insightError, setInsightError] = useState('');
  const [summaryInsight, setSummaryInsight] = useState<SummaryInsight | null>(null);
  const [formulaInsight, setFormulaInsight] = useState<FormulaInsight | null>(null);
  const [mistakeInsight, setMistakeInsight] = useState<MistakeInsight | null>(null);
  const [uploadMessage, setUploadMessage] = useState('');
  const imageInputRef = useRef<HTMLInputElement>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const loadSubjects = useCallback(async () => {
    const data = (await listSubjects()) as SubjectRecord[];
    setSubjects(data);

    if (data.length > 0) {
      setSelectedSubjectId((current) =>
        current && data.some((subject) => subject.id === current) ? current : data[0].id,
      );
    } else {
      setSelectedSubjectId('');
    }
  }, []);

  const loadNotes = useCallback(async (subjectId: string) => {
    const data = (await listNotes(subjectId)) as NoteRecord[];
    setNotes(data);
    setSelectedNoteId((current) =>
      current && data.some((note) => note.id === current) ? current : data[0]?.id || '',
    );
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (!selectedSubjectId) {
      setNotes([]);
      setSelectedNoteId('');
      return;
    }

    void loadNotes(selectedSubjectId);
  }, [selectedSubjectId, loadNotes]);

  const filteredNotes = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return notes;

    return notes.filter((note) =>
      [note.title, note.content, ...(note.tags || [])].join(' ').toLowerCase().includes(query),
    );
  }, [notes, searchQuery]);

  const selectedNote = useMemo(
    () => filteredNotes.find((note) => note.id === selectedNoteId) || notes.find((note) => note.id === selectedNoteId) || null,
    [filteredNotes, notes, selectedNoteId],
  );

  useEffect(() => {
    if (!selectedNote) {
      setEditorTitle('');
      setEditorContent('');
      setActiveTab('notes');
      setSummaryInsight(null);
      setFormulaInsight(null);
      setMistakeInsight(null);
      setInsightError('');
      setSaveMessage('');
      setUploadMessage('');
      return;
    }

    setEditorTitle(selectedNote.title);
    setEditorContent(selectedNote.content);
    setActiveTab('notes');
    setSummaryInsight(null);
    setFormulaInsight(null);
    setMistakeInsight(null);
    setInsightError('');
    setSaveMessage('');
    setUploadMessage('');
  }, [selectedNote]);

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) return;

    setLoading(true);
    try {
      const created = (await createSubject(subjectName.trim())) as SubjectRecord;
      setSubjectName('');
      await loadSubjects();
      setSelectedSubjectId(created.id);
    } finally {
      setLoading(false);
    }
  };

  const handleCreateNote = async () => {
    if (!selectedSubjectId) return;

    setLoading(true);
    try {
      const subject = subjects.find((entry) => entry.id === selectedSubjectId);
      const newNote = (await createTextNote(selectedSubjectId, {
        title: subject ? `${subject.name} Notes` : 'Untitled Note',
        content: defaultNoteContent,
        tags: ['Class Notes'],
      })) as NoteRecord;

      await loadNotes(selectedSubjectId);
      setSelectedNoteId(newNote.id);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveNote = async () => {
    if (!selectedSubjectId || !selectedNoteId) return;

    setLoading(true);
    setSaveMessage('');
    try {
      await updateTextNote(selectedSubjectId, selectedNoteId, {
        title: editorTitle,
        content: editorContent,
        tags: selectedNote?.tags || ['Class Notes'],
      });
      await loadNotes(selectedSubjectId);
      setSaveMessage('Saved');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteNote = async () => {
    if (!selectedSubjectId || !selectedNote) return;
    if (!window.confirm(`Delete note "${selectedNote.title}"?`)) return;

    setLoading(true);
    try {
      await deleteNote(selectedSubjectId, selectedNote.id);
      await loadNotes(selectedSubjectId);
    } finally {
      setLoading(false);
    }
  };

  const handleShareNote = async () => {
    if (!selectedNote) return;

    const shareText = `${editorTitle}\n\n${editorContent}`.trim();
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(shareText);
      window.alert('Note copied to clipboard.');
      return;
    }

    window.alert('Clipboard sharing is not available in this browser.');
  };

  const handleInsightTabChange = async (tab: 'notes' | 'summary' | 'formulas' | 'mistakes') => {
    setActiveTab(tab);
    setInsightError('');

    if (tab === 'notes') return;
    if (!selectedSubjectId || !editorContent.trim()) {
      setInsightError('Add some note content first to generate AI insights.');
      return;
    }

    const modeMap: Record<'summary' | 'formulas' | 'mistakes', NoteInsightMode> = {
      summary: 'summary',
      formulas: 'formulas',
      mistakes: 'mistakes',
    };

    const mode = modeMap[tab];
    const selectedSubject = subjects.find((subject) => subject.id === selectedSubjectId);

    setInsightLoading(true);
    try {
      const response = await generateNoteInsight(
        mode,
        selectedSubject?.name || 'General',
        editorTitle || 'Untitled Note',
        editorContent,
      );

      if (tab === 'summary') {
        setSummaryInsight(response.output as SummaryInsight);
      } else if (tab === 'formulas') {
        setFormulaInsight(response.output as FormulaInsight);
      } else {
        setMistakeInsight(response.output as MistakeInsight);
      }
    } catch (error) {
      setInsightError(error instanceof Error ? error.message : 'Unable to analyze this note.');
    } finally {
      setInsightLoading(false);
    }
  };

  const handleImportedNote = async (title: string, content: string, tags: string[]) => {
    if (!selectedSubjectId) return;

    const newNote = (await createTextNote(selectedSubjectId, {
      title,
      content,
      tags,
    })) as NoteRecord;

    await loadNotes(selectedSubjectId);
    setSelectedNoteId(newNote.id);
    setActiveTab('notes');
  };

  const handleImageUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedSubjectId) return;

    setLoading(true);
    setUploadMessage('');
    try {
      const extracted = await extractImageText(file);
      await handleImportedNote(
        fileNameToTitle(file.name),
        extracted || 'No text could be extracted from this notebook image.',
        ['Notebook Image', 'Uploaded'],
      );
      setUploadMessage('Notebook image imported as a note.');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Unable to import this notebook image.');
    } finally {
      setLoading(false);
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedSubjectId) return;

    setLoading(true);
    setUploadMessage('');
    try {
      const extracted = await extractPdfText(file);
      await handleImportedNote(
        fileNameToTitle(file.name),
        extracted || 'No readable text was found in this PDF.',
        ['PDF', 'Uploaded'],
      );
      setUploadMessage('PDF imported as a note.');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Unable to import this PDF.');
    } finally {
      setLoading(false);
    }
  };

  const handleAudioUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file || !selectedSubjectId) return;

    setLoading(true);
    setUploadMessage('');
    try {
      await handleImportedNote(
        fileNameToTitle(file.name),
        `Voice note uploaded: ${file.name}\n\nTranscription is not available yet, but you can add or edit the note text here manually.`,
        ['Voice Note', 'Uploaded'],
      );
      setUploadMessage('Voice note added. You can now edit its text manually.');
    } catch (error) {
      setUploadMessage(error instanceof Error ? error.message : 'Unable to import this voice note.');
    } finally {
      setLoading(false);
    }
  };

  const handleOpenTool = async (tool: StudyToolType) => {
    if (!selectedSubjectId) return;

    if (selectedNoteId && selectedNote && (editorTitle !== selectedNote.title || editorContent !== selectedNote.content)) {
      await handleSaveNote();
    }

    onOpenTool(tool, selectedSubjectId);
  };

  const renderEditorTabBody = () => {
    if (activeTab === 'notes') {
      return (
        <textarea
          className="notes-editor-textarea"
          value={editorContent}
          onChange={(e) => setEditorContent(e.target.value)}
          placeholder="Write your notes here..."
        />
      );
    }

    if (insightLoading) {
      return <div className="notes-insight-panel">Generating {activeTab === 'summary' ? 'AI Summary' : activeTab}...</div>;
    }

    if (insightError) {
      return <div className="notes-insight-panel">{insightError}</div>;
    }

    if (activeTab === 'summary') {
      return (
        <div className="notes-insight-panel">
          <h4>AI Summary</h4>
          <p>{summaryInsight?.summary || 'No summary generated yet.'}</p>
          <div className="notes-insight-grid">
            <div>
              <strong>Key Points</strong>
              <ul>{(summaryInsight?.keyPoints || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
            <div>
              <strong>Revision Checklist</strong>
              <ul>{(summaryInsight?.revisionChecklist || []).map((item) => <li key={item}>{item}</li>)}</ul>
            </div>
          </div>
        </div>
      );
    }

    if (activeTab === 'formulas') {
      return (
        <div className="notes-insight-panel">
          <h4>Formulas</h4>
          {(formulaInsight?.formulas || []).length > 0 ? (
            <div className="notes-formula-list">
              {(formulaInsight?.formulas || []).map((formula) => (
                <div key={`${formula.name}-${formula.expression}`} className="notes-formula-card">
                  <strong>{formula.name || 'Formula'}</strong>
                  <code>{formula.expression || 'No expression found'}</code>
                  <p>{formula.meaning}</p>
                </div>
              ))}
            </div>
          ) : (
            <p>No formulas were found in this note yet.</p>
          )}
        </div>
      );
    }

    return (
      <div className="notes-insight-panel">
        <h4>Mistakes To Watch</h4>
        {(mistakeInsight?.mistakes || []).length > 0 ? (
          <div className="notes-mistake-list">
            {(mistakeInsight?.mistakes || []).map((entry) => (
              <div key={`${entry.mistake}-${entry.fix}`} className="notes-mistake-card">
                <strong>{entry.mistake}</strong>
                <p>{entry.fix}</p>
              </div>
            ))}
          </div>
        ) : (
          <p>No common mistakes generated yet.</p>
        )}
      </div>
    );
  };

  return (
    <div className="app-content">
      <section className="notes-shell">
        <div className="notes-header">
          <div>
            <h2>My Notes</h2>
            <p>Smart notes with AI-powered organization</p>
          </div>
          <button className="btn-primary" onClick={() => void handleCreateNote()} disabled={loading || !selectedSubjectId}>
            <Plus size={16} />
            New Note
          </button>
        </div>

        <div className="notes-subject-bar">
          <div className="notes-subject-picker">
            <label className="form-label" htmlFor="notes-subject-select">
              Select notebook
            </label>
            <select
              id="notes-subject-select"
              value={selectedSubjectId}
              onChange={(e) => setSelectedSubjectId(e.target.value)}
              disabled={loading || subjects.length === 0}
            >
              {subjects.map((subject) => (
                <option key={subject.id} value={subject.id}>
                  {subject.name}
                </option>
              ))}
            </select>
          </div>

          <form className="notes-inline-create" onSubmit={handleCreateSubject}>
            <label className="form-label" htmlFor="notes-subject-input">
              Or create new notebook
            </label>
            <div className="notes-inline-create-row">
              <input
                id="notes-subject-input"
                type="text"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="New notebook"
                disabled={loading}
              />
              <button type="submit" className="btn-secondary" disabled={loading || !subjectName.trim()}>
                Add
              </button>
            </div>
          </form>
        </div>

        {subjects.length === 0 ? (
          <div className="notes-empty-state">
            <AlertCircle size={18} />
            <span>Create a notebook first to start writing notes.</span>
          </div>
        ) : (
          <div className="notes-grid">
            <aside className="notes-sidebar">
              <div className="notes-search">
                <Search size={16} />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search notes..."
                />
              </div>

              <div className="notes-upload-card">
                <h3>Quick Upload</h3>
                <input
                  ref={imageInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  className="notes-hidden-input"
                  onChange={handleImageUpload}
                />
                <input
                  ref={pdfInputRef}
                  type="file"
                  accept="application/pdf"
                  className="notes-hidden-input"
                  onChange={handlePdfUpload}
                />
                <input
                  ref={audioInputRef}
                  type="file"
                  accept="audio/*"
                  className="notes-hidden-input"
                  onChange={handleAudioUpload}
                />
                <button
                  type="button"
                  className="notes-upload-btn"
                  onClick={() => imageInputRef.current?.click()}
                  disabled={loading || !selectedSubjectId}
                >
                  <Upload size={16} />
                  Notebook image
                </button>
                <button
                  type="button"
                  className="notes-upload-btn"
                  onClick={() => pdfInputRef.current?.click()}
                  disabled={loading || !selectedSubjectId}
                >
                  <FileText size={16} />
                  PDF
                </button>
                <button
                  type="button"
                  className="notes-upload-btn"
                  onClick={() => audioInputRef.current?.click()}
                  disabled={loading || !selectedSubjectId}
                >
                  <Mic size={16} />
                  Voice notes
                </button>
                {uploadMessage ? <p className="notes-upload-message">{uploadMessage}</p> : null}
              </div>

              <div className="notes-list">
                {filteredNotes.length === 0 ? (
                  <div className="notes-list-empty">No notes found for this notebook yet.</div>
                ) : (
                  filteredNotes.map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className={`note-card ${note.id === selectedNoteId ? 'active' : ''}`}
                      onClick={() => setSelectedNoteId(note.id)}
                    >
                      <strong>{note.title}</strong>
                      <span>{formatDate(note.updatedAt)}</span>
                      <p>{note.content.replace(/\s+/g, ' ').slice(0, 72)}...</p>
                      <div className="note-tag-row">
                        {(note.tags || []).slice(0, 3).map((tag) => (
                          <span key={tag} className="note-tag">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </aside>

            <div className="notes-main">
              {selectedNote ? (
                <div className="notes-editor-card">
                  <div className="notes-editor-top">
                    <input
                      className="notes-title-input"
                      type="text"
                      value={editorTitle}
                      onChange={(e) => setEditorTitle(e.target.value)}
                      placeholder="Note title"
                    />
                    <div className="notes-editor-actions">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => void handleSaveNote()}>
                        Save
                      </button>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => void handleShareNote()}>
                        <Share2 size={14} />
                        Share
                      </button>
                      <button type="button" className="btn-danger btn-sm" onClick={() => void handleDeleteNote()}>
                        Delete
                      </button>
                    </div>
                  </div>

                  {saveMessage ? <p className="notes-save-message">{saveMessage}</p> : null}

                  <div className="notes-editor-tabs">
                    <button
                      type="button"
                      className={`notes-editor-tab ${activeTab === 'notes' ? 'active' : ''}`}
                      onClick={() => void handleInsightTabChange('notes')}
                    >
                      <BookOpen size={14} />
                      Notes
                    </button>
                    <button
                      type="button"
                      className={`notes-editor-tab ${activeTab === 'summary' ? 'active' : ''}`}
                      onClick={() => void handleInsightTabChange('summary')}
                    >
                      <Lightbulb size={14} />
                      AI Summary
                    </button>
                    <button
                      type="button"
                      className={`notes-editor-tab ${activeTab === 'formulas' ? 'active' : ''}`}
                      onClick={() => void handleInsightTabChange('formulas')}
                    >
                      <Grid3X3 size={14} />
                      Formulas
                    </button>
                    <button
                      type="button"
                      className={`notes-editor-tab ${activeTab === 'mistakes' ? 'active' : ''}`}
                      onClick={() => void handleInsightTabChange('mistakes')}
                    >
                      <AlertCircle size={14} />
                      Mistakes
                    </button>
                  </div>

                  <div className="notes-editor-subtitle">{editorTitle || 'Untitled Note'}</div>

                  {renderEditorTabBody()}
                </div>
              ) : (
                <div className="notes-empty-main">
                  <h3>No note selected</h3>
                  <p>Create a new note to start building your notebook-wise notes.</p>
                  <button className="btn-primary" onClick={() => void handleCreateNote()} disabled={loading}>
                    <Plus size={16} />
                    New Note
                  </button>
                </div>
              )}

              <div className="notes-convert-card">
                <h3>Convert Notes Into</h3>
                <div className="notes-convert-grid">
                  <button
                    onClick={() => void handleOpenTool('flashcards')}
                    type="button"
                    className="notes-convert-btn"
                  >
                    <BookOpen size={16} className="notes-convert-icon" />
                    Convert to Flashcards
                  </button>
                  <button
                    onClick={() => void handleOpenTool('quiz')}
                    type="button"
                    className="notes-convert-btn"
                  >
                    <BadgeHelp size={16} className="notes-convert-icon" />
                    Create Quiz
                  </button>
                  <button
                    onClick={() => void handleOpenTool('revision-sheet')}
                    type="button"
                    className="notes-convert-btn"
                  >
                    <FileText size={16} className="notes-convert-icon" />
                    Generate Revision Sheet
                  </button>
                  <button
                    onClick={() => void handleOpenTool('mind-map')}
                    type="button"
                    className="notes-convert-btn"
                  >
                    <Grid3X3 size={16} className="notes-convert-icon" />
                    Create Mind Map
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
