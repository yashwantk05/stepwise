import React, { useState, useEffect, useCallback } from 'react';
import { listSubjects, createSubject, deleteSubject, listNotes, uploadNote, deleteNote, downloadNoteBlob } from '../services/storage';

const formatDate = (time: number) => new Date(time).toLocaleString();
const MAX_FILE_SIZE = 20 * 1024 * 1024;

export function DashboardPage({ user }: { user: any }) {
  const [subjects, setSubjects] = useState<any[]>([]);
  const [notes, setNotes] = useState<any[]>([]);
  const [selectedSubjectId, setSelectedSubjectId] = useState<string | null>(null);
  const [subjectName, setSubjectName] = useState('');
  const [loading, setLoading] = useState(false);

  const loadSubjects = useCallback(async () => {
    const data = await listSubjects();
    setSubjects(data);
    
    // Load notes for the first subject if available
    if (data.length > 0 && !selectedSubjectId) {
      setSelectedSubjectId(data[0].id);
    }
  }, [selectedSubjectId]);

  const loadNotes = useCallback(async (subjectId: string) => {
    const data = await listNotes(subjectId);
    setNotes(data);
  }, []);

  useEffect(() => {
    void loadSubjects();
  }, [loadSubjects]);

  useEffect(() => {
    if (selectedSubjectId) {
      void loadNotes(selectedSubjectId);
    }
  }, [selectedSubjectId, loadNotes]);

  const handleCreateSubject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!subjectName.trim()) return;

    setLoading(true);
    try {
      await createSubject(subjectName.trim());
      setSubjectName('');
      await loadSubjects();
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSubject = async (id: string, name: string) => {
    if (!window.confirm(`Delete subject "${name}"? This will remove all related notes.`)) return;
    
    setLoading(true);
    try {
      await deleteSubject(id);
      if (selectedSubjectId === id) {
        setSelectedSubjectId(null);
        setNotes([]);
      }
      await loadSubjects();
    } finally {
      setLoading(false);
    }
  };

  const handleUploadNote = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!selectedSubjectId) return;
    
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_FILE_SIZE) {
      alert('File size exceeds 20MB limit');
      return;
    }

    setLoading(true);
    try {
      await uploadNote(selectedSubjectId, file);
      await loadNotes(selectedSubjectId);
      // Reset the input
      e.target.value = '';
    } finally {
      setLoading(false);
    }
  };

  const handleDownloadNote = async (noteId: string, fileName: string) => {
    if (!selectedSubjectId) return;
    
    const blob = await downloadNoteBlob(selectedSubjectId, noteId);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteNote = async (noteId: string, fileName: string) => {
    if (!selectedSubjectId) return;
    if (!window.confirm(`Delete note "${fileName}"?`)) return;

    setLoading(true);
    try {
      await deleteNote(selectedSubjectId, noteId);
      await loadNotes(selectedSubjectId);
    } finally {
      setLoading(false);
    }
  };

  const selectedSubject = subjects.find(s => s.id === selectedSubjectId);

  return (
    <div className="app-content">
      <div className="welcome-section">
        <h1>
          Welcome to StepWise AI 👋
        </h1>
        <p>Your intelligent math learning companion</p>
      </div>

      <div className="form-section">
        <h2>Getting Started</h2>
        <p className="text-muted">Use the AI Whiteboard tab to create subjects and start solving problems with AI assistance.</p>
      </div>
    </div>
  );
}