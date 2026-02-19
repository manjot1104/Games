// app/_layout.tsx (expo-router)
import { Stack } from 'expo-router';
import * as WebBrowser from 'expo-web-browser';
import React, { useEffect } from 'react';
import './globals.css';
import AuthTokenProvider from './providers/AuthTokenProvider';
import { AuthProvider } from './providers/AuthProvider';
import { preInitializeTTS, cleanupTTS } from '@/utils/tts';

WebBrowser.maybeCompleteAuthSession();

export default function RootLayout() {
  // Pre-initialize TTS for faster first use
  useEffect(() => {
    preInitializeTTS().catch((err) => {
      console.warn('[RootLayout] Failed to pre-initialize TTS:', err);
    });

    // Cleanup on unmount
    return () => {
      cleanupTTS().catch((err) => {
        console.warn('[RootLayout] Failed to cleanup TTS:', err);
      });
    };
  }, []);

  return (
    <AuthProvider>
      <AuthTokenProvider>
        <Stack screenOptions={{ headerShown: false }} />
      </AuthTokenProvider>
    </AuthProvider>
  );
}
