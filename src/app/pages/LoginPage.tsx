import React from 'react';
import { getGoogleSignInUrl } from '../services/storage';

export function LoginPage() {
  const handleGoogleSignIn = () => {
    window.location.assign(getGoogleSignInUrl());
  };

  return (
    <div className="auth-page">
      <div className="auth-card">
        <div className="logo">M</div>
        <h1>Welcome to StepWise AI</h1>
        <p className="subtitle">Sign in to access your learning dashboard and AI whiteboard</p>
        
        <button className="btn-primary" onClick={handleGoogleSignIn}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M10 2a8 8 0 1 1 0 16 8 8 0 0 1 0-16z" />
            <path d="M10 6v4l3 2" strokeLinecap="round" />
          </svg>
          Continue with Google
        </button>
        
        <p className="form-help text-center mt-2">
          You will be redirected to Google and returned after sign-in.
        </p>
      </div>
    </div>
  );
}
