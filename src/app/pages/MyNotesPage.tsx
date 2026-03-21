import React, { useState, useEffect, useCallback, useMemo } from 'react';
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

const defaultNoteContent = `Add your class notes here.

- Key ideas
- Important formulas
- Mistakes to revisit
- Revision reminders`;

export function MyNotesPage() {
  const [subjects, setSubjects] = useState<SubjectRecord[]>([]);
  const [notes, setNotes] = useState<NoteRecord[]>([]);
  const [subjectName, setSubjectName] = useState('');
  const [selectedSubjectId, setSelectedSubjectId] = useState('');
  const [selectedNoteId, setSelectedNoteId] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [editorTitle, setEditorTitle] = useState('');
  const [editorContent, setEditorContent] = useState('');
  const [loading, setLoading] = useState(false);

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
      return;
    }

    setEditorTitle(selectedNote.title);
    setEditorContent(selectedNote.content);
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
    try {
      await updateTextNote(selectedSubjectId, selectedNoteId, {
        title: editorTitle,
        content: editorContent,
        tags: selectedNote?.tags || ['Class Notes'],
      });
      await loadNotes(selectedSubjectId);
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
              Select subject
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
              Or create new subject
            </label>
            <div className="notes-inline-create-row">
              <input
                id="notes-subject-input"
                type="text"
                value={subjectName}
                onChange={(e) => setSubjectName(e.target.value)}
                placeholder="New subject"
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
            <span>Create a subject first to start writing notes.</span>
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
                <button type="button" className="notes-upload-btn">
                  <Upload size={16} />
                  Notebook image
                </button>
                <button type="button" className="notes-upload-btn">
                  <FileText size={16} />
                  PDF
                </button>
                <button type="button" className="notes-upload-btn">
                  <Mic size={16} />
                  Voice notes
                </button>
              </div>

              <div className="notes-list">
                {filteredNotes.length === 0 ? (
                  <div className="notes-list-empty">No notes found for this subject yet.</div>
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

                  <div className="notes-editor-tabs">
                    <button type="button" className="notes-editor-tab active">
                      <BookOpen size={14} />
                      Notes
                    </button>
                    <button type="button" className="notes-editor-tab">
                      <Lightbulb size={14} />
                      AI Summary
                    </button>
                    <button type="button" className="notes-editor-tab">
                      <Grid3X3 size={14} />
                      Formulas
                    </button>
                    <button type="button" className="notes-editor-tab">
                      <AlertCircle size={14} />
                      Mistakes
                    </button>
                  </div>

                  <div className="notes-editor-subtitle">{editorTitle || 'Untitled Note'}</div>

                  <textarea
                    className="notes-editor-textarea"
                    value={editorContent}
                    onChange={(e) => setEditorContent(e.target.value)}
                    placeholder="Write your notes here..."
                  />
                </div>
              ) : (
                <div className="notes-empty-main">
                  <h3>No note selected</h3>
                  <p>Create a new note to start building your subject-wise notes.</p>
                  <button className="btn-primary" onClick={() => void handleCreateNote()} disabled={loading}>
                    <Plus size={16} />
                    New Note
                  </button>
                </div>
              )}

              <div className="notes-convert-card">
                <h3>Convert Notes Into</h3>
                <div className="notes-convert-grid">
                  <button type="button" className="notes-convert-btn">
                    <BookOpen size={16} className="notes-convert-icon" />
                    Convert to Flashcards
                  </button>
                  <button type="button" className="notes-convert-btn">
                    <BadgeHelp size={16} className="notes-convert-icon" />
                    Create Quiz
                  </button>
                  <button type="button" className="notes-convert-btn">
                    <FileText size={16} className="notes-convert-icon" />
                    Generate Revision Sheet
                  </button>
                  <button type="button" className="notes-convert-btn">
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
