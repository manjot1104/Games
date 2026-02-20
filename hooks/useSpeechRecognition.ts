/**
 * Speech Recognition Hook
 * Uses Web Speech API to detect specific words/phrases
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Platform } from 'react-native';

export interface SpeechRecognitionResult {
  isAvailable: boolean;
  isListening: boolean;
  detectedWords: string[];
  confidence: number;
  error?: string;
  hasMicrophone: boolean;
}

export interface SpeechRecognitionOptions {
  continuous?: boolean;
  interimResults?: boolean;
  language?: string;
  maxAlternatives?: number;
  targetWords?: string[]; // Words to detect (case-insensitive)
  confidenceThreshold?: number; // Minimum confidence (0-1)
}

// Web Speech API types
declare global {
  interface Window {
    SpeechRecognition?: any;
    webkitSpeechRecognition?: any;
  }
}

export function useSpeechRecognition(
  isActive: boolean = true,
  options: SpeechRecognitionOptions = {}
): SpeechRecognitionResult {
  const {
    continuous = true,
    interimResults = false,
    language = 'en-US',
    maxAlternatives = 1,
    targetWords = [],
    confidenceThreshold = 0.7,
  } = options;

  const [isAvailable, setIsAvailable] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [detectedWords, setDetectedWords] = useState<string[]>([]);
  const [confidence, setConfidence] = useState(0);
  const [error, setError] = useState<string | undefined>(undefined);
  const [hasMicrophone, setHasMicrophone] = useState(false);

  const recognitionRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectedWordsRef = useRef<string[]>([]);
  const lastDetectionTime = useRef<number>(0);
  const detectionCooldown = 1000; // 1 second cooldown between detections

  // Check if Web Speech API is available
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined') {
      setIsAvailable(false);
      setError('Speech recognition only available on web');
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      setIsAvailable(false);
      setError('Speech recognition not supported in this browser');
      return;
    }

    setIsAvailable(true);
    setError(undefined);
  }, []);

  // Request microphone permission
  useEffect(() => {
    if (Platform.OS !== 'web' || !isAvailable) return;

    const requestMicrophone = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        setHasMicrophone(true);
        setError(undefined);
        
        // Stop tracks immediately - we just needed permission
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      } catch (err: any) {
        setHasMicrophone(false);
        setError(`Microphone permission denied: ${err.message}`);
      }
    };

    requestMicrophone();

    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
      }
    };
  }, [isAvailable]);

  // Initialize and start recognition
  useEffect(() => {
    if (Platform.OS !== 'web' || !isAvailable || !isActive || !hasMicrophone) {
      return;
    }

    const SpeechRecognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;

    if (!SpeechRecognition) {
      return;
    }

    // Create recognition instance
    const recognition = new SpeechRecognition();
    recognition.continuous = continuous;
    recognition.interimResults = interimResults;
    recognition.lang = language;
    recognition.maxAlternatives = maxAlternatives;

    // Event handlers
    recognition.onstart = () => {
      setIsListening(true);
      setError(undefined);
    };

    recognition.onend = () => {
      setIsListening(false);
      // Restart if still active
      if (isActive && hasMicrophone) {
        try {
          recognition.start();
        } catch (e) {
          // Ignore errors when restarting
        }
      }
    };

    recognition.onerror = (event: any) => {
      console.warn('Speech recognition error:', event.error);
      if (event.error === 'no-speech') {
        // Not an error, just no speech detected
        return;
      }
      setError(`Recognition error: ${event.error}`);
      setIsListening(false);
    };

    recognition.onresult = (event: any) => {
      const now = Date.now();
      
      // Process all results
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        
        if (result.isFinal || !interimResults) {
          const transcript = result[0].transcript.toLowerCase().trim();
          const resultConfidence = result[0].confidence || 0.5;

          // Check if transcript contains any target words
          if (targetWords.length > 0) {
            const lowerTargetWords = targetWords.map(w => w.toLowerCase());
            const words = transcript.split(/\s+/);
            
            for (const word of words) {
              if (lowerTargetWords.includes(word) && resultConfidence >= confidenceThreshold) {
                // Check cooldown
                if (now - lastDetectionTime.current > detectionCooldown) {
                  lastDetectionTime.current = now;
                  
                  // Add to detected words (avoid duplicates in short time)
                  if (!detectedWordsRef.current.includes(word) || 
                      detectedWordsRef.current.length === 0) {
                    detectedWordsRef.current = [...detectedWordsRef.current, word];
                    setDetectedWords([...detectedWordsRef.current]);
                    setConfidence(resultConfidence);
                  }
                }
              }
            }
          } else {
            // No target words specified, return all detected words
            if (resultConfidence >= confidenceThreshold) {
              const words = transcript.split(/\s+/);
              detectedWordsRef.current = [...detectedWordsRef.current, ...words];
              setDetectedWords([...detectedWordsRef.current]);
              setConfidence(resultConfidence);
            }
          }
        }
      }
    };

    recognitionRef.current = recognition;

    // Start recognition
    try {
      recognition.start();
    } catch (e: any) {
      if (e.message && !e.message.includes('already started')) {
        setError(`Failed to start recognition: ${e.message}`);
      }
    }

    // Cleanup
    return () => {
      if (recognitionRef.current) {
        try {
          recognitionRef.current.stop();
        } catch (e) {
          // Ignore errors when stopping
        }
        recognitionRef.current = null;
      }
      detectedWordsRef.current = [];
      setDetectedWords([]);
      setIsListening(false);
    };
  }, [isAvailable, isActive, hasMicrophone, continuous, interimResults, language, maxAlternatives, targetWords, confidenceThreshold]);

  // Reset detected words
  const resetDetectedWords = useCallback(() => {
    detectedWordsRef.current = [];
    setDetectedWords([]);
    setConfidence(0);
  }, []);

  // Expose reset function via ref (if needed)
  useEffect(() => {
    (useSpeechRecognition as any).reset = resetDetectedWords;
  }, [resetDetectedWords]);

  return {
    isAvailable,
    isListening,
    detectedWords,
    confidence,
    error,
    hasMicrophone,
  };
}







